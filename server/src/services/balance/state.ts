import type { ClientSession } from 'mongoose';
import {
  allocateDays,
  birthdayEligible,
  birthdayWindow,
  computeRequest,
  endOfYear,
  lastDayOfFebruary,
  startOfYear,
  yearOf,
  type AllocatedDay,
  type BalanceDto,
  type Bucket,
  type ISODate,
  type Settings,
} from '@ht/shared';
import { LedgerEntry, User, UserYear, VacationRequest } from '../../models';
import { clock } from '../../lib/clock';
import { notFound } from '../../lib/errors';
import { emptySums, ledgerSums, type BucketSums } from './ledger';
import { activeInYear, entitlementFor, isYearOpen, type EntitlementUser } from './entitlement';
import { getSettings } from '../settings';
import { holidaysFor } from '../holidays/query';

/**
 * Estado de saldo: ledger, reservado (pendientes) y disponible (SPEC-07).
 */

export interface StoredRequest {
  _id: { toString(): string };
  userId: { toString(): string };
  kind: 'VACATION' | 'BIRTHDAY';
  status: string;
  startDate: string;
  endDate: string;
  units: number;
  replacesRequestId?: { toString(): string } | null;
  revokedFromDate?: string | null;
  breakdown: { days: Array<{ date?: string | null; units?: number | null }>; allocation: AllocatedDay[] | unknown[] };
  createdAt?: Date;
}

export type CarryoverMap = Record<number, { availableUnits: number; expiresOn: ISODate } | undefined>;

export function allocationOf(r: StoredRequest): AllocatedDay[] {
  return (r.breakdown?.allocation ?? []) as AllocatedDay[];
}

export function daysOf(r: StoredRequest): Array<{ date: ISODate; units: number }> {
  return (r.breakdown?.days ?? [])
    .filter((d): d is { date: string; units: number } => !!d.date && typeof d.units === 'number')
    .map((d) => ({ date: d.date, units: d.units }));
}

export function carryoverMapFrom(sums: Map<number, BucketSums>, reservedCarry: Map<number, number> = new Map()): CarryoverMap {
  const out: CarryoverMap = {};
  for (const [year, s] of sums) {
    const avail = s.CARRYOVER - (reservedCarry.get(year) ?? 0);
    if (s.CARRYOVER > 0) out[year] = { availableUnits: Math.max(0, avail), expiresOn: lastDayOfFebruary(year) };
  }
  return out;
}

/**
 * Saldo del ledger más la proyección de los años todavía no abiertos (asignación prorrateada y cumpleaños),
 * para poder validar solicitudes a futuro sin escribir nada.
 */
export async function projectedSums(
  user: EntitlementUser,
  years: number[],
  session?: ClientSession,
  settings?: Settings,
): Promise<Map<number, BucketSums>> {
  const userId = String(user._id);
  const sums = await ledgerSums(userId, years, session);
  const s = settings ?? (await getSettings(session));
  for (const y of years) {
    if (await isYearOpen(userId, y, session)) continue;
    if (!activeInYear(user, y)) continue;
    const row = sums.get(y)!;
    row.CURRENT += entitlementFor(user, y);
    if (s.birthdayEnabled && user.birthday && birthdayEligible(y, user.birthday, user.hireDate, user.leaveDate)) {
      row.BIRTHDAY += 2;
    }
  }
  return sums;
}

export interface ReservedState {
  reserved: Map<number, BucketSums>;
  perRequest: Map<string, AllocatedDay[]>;
}

/**
 * Reservado por solicitudes pendientes, asignado con el mismo orden de consumo (arrastrados primero).
 * Las solicitudes que sustituyen a otra aprobada reservan solo la diferencia neta.
 */
export async function computeReserved(
  userId: string,
  sums: Map<number, BucketSums>,
  session?: ClientSession,
  opts: { excludeIds?: string[] } = {},
): Promise<ReservedState> {
  const pending = (await VacationRequest.find({ userId, status: 'PENDING' })
    .sort({ createdAt: 1 })
    .session(session ?? null)
    .lean()) as unknown as StoredRequest[];
  const reserved = new Map<number, BucketSums>();
  const perRequest = new Map<string, AllocatedDay[]>();
  const add = (y: number, b: Bucket, u: number) => {
    if (!reserved.has(y)) reserved.set(y, emptySums());
    reserved.get(y)![b] += u;
  };
  const reservedCarry = new Map<number, number>();
  const exclude = new Set(opts.excludeIds ?? []);
  for (const r of pending) {
    if (exclude.has(String(r._id))) continue;
    const years = [...new Set(daysOf(r).map((d) => yearOf(d.date)))];
    for (const y of years) if (!sums.has(y)) sums.set(y, emptySums());
    const alloc = allocateDays({ kind: r.kind, days: daysOf(r), carryover: carryoverMapFrom(sums, reservedCarry) });
    perRequest.set(String(r._id), alloc.perDay);
    for (const t of alloc.totals) {
      add(t.year, t.bucket, t.units);
      if (t.bucket === 'CARRYOVER') reservedCarry.set(t.year, (reservedCarry.get(t.year) ?? 0) + t.units);
    }
    if (r.replacesRequestId) {
      const original = (await VacationRequest.findById(r.replacesRequestId)
        .session(session ?? null)
        .lean()) as unknown as StoredRequest | null;
      if (original?.status === 'APPROVED') {
        for (const a of allocationOf(original)) add(a.year, a.bucket, -a.units);
      }
    }
  }
  return { reserved, perRequest };
}

