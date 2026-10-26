import type { ClientSession } from 'mongoose';
import {
  daysToUnits,
  formatDateEs,
  yearOf,
  type InvitationDto,
  type InvitationInfo,
  type OrgNode,
  type SettlementDto,
  type UserDetail,
  type UserSummary,
} from '@ht/shared';
import { HolidayCalendar, Invitation, User, VacationRequest } from '../models';
import { withTx } from '../db/tx';
import { clock } from '../lib/clock';
import { randomToken, sha256 } from '../lib/crypto';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import type { Actor } from './actor';
import { audit } from './audit';
import { getSettings } from './settings';
import { hashPassword, invalidateSessions, toMe } from './auth';
import { enqueueMail, kickMailQueue } from './mail/queue';
import { layout } from './mail/templates';
import { assertNotSelf } from './antiCheat/policies';
import {
  assertRootAdminExists,
  directReportsOf,
  escalationTargets,
  loadTree,
  validateManagerChange,
} from './tree';
import { ensureBirthdayAllowance, ensureYearOpen, entitlementFor, isYearOpen, syncAllEntitlements } from './balance/entitlement';
import { insertLedger, lockUserYears } from './balance/ledger';
import { allocationOf, getBalance, type StoredRequest } from './balance/state';
import { outTodaySet, userSummary } from './calendar';

/** Usuarios, invitaciones y árbol (SPEC-03 / SPEC-04). */

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

type UserLean = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

async function loadUser(id: string, session?: ClientSession) {
  const u = await User.findById(id).session(session ?? null).lean();
  if (!u) throw notFound('Usuario no encontrado.');
  return u;
}

function detail(u: UserLean, reports: number): UserDetail {
  return { ...toMe(u), createdAt: (u.createdAt as Date).toISOString(), directReportsCount: reports };
}

export async function listUsers(actor: Actor): Promise<UserSummary[] | UserDetail[]> {
  const users = await User.find({}).sort({ name: 1 }).lean();
  if (actor.role !== 'admin') return users.filter((u) => u.status !== 'invited').map(userSummary);
  const tree = await loadTree();
  return users.map((u) => detail(u, directReportsOf(String(u._id), tree).length));
}

export async function getUserDetail(id: string): Promise<UserDetail> {
  const u = await loadUser(id);
  const tree = await loadTree();
  return detail(u, directReportsOf(id, tree).length);
}

async function defaultCalendarId(session?: ClientSession): Promise<string> {
  const cal =
    (await HolidayCalendar.findOne({ isDefault: true }).session(session ?? null).lean()) ??
    (await HolidayCalendar.findOne({}).session(session ?? null).lean());
  if (!cal) throw unprocessable('NO_CALENDAR', 'No hay ningún calendario de festivos configurado.');
  return String(cal._id);
}

// ───────── invitaciones ─────────

export interface InviteInput {
  email: string;
  name: string;
  role: 'admin' | 'user';
  managerId: string | null;
  holidayCalendarId?: string;
  hireDate: string;
  annualDays?: number;
  birthday?: string;
}

async function sendInvitationMail(to: string, name: string, token: string, inviterName: string) {
  await enqueueMail(
    to,
    layout({
      subject: 'Te han invitado a holidayTracker',
      greeting: `¡Hola, ${name.split(' ')[0]}!`,
      paragraphs: [
        `${inviterName} te ha invitado a holidayTracker, la app donde gestionamos las vacaciones del equipo.`,
        'Para entrar, elige tu contraseña desde este enlace. Caduca en 7 días.',
      ],
      cta: { label: 'Aceptar invitación', path: `/invite?token=${token}` },
    }),
  );
}

