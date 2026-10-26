import { dayOfWeek, type CalendarAbsence, type HolidayScope, type ISODate, type UserCalendarDto, type VacationRequestDto } from '@ht/shared';
import { KIND_LABEL, PERIOD_LABEL, STATUS_LABEL, fmtDateLong } from '@/lib/format';

export interface DayInfo {
  date: ISODate;
  weekend: boolean;
  holiday: { name: string; scope: HolidayScope } | null;
  absences: CalendarAbsence[];
  /** es la fecha de cumpleaños del usuario (aunque no se haya pedido) */
  birthdayMark: boolean;
  isToday: boolean;
  isPast: boolean;
  requests: VacationRequestDto[];
}

export const SCOPE_LABEL: Record<HolidayScope, string> = { national: 'nacional', regional: 'autonómico', local: 'local' };

/** Construye el acceso O(1) a la información de cada día desde el DTO de la API. */
export function makeDayLookup(dto: UserCalendarDto | undefined, weekendDays: number[], todayStr: ISODate) {
  const holidays = new Map<string, { name: string; scope: HolidayScope }>();
  for (const h of dto?.holidays ?? []) holidays.set(h.date, { name: h.name, scope: h.scope });
  const abs = new Map<string, CalendarAbsence[]>();
  for (const a of dto?.absences ?? []) abs.set(a.date, [...(abs.get(a.date) ?? []), a]);
  const reqs = new Map<string, VacationRequestDto>();
  for (const r of dto?.requests ?? []) reqs.set(r.id, r);
  return (date: ISODate): DayInfo => {
    const absences = abs.get(date) ?? [];
    return {
      date,
      weekend: weekendDays.includes(dayOfWeek(date)),
      holiday: holidays.get(date) ?? null,
      absences,
      birthdayMark: dto?.birthdayDate === date,
      isToday: date === todayStr,
      isPast: date < todayStr,
      requests: absences.map((a) => reqs.get(a.requestId)).filter((r): r is VacationRequestDto => !!r),
    };
  };
}

/** Texto accesible/tooltip de un día: no depende del color. */
export function describeDay(info: DayInfo): string[] {
  const lines = [fmtDateLong(info.date) + (info.isToday ? ' (hoy)' : '')];
  if (info.holiday) lines.push(`Festivo ${SCOPE_LABEL[info.holiday.scope]}: ${info.holiday.name}`);
  else if (info.weekend) lines.push('Fin de semana');
  for (const a of info.absences) {
    const req = info.requests.find((r) => r.id === a.requestId);
    const parts = [
      KIND_LABEL[a.kind],
      a.units === 1 ? `medio día${a.period ? ` (${PERIOD_LABEL[a.period]})` : ''}` : 'día completo',
      a.status === 'PENDING' ? STATUS_LABEL.PENDING.toLowerCase() : STATUS_LABEL.APPROVED.toLowerCase(),
    ];
    if (a.bucket === 'CARRYOVER') parts.push('de días arrastrados');
    if (a.bucket === 'BIRTHDAY' && a.kind !== 'BIRTHDAY') parts.push('cumpleaños');
    let line = parts.join(' · ');
    if (req?.comment) line += ` — «${req.comment}»`;
    lines.push(line);
  }
  if (info.birthdayMark && !info.absences.some((a) => a.kind === 'BIRTHDAY')) lines.push('Tu cumpleaños 🎂');
  return lines;
}
