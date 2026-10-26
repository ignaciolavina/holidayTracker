import type { ClientSession } from 'mongoose';
import { birthdayEligible, endOfYear, entitlementUnits, lastDayOfFebruary, startOfYear, type ISODate } from '@ht/shared';
import { User, UserYear } from '../../models';
import { closedYears, insertLedger, lockUserYears, sumByTypes } from './ledger';
import { getSettings } from '../settings';

/**
 * Apertura de año, asignación de cumpleaños y prorrata (SPEC-07 / SPEC-08).
 */

export interface EntitlementUser {
  _id: { toString(): string };
  hireDate: ISODate;
  leaveDate?: ISODate | null;
  annualUnits: number;
  annualHistory?: Array<{ from?: string | null; units?: number | null }> | null;
  birthday?: string | null;
  status?: string;
}

export function historyOf(user: EntitlementUser): Array<{ from: ISODate; units: number }> {
  const h = (user.annualHistory ?? [])
    .filter((x): x is { from: string; units: number } => !!x.from && typeof x.units === 'number')
    .map((x) => ({ from: x.from, units: x.units }));
  return h.length ? h : [{ from: user.hireDate, units: user.annualUnits }];
}

export function entitlementFor(user: EntitlementUser, year: number): number {
  return entitlementUnits(year, { hireDate: user.hireDate, leaveDate: user.leaveDate, annualHistory: historyOf(user) });
}

export function activeInYear(user: EntitlementUser, year: number): boolean {
  if (user.hireDate > endOfYear(year)) return false;
  if (user.leaveDate && user.leaveDate < startOfYear(year)) return false;
  return true;
}

export const allowanceKey = (userId: string, year: number) => `allowance:${userId}:${year}`;
export const birthdayAllowanceKey = (userId: string, year: number) => `birthday-allowance:${userId}:${year}`;

/** ¿Tiene ya la asignación anual de ese año? */
export async function isYearOpen(userId: string, year: number, session?: ClientSession): Promise<boolean> {
  return !!(await UserYear.exists({ userId, year, opened: true }).session(session ?? null));
}

/**
 * Abre el año para el usuario: ANNUAL_ALLOWANCE prorrateada y BIRTHDAY_ALLOWANCE si le corresponde.
 * Idempotente. Debe llamarse dentro de una transacción.
 */
export async function ensureYearOpen(user: EntitlementUser, year: number, session: ClientSession): Promise<void> {
  const userId = String(user._id);
  if (!activeInYear(user, year)) return;
  if ((await closedYears(userId, [year], session)).size) return;
  await insertLedger(
    [
      {
        userId,
        year,
        bucket: 'CURRENT',
        type: 'ANNUAL_ALLOWANCE',
        units: entitlementFor(user, year),
        reason: `Asignación anual ${year}`,
        idempotencyKey: allowanceKey(userId, year),
      },
    ],
    session,
  );
  await UserYear.updateOne(
    { userId, year },
    { $set: { opened: true }, $setOnInsert: { closed: false, carryoverExpiresOn: lastDayOfFebruary(year) } },
    { upsert: true, session },
  );
  await ensureBirthdayAllowance(user, year, session);
}

/** Asigna el día de cumpleaños del año si el usuario es elegible. Idempotente. */
export async function ensureBirthdayAllowance(
  user: EntitlementUser,
  year: number,
  session: ClientSession,
): Promise<boolean> {
  const userId = String(user._id);
  const settings = await getSettings(session);
  if (!settings.birthdayEnabled || !user.birthday) return false;
  if (!birthdayEligible(year, user.birthday, user.hireDate, user.leaveDate)) return false;
  if ((await closedYears(userId, [year], session)).size) return false;
  const inserted = await insertLedger(
    [
      {
        userId,
        year,
        bucket: 'BIRTHDAY',
        type: 'BIRTHDAY_ALLOWANCE',
        units: 2,
        reason: `Día de cumpleaños ${year}`,
        idempotencyKey: birthdayAllowanceKey(userId, year),
      },
    ],
    session,
  );
  return inserted.length > 0;
}

/**
 * Recalcula el derecho del año (alta, baja o cambio de días anuales) y registra la diferencia
 * como PRORATION_ADJUSTMENT. Solo actúa sobre años abiertos (con asignación) y no cerrados.
 * Devuelve la diferencia aplicada.
 */
export async function syncEntitlement(
  user: EntitlementUser,
  year: number,
  session: ClientSession,
  meta: { createdBy?: string | null; reason?: string } = {},
): Promise<number> {
  const userId = String(user._id);
  if (!(await isYearOpen(userId, year, session))) return 0;
  if ((await closedYears(userId, [year], session)).size) return 0;
  const granted = await sumByTypes(userId, year, 'CURRENT', ['ANNUAL_ALLOWANCE', 'PRORATION_ADJUSTMENT'], session);
  const target = activeInYear(user, year) ? entitlementFor(user, year) : 0;
  const diff = target - granted.units;
  if (diff === 0) return 0;
  await insertLedger(
    [
      {
        userId,
        year,
        bucket: 'CURRENT',
        type: 'PRORATION_ADJUSTMENT',
        units: diff,
        reason: meta.reason ?? `Prorrata ${year}`,
        createdBy: meta.createdBy ?? null,
        idempotencyKey: `proration:${userId}:${year}:${granted.count + 1}`,
      },
    ],
    session,
  );
  return diff;
}

/** Recalcula la prorrata en todos los años abiertos y no cerrados del usuario. */
export async function syncAllEntitlements(
  userId: string,
  years: number[],
  session: ClientSession,
  meta: { createdBy?: string | null; reason?: string } = {},
): Promise<Record<number, number>> {
  await lockUserYears(userId, years, session);
  const user = await User.findById(userId).session(session).lean();
  if (!user) return {};
  const out: Record<number, number> = {};
  for (const y of years) out[y] = await syncEntitlement(user, y, session, meta);
  return out;
}