export async function inviteUser(actor: Actor, input: InviteInput): Promise<InvitationDto> {
  const settings = await getSettings();
  const token = randomToken(32);
  const result = await withTx(async ({ session, after }) => {
    const existing = await User.findOne({ email: input.email }).session(session).lean();
    if (existing && existing.status !== 'invited') {
      throw conflict('EMAIL_IN_USE', 'Ya existe un usuario con ese email.');
    }
    const tree = await loadTree(session);
    validateManagerChange(existing ? String(existing._id) : '000000000000000000000000', input.managerId, tree);
    const calendarId = input.holidayCalendarId ?? (await defaultCalendarId(session));
    if (!(await HolidayCalendar.exists({ _id: calendarId }).session(session))) {
      throw unprocessable('CALENDAR_NOT_FOUND', 'El calendario de festivos no existe.');
    }
    const annualUnits = input.annualDays !== undefined ? daysToUnits(input.annualDays) : settings.defaultAnnualUnits;
    const fields = {
      email: input.email,
      name: input.name,
      role: input.role,
      managerId: input.managerId,
      holidayCalendarId: calendarId,
      hireDate: input.hireDate,
      annualUnits,
      annualHistory: [{ from: input.hireDate, units: annualUnits }],
      birthday: input.birthday ?? null,
      birthdayLocked: !!input.birthday,
      status: 'invited' as const,
    };
    let userId: string;
    if (existing) {
      await User.updateOne({ _id: existing._id }, { $set: fields }, { session });
      userId = String(existing._id);
      await Invitation.updateMany({ userId, usedAt: null, revokedAt: null }, { $set: { revokedAt: clock.now() } }, { session });
    } else {
      const [u] = await User.create([fields], { session });
      userId = String(u!._id);
    }
    const [inv] = await Invitation.create(
      [
        {
          email: input.email,
          name: input.name,
          userId,
          tokenHash: sha256(token),
          invitedBy: actor.id,
          payload: { role: input.role, managerId: input.managerId, holidayCalendarId: calendarId, hireDate: input.hireDate, annualUnits, birthday: input.birthday ?? null },
          expiresAt: new Date(clock.now().getTime() + INVITE_TTL_MS),
        },
      ],
      { session },
    );
    await audit.log(actor, 'USER_INVITED', { type: 'user', id: userId }, null, fields, null, session);
    after(kickMailQueue);
    await sendInvitationMail(input.email, input.name, token, actor.name ?? 'Un admin');
    return inv!;
  });
  return invitationDto(result.toObject());
}

function invitationDto(i: {
  _id: unknown;
  email: string;
  name: string;
  payload?: { role?: string } | null;
  expiresAt: Date;
  createdAt?: Date;
  invitedBy: unknown;
  usedAt?: Date | null;
  revokedAt?: Date | null;
}): InvitationDto {
  const now = clock.now().getTime();
  const status: InvitationDto['status'] = i.usedAt
    ? 'used'
    : i.revokedAt
      ? 'revoked'
      : new Date(i.expiresAt).getTime() < now
        ? 'expired'
        : 'pending';
  return {
    id: String(i._id),
    email: i.email,
    name: i.name,
    role: (i.payload?.role as InvitationDto['role']) ?? 'user',
    status,
    expiresAt: new Date(i.expiresAt).toISOString(),
    createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : '',
    invitedBy: String(i.invitedBy),
  };
}

export async function listInvitations(): Promise<InvitationDto[]> {
  const list = await Invitation.find({}).sort({ createdAt: -1 }).lean();
  return list.map((i) => invitationDto(i as Parameters<typeof invitationDto>[0]));
}

/** Reenviar: token nuevo que invalida el anterior. */
export async function resendInvitation(actor: Actor, id: string): Promise<InvitationDto> {
  const token = randomToken(32);
  const inv = await withTx(async ({ session, after }) => {
    const i = await Invitation.findById(id).session(session);
    if (!i) throw notFound('Invitación no encontrada.');
    if (i.usedAt) throw conflict('INVITATION_USED', 'La invitación ya se ha usado.');
    if (i.revokedAt) throw conflict('INVITATION_REVOKED', 'La invitación está revocada.');
    i.tokenHash = sha256(token);
    i.expiresAt = new Date(clock.now().getTime() + INVITE_TTL_MS);
    await i.save({ session });
    await audit.log(actor, 'INVITATION_RESENT', { type: 'invitation', id }, null, { email: i.email }, null, session);
    await sendInvitationMail(i.email, i.name, token, actor.name ?? 'Un admin');
    after(kickMailQueue);
    return i.toObject();
  });
  return invitationDto(inv);
}

