import { addDays, birthdayInYear, endOfYear, formatDate, daysInMonth, maxDate, minDate, startOfYear, type ISODate } from '../dates';
import type { BirthdayWindowMode } from '../types';

/** Reglas del día de cumpleaños (SPEC-08). */

/** Le corresponde el día ese año si estaba activo el día de su cumpleaños. */
export function birthdayEligible(year: number, mmdd: string, hireDate: ISODate, leaveDate?: ISODate | null): boolean {
  const bday = birthdayInYear(mmdd, year);
  if (bday < hireDate) return false;
  if (leaveDate && bday > leaveDate) return false;
  return true;
}

export interface BirthdayWindow {
  birthday: ISODate;
  /** true si el cumpleaños cae en fin de semana o festivo y se puede mover */
  movable: boolean;
  from: ISODate;
  to: ISODate;
}

export function birthdayWindow(
  year: number,
  mmdd: string,
  window: { mode: BirthdayWindowMode; days: number },
  isComputable: (date: ISODate) => boolean,
): BirthdayWindow {
  const birthday = birthdayInYear(mmdd, year);
  if (isComputable(birthday)) return { birthday, movable: false, from: birthday, to: birthday };
  const m = Number(birthday.slice(5, 7));
  let from: ISODate;
  let to: ISODate;
  switch (window.mode) {
    case 'sameMonth':
      from = formatDate(year, m, 1);
      to = formatDate(year, m, daysInMonth(year, m));
      break;
    case 'plusMinusDays':
      from = maxDate(startOfYear(year), addDays(birthday, -window.days));
      to = minDate(endOfYear(year), addDays(birthday, window.days));
      break;
    case 'year':
      from = startOfYear(year);
      to = endOfYear(year);
      break;
  }
  return { birthday, movable: true, from, to };
}

export type BirthdayDateError = 'BIRTHDAY_MUST_BE_EXACT' | 'BIRTHDAY_OUT_OF_WINDOW' | 'BIRTHDAY_NOT_COMPUTABLE';

export function validateBirthdayDate(
  date: ISODate,
  w: BirthdayWindow,
  isComputable: (date: ISODate) => boolean,
): BirthdayDateError | null {
  if (!w.movable) return date === w.birthday ? null : 'BIRTHDAY_MUST_BE_EXACT';
  if (date < w.from || date > w.to) return 'BIRTHDAY_OUT_OF_WINDOW';
  if (!isComputable(date)) return 'BIRTHDAY_NOT_COMPUTABLE';
  return null;
}
