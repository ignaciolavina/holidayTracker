import { addDays, daysInYear, diffDays, endOfYear, maxDate, minDate, startOfYear, type ISODate } from '../dates';

/** Prorrata por alta, baja o cambio de días anuales (SPEC-07). Unidades = medios días. */

export interface AnnualHistoryEntry {
  /** Desde qué fecha aplica este valor de días anuales */
  from: ISODate;
  units: number;
}

export interface EntitlementInput {
  hireDate: ISODate;
  leaveDate?: ISODate | null;
  annualHistory: AnnualHistoryEntry[];
}

/** Días activos del usuario en un año (inclusivo). */
export function activeDaysInYear(year: number, hireDate: ISODate, leaveDate?: ISODate | null): number {
  const from = maxDate(startOfYear(year), hireDate);
  const to = leaveDate ? minDate(endOfYear(year), leaveDate) : endOfYear(year);
  if (to < from) return 0;
  return diffDays(from, to) + 1;
}

/** `annual × activos / días_del_año`, redondeado al medio día (unidad) más cercano. */
export function prorate(annualUnits: number, activeDays: number, yearDays: number): number {
  return Math.round((annualUnits * activeDays) / yearDays);
}

/** Derecho anual del usuario en un año, con prorrata por tramos de días anuales. */
export function entitlementUnits(year: number, input: EntitlementInput): number {
  const yearDays = daysInYear(year);
  const history = [...input.annualHistory].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  if (!history.length) return 0;

  const activeFrom = maxDate(startOfYear(year), input.hireDate);
  const activeTo = input.leaveDate ? minDate(endOfYear(year), input.leaveDate) : endOfYear(year);
  if (activeTo < activeFrom) return 0;

  let weighted = 0;
  for (let i = 0; i < history.length; i++) {
    const segStart = i === 0 ? activeFrom : maxDate(activeFrom, history[i]!.from);
    const next = history[i + 1];
    const segEnd = next ? minDate(activeTo, addDays(next.from, -1)) : activeTo;
    if (segEnd < segStart) continue;
    weighted += history[i]!.units * (diffDays(segStart, segEnd) + 1);
  }
  return Math.round(weighted / yearDays);
}

