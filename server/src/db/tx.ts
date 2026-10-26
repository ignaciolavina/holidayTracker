import mongoose, { type ClientSession } from 'mongoose';

/**
 * Ejecuta `fn` en una transacción con reintentos automáticos ante conflictos transitorios
 * (WriteConflict). Los efectos fuera de la BD se registran con `after()` y se ejecutan tras el commit.
 */
export interface TxCtx {
  session: ClientSession;
  after: (cb: () => void | Promise<void>) => void;
}

export async function withTx<T>(fn: (ctx: TxCtx) => Promise<T>): Promise<T> {
  // dos upserts concurrentes del mismo documento pueden acabar en clave duplicada (no transitorio):
  // se reintenta la transacción completa, que ya verá el documento creado por la otra
  for (let attempt = 0; ; attempt++) {
    try {
      return await runTx(fn);
    } catch (err) {
      const e = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (attempt < 5 && e.code === 11000 && e.keyPattern && 'year' in e.keyPattern && 'userId' in e.keyPattern) continue;
      throw err;
    }
  }
}

async function runTx<T>(fn: (ctx: TxCtx) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  let result: T;
  let afters: Array<() => void | Promise<void>> = [];
  try {
    await session.withTransaction(async () => {
      afters = [];
      result = await fn({ session, after: (cb) => afters.push(cb) });
    });
  } finally {
    await session.endSession();
  }
  for (const cb of afters) {
    try {
      await cb();
    } catch {
      // los efectos posteriores nunca rompen la operación ya confirmada
    }
  }
  return result!;
}