export async function revokeInvitation(actor: Actor, id: string): Promise<InvitationDto> {
  const inv = await withTx(async ({ session }) => {
    const i = await Invitation.findOneAndUpdate(
      { _id: id, usedAt: null, revokedAt: null },
      { $set: { revokedAt: clock.now() } },
      { session, new: true },
    );
    if (!i) throw conflict('INVITATION_NOT_PENDING', 'La invitación no está pendiente.');
    await audit.log(actor, 'INVITATION_REVOKED', { type: 'invitation', id }, null, { email: i.email }, null, session);
    return i.toObject();
  });
  return invitationDto(inv);
}

async function validInvitation(token: string, session?: ClientSession) {
  const i = await Invitation.findOne({ tokenHash: sha256(token) }).session(session ?? null);
  if (!i || i.usedAt || i.revokedAt || i.expiresAt.getTime() < clock.now().getTime()) {
    throw unprocessable('INVALID_INVITATION', 'La invitación no es válida o ha caducado.');
  }
  return i;
}

export async function invitationInfo(token: string): Promise<InvitationInfo> {
  const i = await validInvitation(token);
  const u = await loadUser(String(i.userId));
  return { email: i.email, name: i.name, needsBirthday: !u.birthday };
}

export async function acceptInvitation(token: string, password: string, birthday?: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  return withTx(async ({ session }) => {
    const i = await validInvitation(token, session);
    const upd = await Invitation.updateOne({ _id: i._id, usedAt: null }, { $set: { usedAt: clock.now() } }, { session });
    if (upd.modifiedCount !== 1) throw unprocessable('INVALID_INVITATION', 'La invitación ya se ha usado.');
    const userId = String(i.userId);
    const u = await loadUser(userId, session);
    const set: Record<string, unknown> = { passwordHash, status: 'active' };
    if (!u.birthday && birthday) {
      set.birthday = birthday;
      set.birthdayLocked = true;
    }
    await User.updateOne({ _id: userId }, { $set: set }, { session });
    const fresh = await loadUser(userId, session);
    const thisYear = yearOf(clock.today());
    const years = [Math.max(yearOf(fresh.hireDate), thisYear)].filter((y) => y <= thisYear + 1);
    await lockUserYears(userId, years, session);
    for (const y of years) await ensureYearOpen(fresh, y, session);
    await audit.log({ id: userId, role: fresh.role }, 'USER_ACTIVATED', { type: 'user', id: userId }, { status: 'invited' }, { status: 'active', birthday: fresh.birthday }, null, session);
    return userId;
  });
}

// ───────── perfil ─────────

export async function updateProfile(actor: Actor, patch: { name?: string; avatarUrl?: string | null }) {
  await User.updateOne({ _id: actor.id }, { $set: patch });
  return toMe(await loadUser(actor.id!));
}

/** El usuario fija su cumpleaños una sola vez (SPEC-03 / SPEC-11 regla 5). */
export async function setOwnBirthday(actor: Actor, birthday: string) {
  await withTx(async ({ session }) => {
    const upd = await User.updateOne(
      { _id: actor.id, birthdayLocked: { $ne: true } },
      { $set: { birthday, birthdayLocked: true } },
      { session },
    );
    if (upd.modifiedCount !== 1) {
      throw forbidden('BIRTHDAY_LOCKED', 'Tu cumpleaños ya está fijado: solo lo puede cambiar un admin.');
    }
    const u = await loadUser(actor.id!, session);
    await grantBirthdayForOpenYears(u, session);
    await audit.log(actor, 'USER_BIRTHDAY_SET', { type: 'user', id: actor.id }, null, { birthday }, null, session);
  });
  return toMe(await loadUser(actor.id!));
}

