import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/** Errores con mensaje claro en español; nunca se filtra el stack. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'Identificador inválido.' } });
    return;
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo de la petición no es JSON válido.' } });
    return;
  }
  if ((err as { code?: number }).code === 11000) {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'Ya existe un registro con esos datos.' } });
    return;
  }
  logger.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo.' } });
}

export function notFoundApi(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
}
