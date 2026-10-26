/** Errores de dominio con mensaje en español. Nunca se devuelve el stack. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Tienes que iniciar sesión.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const notFound = (message = 'No encontrado.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
