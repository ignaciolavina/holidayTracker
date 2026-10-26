import { yearOf, type ISODate } from '../dates';
import type { Bucket, RequestKind } from '../types';

/**
 * Orden de consumo (SPEC-07): cada día con fecha ≤ caducidad sale primero de CARRYOVER y después de CURRENT.
 * Los días posteriores a febrero siempre salen de CURRENT. El cumpleaños sale siempre de BIRTHDAY.
 */

export interface AllocationInput {
  kind: RequestKind;
  days: Array<{ date: ISODate; units: number }>;
  /** Arrastrados disponibles por año (ya descontado lo reservado si procede) */
  carryover: Record<number, { availableUnits: number; expiresOn: ISODate } | undefined>;
}

export interface AllocatedDay {
  date: ISODate;
  year: number;
  bucket: Bucket;
  units: number;
}

export interface AllocationTotal {
  year: number;
  bucket: Bucket;
  units: number;
}

export interface AllocationResult {
  perDay: AllocatedDay[];
  totals: AllocationTotal[];
  /** Hay arrastrados pero algún día va a CURRENT por ser posterior a la caducidad */
  usesCurrentWhileCarryoverAvailable: boolean;
}

const BUCKET_ORDER: Record<Bucket, number> = { CARRYOVER: 0, CURRENT: 1, BIRTHDAY: 2 };

export function allocateDays(input: AllocationInput): AllocationResult {
  const remaining = new Map<number, number>();
  for (const [y, c] of Object.entries(input.carryover)) if (c) remaining.set(Number(y), Math.max(0, c.availableUnits));

  const perDay: AllocatedDay[] = [];
  let usesCurrentWhileCarryoverAvailable = false;

  for (const day of input.days) {
    if (day.units <= 0) continue;
    const year = yearOf(day.date);
    if (input.kind === 'BIRTHDAY') {
      perDay.push({ date: day.date, year, bucket: 'BIRTHDAY', units: day.units });
      continue;
    }
    const co = input.carryover[year];
    let left = day.units;
    if (co && day.date <= co.expiresOn) {
      const avail = remaining.get(year) ?? 0;
      const take = Math.min(avail, left);
      if (take > 0) {
        perDay.push({ date: day.date, year, bucket: 'CARRYOVER', units: take });
        remaining.set(year, avail - take);
        left -= take;
      }
    } else if (co && (remaining.get(year) ?? 0) > 0) {
      usesCurrentWhileCarryoverAvailable = true;
    }
    if (left > 0) perDay.push({ date: day.date, year, bucket: 'CURRENT', units: left });
  }

  return { perDay, totals: totalsOf(perDay), usesCurrentWhileCarryoverAvailable };
}

export function totalsOf(perDay: Array<{ year: number; bucket: Bucket; units: number }>): AllocationTotal[] {
  const map = new Map<string, AllocationTotal>();
  for (const d of perDay) {
    const key = `${d.year}:${d.bucket}`;
    const t = map.get(key) ?? { year: d.year, bucket: d.bucket, units: 0 };
    t.units += d.units;
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => a.year - b.year || BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);
}
