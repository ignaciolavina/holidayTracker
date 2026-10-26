import { useEffect, useRef, useState } from 'react';
import { daysInMonth, formatDate, type ISODate } from '@ht/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DayCell } from './DayCell';
import { WEEK_HEADERS_LONG, leadingBlanks } from './MiniMonth';
import { describeDay, type DayInfo } from './model';

/** Vista mensual grande. Clic en un día o arrastre de un rango → onSelect(inicio, fin). */
export function MonthGrid({
  year,
  month,
  lookup,
  onSelect,
}: {
  year: number;
  month: number;
  lookup: (d: ISODate) => DayInfo;
  /** si no se pasa, la vista es de solo lectura */
  onSelect?: (start: ISODate, end: ISODate) => void;
}) {
  const [anchor, setAnchor] = useState<ISODate | null>(null);
  const [hover, setHover] = useState<ISODate | null>(null);
  const anchorRef = useRef<ISODate | null>(null);
  const hoverRef = useRef<ISODate | null>(null);
  anchorRef.current = anchor;
  hoverRef.current = hover;

  useEffect(() => {
    const up = () => {
      const a = anchorRef.current;
      if (!a) return;
      const h = hoverRef.current ?? a;
      setAnchor(null);
      setHover(null);
      onSelect?.(a < h ? a : h, a < h ? h : a);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [onSelect]);

  const lo = anchor && hover ? (anchor < hover ? anchor : hover) : anchor;
  const hi = anchor && hover ? (anchor < hover ? hover : anchor) : anchor;
  const n = daysInMonth(year, month);
  const blanks = leadingBlanks(year, month);

  return (
    <div className="overflow-x-auto" data-testid="month-grid">
      <div className="grid min-w-[560px] grid-cols-7 gap-1">
        {WEEK_HEADERS_LONG.map((h) => (
          <span key={h} className="pb-1 text-center text-xs font-medium text-muted-foreground">
            {h}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: n }, (_, i) => {
          const date = formatDate(year, month, i + 1);
          const info = lookup(date);
          const selectable = !!onSelect && !info.isPast;
          const selected = !!lo && !!hi && date >= lo && date <= hi;
          return (
            <Tooltip key={date}>
              <TooltipTrigger asChild>
                <div>
                  <DayCell
                    info={info}
                    size="lg"
                    selected={selected}
                    disabled={!selectable}
                    onMouseDown={selectable ? () => { setAnchor(date); setHover(date); } : undefined}
                    onMouseEnter={selectable && anchor ? () => setHover(date) : undefined}
                    onClick={selectable ? (detail) => { if (detail === 0) onSelect?.(date, date); } : undefined}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {describeDay(info).map((l, k) => (
                  <p key={k} className={k === 0 ? 'font-semibold' : undefined}>
                    {l}
                  </p>
                ))}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