async function grantBirthdayForOpenYears(u: UserLean, session: ClientSession) {
  const thisYear = yearOf(clock.today());
  for (const y of [thisYear, thisYear + 1]) {
    await lockUserYears(String(u._id), [y], session);
    if (await isYearOpen(String(u._id), y, session)) await ensureBirthdayAllowance(u, y, session);
  }
}

// ───────── edición por admin ─────────

export interface UpdateUserInput {
  name?: string;
  role?: 'admin' | 'user';
  managerId?: string | null;
  holidayCalendarId?: string;
  hireDate?: string;
  annualDays?: number;
  annualDaysFrom?: string;
  birthday?: string | null;
  reason?: string;
}

export async function updateUser(actor: Actor, id: string, input: UpdateUserInput): Promise<UserDetail> {
  await withTx(async ({ session }) => {
    const u = await loadUser(id, session);
    const set: Record<string, unknown> = {};
    const tree = await loadTree(session);
    const needsReason = (what: string) => {
      if (!input.reason?.trim()) throw unprocessable('REASON_REQUIRED', `Indica un motivo para cambiar ${what}.`);
    };

    if (input.name !== undefined && input.name !== u.name) set.name = input.name;

    if (input.managerId !== undefined && String(input.managerId ?? '') !== String(u.managerId ?? '')) {
      assertNotSelf(actor, id, 'cambiar el manager');
      validateManagerChange(id, input.managerId, tree);
      set.managerId = input.managerId;
      tree.get(id)!.managerId = input.managerId as never;
      await audit.log(actor, 'USER_MANAGER_CHANGED', { type: 'user', id }, { managerId: u.managerId }, { managerId: input.managerId }, input.reason ?? null, session);
    }

    if (input.role !== undefined && input.role !== u.role) {
      assertNotSelf(actor, id, 'cambiar el rol');
      if (input.role === 'user' && directReportsOf(id, tree).length) {
        throw unprocessable('HAS_DIRECT_REPORTS', 'Tiene personas a su cargo: reasígnalas antes de quitarle el rol de admin.');
      }
      set.role = input.role;
      tree.get(id)!.role = input.role;
      await audit.log(actor, 'USER_ROLE_CHANGED', { type: 'user', id }, { role: u.role }, { role: input.role }, input.reason ?? null, session);
    }

    if (input.holidayCalendarId !== undefined && input.holidayCalendarId !== String(u.holidayCalendarId)) {
      if (!(await HolidayCalendar.exists({ _id: input.holidayCalendarId }).session(session))) {
        throw unprocessable('CALENDAR_NOT_FOUND', 'El calendario de festivos no existe.');
      }
      set.holidayCalendarId = input.holidayCalendarId;
      await audit.log(actor, 'USER_CALENDAR_CHANGED', { type: 'user', id }, { holidayCalendarId: u.holidayCalendarId }, { holidayCalendarId: input.holidayCalendarId }, input.reason ?? null, session);
    }

    let resync = false;
    if (input.hireDate !== undefined && input.hireDate !== u.hireDate) {
      assertNotSelf(actor, id, 'cambiar la fecha de alta');
      needsReason('la fecha de alta');
      set.hireDate = input.hireDate;
      const hist = (u.annualHistory ?? []).map((h) => ({ from: h.from ?? input.hireDate!, units: h.units ?? u.annualUnits }));
      if (hist[0]) hist[0].from = input.hireDate;
      set.annualHistory = hist;
      resync = true;
      await audit.log(actor, 'USER_HIRE_DATE_CHANGED', { type: 'user', id }, { hireDate: u.hireDate }, { hireDate: input.hireDate }, input.reason ?? null, session);
    }

    if (input.annualDays !== undefined && daysToUnits(input.annualDays) !== u.annualUnits) {
      assertNotSelf(actor, id, 'cambiar los días anuales');
      needsReason('los días anuales');
      const units = daysToUnits(input.annualDays);
      const from = input.annualDaysFrom ?? clock.today();
      const base =
        (set.annualHistory as Array<{ from: string; units: number }> | undefined) ??
        (u.annualHistory ?? []).map((h) => ({ from: h.from ?? u.hireDate, units: h.units ?? u.annualUnits }));
      set.annualUnits = units;
      set.annualHistory = [...base.filter((h) => h.from < from), { from, units }];
      resync = true;
      await audit.log(actor, 'USER_ANNUAL_DAYS_CHANGED', { type: 'user', id }, { annualUnits: u.annualUnits }, { annualUnits: units, from }, input.reason ?? null, session);
    }

    if (input.birthday !== undefined && input.birthday !== u.birthday) {
      if (u.birthday) needsReason('el cumpleaños');
      set.birthday = input.birthday;
      set.birthdayLocked = !!input.birthday;
      await audit.log(actor, u.birthday ? 'USER_BIRTHDAY_CHANGED' : 'USER_BIRTHDAY_SET', { type: 'user', id }, { birthday: u.birthday }, { birthday: input.birthday }, input.reason ?? null, session);
    }

    if (!Object.keys(set).length) return;
    await User.updateOne({ _id: id }, { $set: set }, { session });
    assertRootAdminExists(tree);
    if (set.role) await invalidateSessions(id, session);

    const fresh = await loadUser(id, session);
    const thisYear = yearOf(clock.today());
    if (resync) {
      const diffs = await syncAllEntitlements(id, [thisYear, thisYear + 1], session, {
        createdBy: actor.id,
        reason: input.reason ?? 'Recalculo de prorrata',
      });
      if (Object.values(diffs).some((d) => d !== 0)) {
        await audit.log(actor, 'PRORATION_ADJUSTED', { type: 'user', id }, null, diffs, input.reason ?? null, session);
      }
    }
    if (set.birthday && fresh.status === 'active') await grantBirthdayForOpenYears(fresh, session);
  });
  return getUserDetail(id);
}