export function availableTotal(sums: BucketSums | undefined, reserved: BucketSums | undefined): number {
  const s = sums ?? emptySums();
  const r = reserved ?? emptySums();
  return s.CURRENT + s.CARRYOVER - r.CURRENT - r.CARRYOVER;
}

/** DTO de saldo de un usuario en un año. */
export async function getBalance(userId: string, year: number): Promise<BalanceDto> {
  const user = await User.findById(userId).lean();
  if (!user) throw notFound('Usuario no encontrado.');
  const settings = await getSettings();
  const today = clock.today();
  const sums = await projectedSums(user, [year], undefined, settings);
  const { reserved } = await computeReserved(userId, sums);
  const s = sums.get(year) ?? emptySums();
  const r = reserved.get(year) ?? emptySums();
  const uy = await UserYear.findOne({ userId, year }).lean();

  const reqs = (await VacationRequest.find({
    userId,
    status: { $in: ['PENDING', 'APPROVED', 'REVOKED'] },
    startDate: { $lte: endOfYear(year) },
    endDate: { $gte: startOfYear(year) },
  }).lean()) as unknown as Array<StoredRequest & { halfDay?: unknown }>;

  let enjoyed = 0;
  let planned = 0;
  let pending = 0;
  for (const req of reqs) {
    for (const d of daysOf(req)) {
      if (yearOf(d.date) !== year || d.units === 0) continue;
      if (req.status === 'PENDING') pending += d.units;
      else if (req.status === 'REVOKED' && (!req.revokedFromDate || d.date >= req.revokedFromDate)) continue;
      else if (req.kind === 'VACATION' || req.kind === 'BIRTHDAY') {
        if (d.date <= today) enjoyed += d.units;
        else planned += d.units;
      }
    }
  }

  // cumpleaños
  let birthday: BalanceDto['birthday'] = { date: null, status: 'unset', requestId: null, window: null };
  if (!settings.birthdayEnabled) birthday = { ...birthday, status: 'disabled' };
  else if (user.birthday) {
    const hols = await holidaysFor(String(user.holidayCalendarId), startOfYear(year), endOfYear(year));
    const isComputable = (date: ISODate) => {
      try {
        return computeRequest({ startDate: date, endDate: date, holidays: hols, weekendDays: settings.weekendDays }).totalUnits > 0;
      } catch {
        return false;
      }
    };
    const w = birthdayWindow(year, user.birthday, settings.birthdayWindow, isComputable);
    const bReq = reqs.find((x) => x.kind === 'BIRTHDAY' && x.status !== 'REVOKED');
    const expired = await LedgerEntry.exists({ userId, year, type: 'BIRTHDAY_EXPIRY' });
    let status: BalanceDto['birthday']['status'];
    if (!birthdayEligible(year, user.birthday, user.hireDate, user.leaveDate)) status = 'not-eligible';
    else if (bReq?.status === 'APPROVED') status = bReq.startDate <= today ? 'enjoyed' : 'approved';
    else if (bReq?.status === 'PENDING') status = 'requested';
    else if (expired || uy?.closed || (s.BIRTHDAY <= 0 && year < yearOf(today))) status = 'expired';
    else status = 'available';
    birthday = {
      date: bReq?.startDate ?? w.birthday,
      status,
      requestId: bReq ? String(bReq._id) : null,
      window: { from: w.from, to: w.to, movable: w.movable },
    };
  }

  return {
    userId,
    year,
    ledger: { current: s.CURRENT, carryover: s.CARRYOVER, birthday: s.BIRTHDAY },
    reserved: { current: r.CURRENT, carryover: r.CARRYOVER, birthday: r.BIRTHDAY },
    available: {
      current: s.CURRENT - r.CURRENT,
      carryover: s.CARRYOVER - r.CARRYOVER,
      birthday: s.BIRTHDAY - r.BIRTHDAY,
      total: availableTotal(s, r),
    },
    enjoyedUnits: enjoyed,
    plannedUnits: planned,
    pendingUnits: pending,
    entitlementUnits: activeInYear(user, year) ? entitlementFor(user, year) : 0,
    carryoverExpiresOn: uy?.carryoverExpiresOn ?? lastDayOfFebruary(year),
    negativeLimitUnits: settings.negativeLimitUnits,
    yearClosed: !!uy?.closed,
    birthday,
  };
}
