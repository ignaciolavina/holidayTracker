import { dayOfWeek, eachDay, isValidDate, yearOf, type ISODate } from '../dates';
import type { HalfDayPeriod, HolidayScope } from '../types';
import { formatUnits } from '../units';

/** Motor de cómputo de días (SPEC-06). Función pura: sin base de datos ni zonas horarias. */

export type DayReason = 'weekend' | 'holiday-national' | 'holiday-regional' | 'holiday-local';

export interface EngineHoliday {
  date: ISODate;
  scope: HolidayScope;
  name?: string;
}

export interface ComputeInput {
  startDate: ISODate;
  endDate: ISODate;
  halfDay?: { date: ISODate; period: HalfDayPeriod } | null;
  holidays: EngineHoliday[];
  /** 0 = domingo … 6 = sábado */
  weekendDays?: number[];
  /**
   * Recalcular solicitudes ya existentes (p. ej. al cambiar un festivo): no falla si el medio día deja de ser
   * computable ni si el total queda en 0.
   */
  lenient?: boolean;
}

export interface ComputedDay {
  date: ISODate;
  units: 0 | 1 | 2;
  reason?: DayReason;
  period?: HalfDayPeriod;
}

export interface Computation {
  days: ComputedDay[];
  totalUnits: number;
  calendarDays: number;
  weekendCount: number;
  holidayCount: number;
}

export type EngineErrorCode =
  | 'INVALID_DATE'
  | 'INVERTED_RANGE'
  | 'HALF_DAY_OUT_OF_RANGE'
  | 'HALF_DAY_NOT_AT_EDGE'
  | 'HALF_DAY_NOT_COMPUTABLE'
  | 'NOTHING_TO_COMPUTE'
  | 'RANGE_TOO_LONG';

const MESSAGES: Record<EngineErrorCode, string> = {
  INVALID_DATE: 'La fecha no es válida (formato AAAA-MM-DD).',
  INVERTED_RANGE: 'La fecha de fin no puede ser anterior a la de inicio.',
  HALF_DAY_OUT_OF_RANGE: 'El medio día tiene que estar dentro del rango solicitado.',
  HALF_DAY_NOT_AT_EDGE: 'En un rango de varios días, el medio día solo puede ser el primero o el último.',
  HALF_DAY_NOT_COMPUTABLE: 'El medio día tiene que caer en un día laborable.',
  NOTHING_TO_COMPUTE: 'El rango elegido no incluye ningún día laborable: no computa nada.',
  RANGE_TOO_LONG: 'El rango es demasiado largo.',
};

export class EngineError extends Error {
  constructor(public readonly code: EngineErrorCode) {
    super(MESSAGES[code]);
    this.name = 'EngineError';
  }
}

const SCOPE_RANK: Record<HolidayScope, number> = { national: 3, regional: 2, local: 1 };

export const MAX_RANGE_DAYS = 800;

export function computeRequest(input: ComputeInput): Computation {
  const { startDate, endDate, halfDay, holidays } = input;
  const weekendDays = input.weekendDays ?? [6, 0];

  if (!isValidDate(startDate) || !isValidDate(endDate)) throw new EngineError('INVALID_DATE');
  if (endDate < startDate) throw new EngineError('INVERTED_RANGE');
  if (halfDay && !isValidDate(halfDay.date)) throw new EngineError('INVALID_DATE');

  const range = eachDay(startDate, endDate);
  if (range.length > MAX_RANGE_DAYS) throw new EngineError('RANGE_TOO_LONG');

  if (halfDay) {
    if (halfDay.date < startDate || halfDay.date > endDate) throw new EngineError('HALF_DAY_OUT_OF_RANGE');
    if (halfDay.date !== startDate && halfDay.date !== endDate) throw new EngineError('HALF_DAY_NOT_AT_EDGE');
  }

  // Si hay dos festivos el mismo día, gana el de mayor ámbito
  const holidayByDate = new Map<ISODate, EngineHoliday>();
  for (const h of holidays) {
    const prev = holidayByDate.get(h.date);
    if (!prev || SCOPE_RANK[h.scope] > SCOPE_RANK[prev.scope]) holidayByDate.set(h.date, h);
  }

  const days: ComputedDay[] = [];
  let totalUnits = 0;
  let weekendCount = 0;
  let holidayCount = 0;

  for (const date of range) {
    if (weekendDays.includes(dayOfWeek(date))) {
      weekendCount++;
      days.push({ date, units: 0, reason: 'weekend' });
      continue;
    }
    const holiday = holidayByDate.get(date);
    if (holiday) {
      holidayCount++;
      days.push({ date, units: 0, reason: `holiday-${holiday.scope}` });
      continue;
    }
    if (halfDay && halfDay.date === date) {
      days.push({ date, units: 1, period: halfDay.period });
      totalUnits += 1;
    } else {
      days.push({ date, units: 2 });
      totalUnits += 2;
    }
  }

  if (halfDay && !input.lenient) {
    const d = days.find((x) => x.date === halfDay.date)!;
    if (d.units === 0) throw new EngineError('HALF_DAY_NOT_COMPUTABLE');
  }
  if (totalUnits === 0 && !input.lenient) throw new EngineError('NOTHING_TO_COMPUTE');

  return { days, totalUnits, calendarDays: range.length, weekendCount, holidayCount };
}

/** Las solicitudes que cruzan de año se descuentan del saldo de cada año. */
export function splitByYear(c: Pick<Computation, 'days'>): Array<{ year: number; units: number }> {
  const map = new Map<number, number>();
  for (const d of c.days) {
    const y = yearOf(d.date);
    map.set(y, (map.get(y) ?? 0) + d.units);
  }
  return [...map.entries()]
    .filter(([, units]) => units > 0)
    .sort(([a], [b]) => a - b)
    .map(([year, units]) => ({ year, units }));
}

/** "10 días naturales → 6 laborables (2 festivos, 2 fines de semana)" */
export function describeComputation(c: Computation): string {
  const natural = `${c.calendarDays} ${c.calendarDays === 1 ? 'día natural' : 'días naturales'}`;
  const extras: string[] = [];
  if (c.holidayCount) extras.push(`${c.holidayCount} ${c.holidayCount === 1 ? 'festivo' : 'festivos'}`);
  if (c.weekendCount)
    extras.push(`${c.weekendCount} ${c.weekendCount === 1 ? 'día de fin de semana' : 'fines de semana'}`);
  const working = `${formatUnits(c.totalUnits)} laborables`;
  return `${natural} → ${working}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}
