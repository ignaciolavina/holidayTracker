import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { ClientSession } from 'mongoose';
import type { Me } from '@ht/shared';
import { env } from '../config/env';
import { PasswordReset, Session, User } from '../models';
import { clock } from '../lib/clock';
import { randomToken, sha256 } from '../lib/crypto';
import { unauthorized, unprocessable } from '../lib/errors';
import { withTx } from '../db/tx';
import { enqueueMail, kickMailQueue } from './mail/queue';
import { layout } from './mail/templates';
import { audit } from './audit';
import type { Actor } from './actor';

/** Autenticación y sesiones (SPEC-02). */

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;

// hash fijo para igualar tiempos cuando el email no existe
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 4);

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, env.bcryptCost);
}

export interface Tokens {
  access: string;
  refresh: string;
}

interface AccessPayload {
  sub: string;
  tv: number;
}

export function signAccess(userId: string, tokenVersion: number): string {
  const iat = Math.floor(clock.now().getTime() / 1000);
  return jwt.sign({ sub: userId, tv: tokenVersion, iat }, env.jwtSecret, {
    expiresIn: ACCESS_TTL_S,
    algorithm: 'HS256',
  });
}

export function verifyAccess(token: string): AccessPayload | null {
  try {
    const p = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      clockTimestamp: Math.floor(clock.now().getTime() / 1000),
    }) as jwt.JwtPayload;
    if (typeof p.sub !== 'string' || typeof p.tv !== 'number') return null;
    return { sub: p.sub, tv: p.tv };
  } catch {
    return null;
  }
}

async function createSession(userId: string, tokenVersion: number, family = randomToken(12), session?: ClientSession) {
  const refresh = randomToken(32);
  await Session.create(
    [
      {
        userId,
        family,
        tokenHash: sha256(refresh),
        expiresAt: new Date(clock.now().getTime() + REFRESH_TTL_MS),
      },
    ],
    { session },
  );
  return { access: signAccess(userId, tokenVersion), refresh };
}

export function toMe(u: {
  _id: unknown;
  email: string;
  name: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  managerId?: unknown;
  holidayCalendarId: unknown;
  hireDate: string;
  leaveDate?: string | null;
  birthday?: string | null;
  birthdayLocked?: boolean | null;
  annualUnits: number;
}): Me {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    role: u.role as Me['role'],
    status: u.status as Me['status'],
    avatarUrl: u.avatarUrl ?? null,
    managerId: u.managerId ? String(u.managerId) : null,
    holidayCalendarId: String(u.holidayCalendarId),
    hireDate: u.hireDate,
    leaveDate: u.leaveDate ?? null,
    birthday: u.birthday ?? null,
    birthdayLocked: !!u.birthdayLocked,
    annualUnits: u.annualUnits,
  };
}

const INVALID_LOGIN = 'Email o contraseña incorrectos.';

export async function login(email: string, password: string): Promise<{ user: Me; tokens: Tokens }> {
  const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw unauthorized(INVALID_LOGIN);
  if (user.status !== 'active') throw unauthorized(INVALID_LOGIN);
  const tokens = await createSession(String(user._id), user.tokenVersion);
  return { user: toMe(user), tokens };
}

export async function startSession(userId: string): Promise<Tokens> {
  const user = await User.findById(userId).lean();
  if (!user) throw unauthorized();
  return createSession(userId, user.tokenVersion);
}

/**
 * Refresh rotativo: cada refresh token sirve una sola vez. Si se reutiliza uno ya rotado,
 * se revoca toda la familia (posible robo).
 */
export async function refresh(token: string): Promise<{ user: Me; tokens: Tokens }> {
  const hash = sha256(token);
  const s = await Session.findOne({ tokenHash: hash });
  if (!s) throw unauthorized('La sesión ha caducado.');
  const now = clock.now();
  if (s.revokedAt || s.replacedBy) {
    await Session.updateMany({ family: s.family, revokedAt: null }, { $set: { revokedAt: now } });
    throw unauthorized('La sesión ha caducado.');
  }
  if (s.expiresAt.getTime() < now.getTime()) throw unauthorized('La sesión ha caducado.');
  const user = await User.findById(s.userId).lean();
  if (!user || user.status !== 'active') {
    await Session.updateMany({ family: s.family }, { $set: { revokedAt: now } });
    throw unauthorized();
  }
  // marca condicional: si dos peticiones rotan a la vez, solo una gana
  const next = randomToken(32);
  const upd = await Session.updateOne(
    { _id: s._id, replacedBy: null, revokedAt: null },
    { $set: { replacedBy: sha256(next) } },
  );
  if (upd.modifiedCount !== 1) throw unauthorized('La sesión ha caducado.');
  await Session.create({
    userId: s.userId,
    family: s.family,
    tokenHash: sha256(next),
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  });
  return { user: toMe(user), tokens: { access: signAccess(String(user._id), user.tokenVersion), refresh: next } };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const s = await Session.findOne({ tokenHash: sha256(refreshToken) });
  if (s) await Session.updateMany({ family: s.family }, { $set: { revokedAt: clock.now() } });
}

/** Invalida todas las sesiones de un usuario (desactivar, cambio de rol, reset de contraseña). */
export async function invalidateSessions(userId: string, session?: ClientSession): Promise<void> {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }, { session });
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: clock.now() } }, { session });
}

/** Recuperación: la respuesta es idéntica exista o no el email. */
export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase().trim(), status: 'active' }).lean();
  if (!user) {
    await bcrypt.compare('x', DUMMY_HASH); // iguala tiempos
    return;
  }
  const token = randomToken(32);
  await PasswordReset.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(clock.now().getTime() + RESET_TTL_MS),
  });
  await enqueueMail(
    user.email,
    layout({
      subject: 'Restablece tu contraseña',
      greeting: `¡Hola, ${user.name.split(' ')[0]}!`,
      paragraphs: [
        'Hemos recibido una petición para restablecer tu contraseña de holidayTracker.',
        'El enlace caduca en 1 hora y solo se puede usar una vez. Si no lo has pedido tú, ignora este correo.',
      ],
      cta: { label: 'Elegir nueva contraseña', path: `/reset?token=${token}` },
    }),
  );
  kickMailQueue();
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await withTx(async ({ session }) => {
    const now = clock.now();
    const r = await PasswordReset.findOneAndUpdate(
      { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { session },
    );
    if (!r) throw unprocessable('INVALID_TOKEN', 'El enlace no es válido o ha caducado.');
    await User.updateOne({ _id: r.userId }, { $set: { passwordHash: await hashPassword(password) } }, { session });
    await invalidateSessions(String(r.userId), session);
    await audit.log({ id: String(r.userId), role: 'user' }, 'USER_PASSWORD_RESET', { type: 'user', id: String(r.userId) }, null, null, null, session);
  });
}

export async function changePassword(actor: Actor, current: string, next: string): Promise<Tokens> {
  const user = await User.findById(actor.id).lean();
  if (!user?.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
    throw unprocessable('WRONG_PASSWORD', 'La contraseña actual no es correcta.');
  }
  await withTx(async ({ session }) => {
    await User.updateOne({ _id: actor.id }, { $set: { passwordHash: await hashPassword(next) } }, { session });
    await invalidateSessions(actor.id!, session);
  });
  // la sesión actual se renueva; las demás quedan invalidadas
  return startSession(actor.id!);
}
