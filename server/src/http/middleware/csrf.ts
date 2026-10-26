import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { forbidden } from '../../lib/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF: las cookies son sameSite=lax y, además, toda petición que modifica exige la cabecera
 * `X-Requested-With: holidaytracker` (no se puede enviar desde otro origen sin preflight y CORS
 * está cerrado). Si llega `Origin`, tiene que ser el de la app.
 */
export function csrf(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE.has(req.method)) return next();
  if (req.get('x-requested-with') !== 'holidaytracker') {
    return next(forbidden('CSRF', 'Petición no permitida.'));
  }
  const origin = req.get('origin');
  if (origin) {
    const allowed = [env.appUrl, env.corsOrigin, `${req.protocol}://${req.get('host')}`].filter(Boolean);
    if (!allowed.includes(origin)) return next(forbidden('CSRF', 'Origen no permitido.'));
  }
  next();
}
