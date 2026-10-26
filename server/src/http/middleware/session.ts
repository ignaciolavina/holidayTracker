import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { User } from '../../models';
import { verifyAccess, ACCESS_TTL_S, REFRESH_TTL_MS, type Tokens } from '../../services/auth';

export const ACCESS_COOKIE = 'ht_access';
export const REFRESH_COOKIE = 'ht_refresh';

const base: CookieOptions = { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax' };

export function setAuthCookies(res: Response, tokens: Tokens): void {
  res.cookie(ACCESS_COOKIE, tokens.access, { ...base, path: '/', maxAge: ACCESS_TTL_S * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refresh, { ...base, path: '/api/auth', maxAge: REFRESH_TTL_MS });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/auth' });
}

/**
 * Carga el actor desde la cookie de acceso. En cada request se recarga el usuario: si está desactivado
 * o su tokenVersion cambió, la sesión deja de valer (SPEC-02).
 */
export async function loadActor(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (token) {
      const p = verifyAccess(token);
      if (p) {
        const user = await User.findById(p.sub).select('role status tokenVersion name').lean();
        if (user && user.status === 'active' && user.tokenVersion === p.tv) {
          req.actor = { id: String(user._id), role: user.role, name: user.name, ip: req.ip ?? null };
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