// ───────── baja / reactivación ─────────

export async function deactivateUser(actor: Actor, id: string, leaveDate: string, reason?: string): Promise<SettlementDto> {
  assertNotSelf(actor, id, 'desactivarte');
  await withTx(async ({ session }) => {
    const u = await loadUser(id, session);
    if (u.status === 'disabled') throw conflict('ALREADY_DISABLED', 'El usuario ya está desactivado.');
    if (leaveDate < u.hireDate) throw unprocessable('LEAVE_BEFORE_HIRE', 'La fecha de baja no puede ser anterior al alta.');
    const tree = await loadTree(session);
    if (directReportsOf(id, tree).length) {
      throw unprocessable('HAS_DIRECT_REPORTS', 'Tiene personas a su cargo: reasígnalas antes de desactivarle.');
    }
    await User.updateOne({ _id: id }, { $set: { status: 'disabled', leaveDate } }, { session });
    tree.get(id)!.status = 'disabled';
    assertRootAdminExists(tree);
    await invalidateSessions(id, session);

    // solicitudes posteriores a la baja: las pendientes se cancelan y las aprobadas futuras se devuelven
    const later = (await VacationRequest.find({ userId: id, status: { $in: ['PENDING', 'APPROVED'] }, endDate: { $gt: leaveDate } })
      .session(session)
      .lean()) as unknown as StoredRequest[];
    const leaveYear = yearOf(leaveDate);
    await lockUserYears(id, [leaveYear, leaveYear + 1], session);
    for (const r of later) {
      await VacationRequest.updateOne(
        { _id: r._id, status: r.status },
        { $set: { status: 'CANCELLED', cancelReason: `Baja del usuario el ${formatDateEs(leaveDate)}`, decidedAt: clock.now() } },
        { session },
      );
      if (r.status === 'APPROVED') {
        const totals = new Map<string, { year: number; bucket: string; units: number }>();
        for (const a of allocationOf(r)) {
          const k = `${a.year}:${a.bucket}`;
          const t = totals.get(k) ?? { year: a.year, bucket: a.bucket, units: 0 };
          t.units += a.units;
          totals.set(k, t);
        }
        await insertLedger(
          [...totals.values()].map((t) => ({
            userId: id,
            year: t.year,
            bucket: t.bucket as 'CURRENT',
            type: 'REFUND' as const,
            units: t.units,
            requestId: String(r._id),
            createdBy: actor.id,
            reason: 'Cancelada por baja',
            idempotencyKey: `refund:${String(r._id)}:${t.year}:${t.bucket}`,
          })),
          session,
        );
      }
    }
    await syncAllEntitlements(id, [leaveYear, leaveYear + 1], session, { createdBy: actor.id, reason: `Prorrata por baja el ${formatDateEs(leaveDate)}` });
    await audit.log(actor, 'USER_DEACTIVATED', { type: 'user', id }, { status: u.status, leaveDate: u.leaveDate }, { status: 'disabled', leaveDate, cancelledRequests: later.length }, reason ?? null, session);
  });
  return getSettlement(id);
}

