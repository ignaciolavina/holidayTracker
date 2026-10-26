/**
 * Fechas de calendario como string `YYYY-MM-DD`, sin zonas horarias.
 * Toda la aritmética se hace en UTC puro para que los cambios de hora no afecten.
 */

export type ISODate = string; // YYYY-MM-DD

export const MADRID_TZ = 'Europe/Madrid';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MMDD_RE = /^(\d{2})-(\d{2})$/;

export function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidDate(date: unknown): date is ISODate {
  return typeof date === 'string' && parseDate(date) !== null;
}

export function isValidMonthDay(mmdd: unknown): mmdd is string {
  if (typeof mmdd !== 'string') return false;
  const match = MMDD_RE.exec(mmdd);
  if (!match) return false;
  const m = Number(match[1]);
  const d = Number(match[2]);
  // 29-02 se admite (se trata como 28-02 en años no bisiestos)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(2028, m);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

export function daysInYear(y: number): number {
  return isLeapYear(y) ? 366 : 365;
}

export function formatDate(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toEpochDay(date: ISODate): number {
  const p = parseDate(date);
  if (!p) throw new Error(`Fecha inválida: ${date}`);
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
}

function fromEpochDay(n: number): ISODate {
  const dt = new Date(n * 86_400_000);
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromEpochDay(toEpochDay(date) + n);
}

/** Días entre dos fechas (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** 0 = domingo … 6 = sábado */
export function dayOfWeek(date: ISODate): number {
  // el 1970-01-01 fue jueves (4)
  return (((toEpochDay(date) % 7) + 7 + 4) % 7);
}

export function yearOf(date: ISODate): number {
  return Number(date.slice(0, 4));
}

export function monthOf(date: ISODate): number {
  return Number(date.slice(5, 7));
}

/** Rango inclusivo de fechas. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const a = toEpochDay(start);
  const b = toEpochDay(end);
  for (let i = a; i <= b; i++) out.push(fromEpochDay(i));
  return out;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function startOfYear(y: number): ISODate {
  return formatDate(y, 1, 1);
}

export function endOfYear(y: number): ISODate {
  return formatDate(y, 12, 31);
}

/** Último día de febrero (28 o 29): caducidad de los arrastrados. */
export function lastDayOfFebruary(y: number): ISODate {
  return formatDate(y, 2, isLeapYear(y) ? 29 : 28);
}

/** Fecha del cumpleaños `MM-DD` en un año; el 29-02 pasa a 28-02 en años no bisiestos. */
export function birthdayInYear(mmdd: string, y: number): ISODate {
  const m = Number(mmdd.slice(0, 2));
  let d = Number(mmdd.slice(3, 5));
  if (m === 2 && d === 29 && !isLeapYear(y)) d = 28;
  return formatDate(y, m, d);
}

/** Fecha actual en Europe/Madrid para un instante dado. Única forma de obtener "hoy". */
export function todayMadrid(now: Date): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hora (0-23) en Madrid para un instante dado. */
export function hourMadrid(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: MADRID_TZ, hour: '2-digit', hourCycle: 'h23' }).format(now),
  );
}

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function monthNameEs(m: number): string {
  return MONTHS_ES[m - 1]!;
}

/** "28 de febrero de 2027" */
export function formatDateEs(date: ISODate, withYear = true): string {
  const p = parseDate(date);
  if (!p) return date;
  return `${p.d} de ${MONTHS_ES[p.m - 1]}${withYear ? ` de ${p.y}` : ''}`;
}
