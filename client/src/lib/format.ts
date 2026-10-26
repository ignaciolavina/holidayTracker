import { formatDateEs, formatUnits, parseDate, dayOfWeek, type ISODate, type Bucket, type RequestStatus } from '@ht/shared';

/** Las cantidades de la API son medios días; aquí se convierten a días para mostrarlas. */
export const days = (units: number) => formatUnits(units);
export const daysLabel = (units: number) => `${formatUnits(units)} ${Math.abs(units) === 2 ? 'día' : 'días'}`;
/** con signo explícito: +1,5 / −2 */
export const signedDays = (units: number) => `${units > 0 ? '+' : units < 0 ? '−' : ''}${formatUnits(Math.abs(units))}`;

export const fmtDate = (d: ISODate, withYear = true) => formatDateEs(d, withYear);

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const weekdayName = (d: ISODate) => WEEKDAYS[dayOfWeek(d)]!;
export const weekdayShort = (d: ISODate) => WEEKDAYS_SHORT[dayOfWeek(d)]!;
export const fmtDateLong = (d: ISODate) => `${weekdayName(d)}, ${formatDateEs(d)}`;
export function fmtDateShort(d: ISODate) {
  const p = parseDate(d);
  return p ? `${weekdayShort(d)} ${p.d}/${String(p.m).padStart(2, '0')}` : d;
}
export function fmtRange(start: ISODate, end: ISODate) {
  return start === end ? fmtDate(start) : `${fmtDate(start, false)} – ${fmtDate(end)}`;
}
export function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada',
  REVOKED: 'Anulada',
};
export const STATUS_ICON: Record<RequestStatus, string> = {
  PENDING: '⏳',
  APPROVED: '✓',
  REJECTED: '✕',
  CANCELLED: '∅',
  REVOKED: '⊘',
};
export const BUCKET_LABEL: Record<Bucket, string> = {
  CURRENT: 'días del año',
  CARRYOVER: 'días arrastrados',
  BIRTHDAY: 'día de cumpleaños',
};
export const KIND_LABEL = { VACATION: 'Vacaciones', BIRTHDAY: 'Cumpleaños' } as const;
export const PERIOD_LABEL = { AM: 'mañana', PM: 'tarde' } as const;
export const REASON_LABEL: Record<string, string> = {
  weekend: 'Fin de semana',
  'holiday-national': 'Festivo nacional',
  'holiday-regional': 'Festivo autonómico',
  'holiday-local': 'Festivo local',
};
export const BIRTHDAY_STATUS_LABEL: Record<string, string> = {
  unset: 'Sin fecha de cumpleaños',
  'not-eligible': 'No te corresponde este año',
  available: 'Disponible',
  requested: 'Solicitado',
  approved: 'Aprobado',
  enjoyed: 'Disfrutado',
  expired: 'Caducado',
  disabled: 'Desactivado',
};
export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
