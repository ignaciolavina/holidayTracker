import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  resetSchema,
  setBirthdaySchema,
  updateProfileSchema,
} from '@ht/shared';
import { env } from '../../config/env';
import { User } from '../../models';
import { actorOf, parse, route } from '../route';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../middleware/session';
import * as auth from '../../services/auth';
import * as users from '../../services/users';
import { unauthorized } from '../../lib/errors';

const limiter = (max: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.rateLimitEnabled,
    message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera unos minutos.' } },
  });

export function authRoutes(): Router {
  const r = Router();
  const base = '/api/auth';

  route(r, base, 'post', '/login', 'public', limiter(10), async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { user, tokens } = await auth.login(email, password);
    setAuthCookies(res, tokens);
    return { user };
  });

  route(r, base, 'post', '/refresh', 'public', limiter(120), async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw unauthorized('La sesión ha caducado.');
    try {
      const { user, tokens } = await auth.refresh(token);
      setAuthCookies(res, tokens);
      return { user };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  });

  route(r, base, 'post', '/logout', 'public', async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    return undefined;
  });

  route(r, base, 'get', '/me', 'auth', async (req) => {
    const u = await User.findById(actorOf(req).id).lean();
    if (!u) throw unauthorized();
    return auth.toMe(u);
  });

  route(r, base, 'post', '/forgot', 'public', limiter(5), async (req) => {
    const { email } = parse(forgotSchema, req.body);
    await auth.forgotPassword(email);
    return undefined;
  });

  route(r, base, 'post', '/reset', 'public', limiter(10), async (req) => {
    const { token, password } = parse(resetSchema, req.body);
    await auth.resetPassword(token, password);
    return undefined;
  });

  return r;
}

export function invitationPublicRoutes(): Router {
  const r = Router();
  const base = '/api/invitations';
  route(r, base, 'get', '/token/:token', 'public', limiter(30), async (req) => users.invitationInfo(String(req.params.token)));
  route(r, base, 'post', '/accept', 'public', limiter(10), async (req, res) => {
    const { token, password, birthday } = parse(acceptInvitationSchema, req.body);
    const userId = await users.acceptInvitation(token, password, birthday);
    const tokens = await auth.startSession(userId);
    setAuthCookies(res, tokens);
    const u = await User.findById(userId).lean();
    return { user: auth.toMe(u!) };
  });
  return r;
}

export function meRoutes(): Router {
  const r = Router();
  const base = '/api/me';
  route(r, base, 'patch', '/', 'auth', async (req) => users.updateProfile(actorOf(req), parse(updateProfileSchema, req.body)));
  route(r, base, 'post', '/password', 'auth', async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const tokens = await auth.changePassword(actorOf(req), currentPassword, newPassword);
    setAuthCookies(res, tokens);
    return undefined;
  });
  route(r, base, 'post', '/birthday', 'auth', async (req) => {
    const { birthday } = parse(setBirthdaySchema, req.body);
    return users.setOwnBirthday(actorOf(req), birthday);
  });
  return r;
}
