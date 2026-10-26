import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import { badRequest, forbidden, unauthorized } from '../lib/errors';
import type { Actor } from '../services/actor';

/**
 * Cada endpoint declara su política (SPEC-04). Un test recorre el registro y la app y falla
 * si alguna ruta no tiene política.
 */
export type Policy = 'public' | 'auth' | 'admin';
export type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface RouteInfo {
  method: Method;
  path: string;
  policy: Policy;
}

export const routeRegistry: RouteInfo[] = [];

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

function policyGuard(policy: Policy): RequestHandler {
  return (req, _res, next) => {
    if (policy === 'public') return next();
    if (!req.actor) return next(unauthorized());
    if (policy === 'admin' && req.actor.role !== 'admin') {
      return next(forbidden('ADMIN_ONLY', 'Solo un admin puede hacer esta acción.'));
    }
    next();
  };
}

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

/**
 * Registra una ruta con su política. El handler devuelve el cuerpo (JSON) o `undefined` si ya respondió.
 * `base` es el prefijo con el que el router se monta (para el registro).
 */
export function route(
  router: Router,
  base: string,
  method: Method,
  path: string,
  policy: Policy,
  ...handlers: [...RequestHandler[], Handler]
): void {
  routeRegistry.push({ method, path: `${base}${path}`.replace(/\/$/, '') || '/', policy });
  const last = handlers[handlers.length - 1] as Handler;
  const middlewares = handlers.slice(0, -1) as RequestHandler[];
  const wrapped: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => last(req, res))
      .then((body) => {
        if (res.headersSent) return;
        if (body === undefined) res.status(204).end();
        else res.json(body);
      })
      .catch(next);
  };
  (router as unknown as Record<Method, (...a: unknown[]) => void>)[method](
    path,
    policyGuard(policy),
    ...middlewares,
    wrapped,
  );
}

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first?.path.join('.');
    throw badRequest(
      'VALIDATION',
      first ? `${field ? `${field}: ` : ''}${first.message}` : 'Datos no válidos.',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export function yearParam(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

export function idParam(req: Request, name = 'id'): string {
  const v = req.params[name] ?? '';
  if (!/^[a-f0-9]{24}$/i.test(v)) throw badRequest('INVALID_ID', 'Identificador inválido.');
  return v;
}
