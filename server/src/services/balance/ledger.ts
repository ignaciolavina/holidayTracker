import { Types, type ClientSession } from 'mongoose';
import { lastDayOfFebruary, type Bucket, type LedgerType } from '@ht/shared';
import { LedgerEntry, UserYear } from '../../models';
import { unprocessable } from '../../lib/errors';

/**
 * Ledger de solo inserción (SPEC-07). Toda escritura de saldo pasa por aquí.
 */

export interface LedgerInput {
  userId: string;
  year: number;
  bucket: Bucket;
  type: LedgerType;
  units: number;
  requestId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
  idempotencyKey: string;
}

export type BucketSums = Record<Bucket, number>;

export const emptySums = (): BucketSums => ({ CURRENT: 0, CARRYOVER: 0, BIRTHDAY: 0 });

/**
 * Bloquea los años del usuario dentro de la transacción: upsert + `$inc` de `userYears.version`.
 * Dos transacciones del mismo usuario/año escriben el mismo documento: una aborta con WriteConflict
 * y el driver la reintenta (ya viendo la reserva de la otra) → serialización y sin doble gasto.
 * El upsert se hace dentro de la transacción para que el documento sea visible en su snapshot.
 */
export async function lockUserYears(userId: string, years: number[], session: ClientSession): Promise<void> {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  for (const year of sorted) {
    await UserYear.updateOne(
      { userId, year },
      {
        $inc: { version: 1 },
        $setOnInsert: { closed: false, opened: false, carryoverExpiresOn: lastDayOfFebruary(year) },
      },
      { upsert: true, session },
    );
  }
}

export async function closedYears(userId: string, years: number[], session?: ClientSession): Promise<Set<number>> {
  const docs = await UserYear.find({ userId, year: { $in: years }, closed: true })
    .select('year')
    .session(session ?? null)
    .lean();
  return new Set(docs.map((d) => d.year));
}

/**
 * Inserta movimientos de forma idempotente: los que ya existen (misma `idempotencyKey`) se omiten.
 * Rechaza movimientos en años cerrados salvo que se indique `allowClosed` (lo usa el propio cierre).
 * Devuelve los movimientos realmente insertados.
 */
export async function insertLedger(
  entries: LedgerInput[],
  session: ClientSession,
  opts: { allowClosed?: boolean } = {},
): Promise<LedgerInput[]> {
  const nonZero = entries.filter((e) => e.units !== 0);
  if (!nonZero.length) return [];
  for (const e of nonZero) {
    if (!Number.isInteger(e.units)) throw new Error('Las unidades del ledger deben ser enteras');
  }
  if (!opts.allowClosed) {
    const byUser = new Map<string, number[]>();
    for (const e of nonZero) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e.year]);
    for (const [userId, years] of byUser) {
      const closed = await closedYears(userId, years, session);
      if (closed.size) {
        throw unprocessable(
          'YEAR_CLOSED',
          `El año ${[...closed].join(', ')} está cerrado: solo se puede corregir con un ajuste en el año abierto.`,
        );
      }
    }
  }
  const keys = nonZero.map((e) => e.idempotencyKey);
  const existing = new Set(
    (await LedgerEntry.find({ idempotencyKey: { $in: keys } }).select('idempotencyKey').session(session).lean()).map(
      (d) => d.idempotencyKey,
    ),
  );
  const fresh = nonZero.filter((e, i) => !existing.has(e.idempotencyKey) && keys.indexOf(e.idempotencyKey) === i);
  if (fresh.length) {
    await LedgerEntry.insertMany(
      fresh.map((e) => ({
        userId: e.userId,
        year: e.year,
        bucket: e.bucket,
        type: e.type,
        units: e.units,
        requestId: e.requestId ?? null,
        reason: e.reason ?? null,
        createdBy: e.createdBy ?? null,
        idempotencyKey: e.idempotencyKey,
      })),
      { session },
    );
  }
  return fresh;
}

export async function keyExists(key: string, session?: ClientSession): Promise<boolean> {
  return !!(await LedgerEntry.exists({ idempotencyKey: key }).session(session ?? null));
}

/** Suma por bolsa de los años indicados. */
export async function ledgerSums(
  userId: string,
  years: number[],
  session?: ClientSession,
): Promise<Map<number, BucketSums>> {
  const rows = await LedgerEntry.aggregate<{ _id: { year: number; bucket: Bucket }; units: number }>([
    { $match: { userId: toObjectId(userId), year: { $in: years } } },
    { $group: { _id: { year: '$year', bucket: '$bucket' }, units: { $sum: '$units' } } },
  ]).session(session ?? null);
  const map = new Map<number, BucketSums>();
  for (const y of years) map.set(y, emptySums());
  for (const r of rows) map.get(r._id.year)![r._id.bucket] = r.units;
  return map;
}

export async function sumByTypes(
  userId: string,
  year: number,
  bucket: Bucket,
  types: LedgerType[],
  session?: ClientSession,
): Promise<{ units: number; count: number }> {
  const rows = await LedgerEntry.aggregate<{ units: number; count: number }>([
    { $match: { userId: toObjectId(userId), year, bucket, type: { $in: types } } },
    { $group: { _id: null, units: { $sum: '$units' }, count: { $sum: 1 } } },
  ]).session(session ?? null);
  return { units: rows[0]?.units ?? 0, count: rows[0]?.count ?? 0 };
}

function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}