export async function reactivateUser(actor: Actor, id: string): Promise<UserDetail> {
  await withTx(async ({ session }) => {
    const u = await loadUser(id, session);
    if (u.status !== 'disabled') throw conflict('NOT_DISABLED', 'El usuario no está desactivado.');
    await User.updateOne({ _id: id }, { $set: { status: u.passwordHash ? 'active' : 'invited', leaveDate: null } }, { session });
    const thisYear = yearOf(clock.today());
    await syncAllEntitlements(id, [thisYear, thisYear + 1], session, { createdBy: actor.id, reason: 'Reactivación' });
    const fresh = await loadUser(id, session);
    await ensureYearOpen(fresh, thisYear, session);
    await audit.log(actor, 'USER_REACTIVATED', { type: 'user', id }, { status: 'disabled', leaveDate: u.leaveDate }, { status: 'active' }, null, session);
  });
  return getUserDetail(id);
}

/** Saldo de liquidación: días a favor (+) o en contra (−) en el año de la baja. */
export async function getSettlement(id: string): Promise<SettlementDto> {
  const u = await loadUser(id);
  const leave = u.leaveDate ?? clock.today();
  const year = yearOf(leave);
  const b = await getBalance(id, year);
  return {
    userId: id,
    year,
    leaveDate: leave,
    entitlementUnits: entitlementFor(u, year),
    settlementUnits: b.ledger.current + b.ledger.carryover,
  };
}

// ───────── organigrama ─────────

export async function orgTree(actor: Actor): Promise<OrgNode[]> {
  const users = await User.find({ status: { $ne: 'invited' } }).sort({ name: 1 }).lean();
  const tree = await loadTree();
  const out = await outTodaySet();
  const year = yearOf(clock.today());
  const nodes: OrgNode[] = [];
  for (const u of users) {
    const id = String(u._id);
    nodes.push({
      id,
      name: u.name,
      avatarUrl: u.avatarUrl ?? null,
      role: u.role,
      status: u.status,
      managerId: u.managerId ? String(u.managerId) : null,
      outToday: out.has(id),
      ...(actor.role === 'admin' && u.status === 'active' ? { availableUnits: (await getBalance(id, year)).available.total } : {}),
      assignedApproverId: u.managerId ? String(u.managerId) : null,
      escalationIds: escalationTargets(id, tree),
      directReports: directReportsOf(id, tree).length,
    });
  }
  return nodes;
}

