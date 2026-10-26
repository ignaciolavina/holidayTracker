import { daysInMonth, dayOfWeek, formatDate, type ISODate } from '@ht/shared';
import { MONTH_NAMES, cap } from '@/lib/format';
import { DayCell } from './DayCell';
import type { DayInfo } from './model';

export const WEEK_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEK_HEADERS_LONG = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Hueco inicial (lunes = 0) de un mes */
export const leadingBlanks = (y: number, m: number) => (dayOfWeek(formatDate(y, m, 1)) + 6) % 7;

export function MiniMonth({
  year,
  month,
  lookup,
  onOpenMonth,
}: {
  year: number;
  month: number;
  lookup: (d: ISODate) => DayInfo;
  onOpenMonth: (m: number) => void;
}) {
  const n = daysInMonth(year, month);
  const blanks = leadingBlanks(year, month);
  return (
    <section aria-label={`${cap(MONTH_NAMES[month - 1]!)} ${year}`} className="rounded-lg border bg-card p-2" data-testid={`mini-month-${month}`}>
      <button type="button" onClick={() => onOpenMonth(month)} className="mb-1 w-full rounded px-1 text-left text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {cap(MONTH_NAMES[month - 1]!)}
      </button>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEK_HEADERS.map((h, i) => (
          <span key={i} aria-hidden className="text-center text-[10px] text-muted-foreground">
            {h}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: n }, (_, i) => (
          <DayCell key={i} size="sm" showTitle info={lookup(formatDate(year, month, i + 1))} />
        ))}
      </div>
    </section>
  );
}
