import type { CSSProperties } from 'react';
import { COLOR_TOKENS, type ColorKey } from '@ht/shared';
import { cn } from '@/lib/utils';
import type { DayInfo } from './model';
import { describeDay } from './model';
import { STRIPES } from './cellStyle';

const v = (k: string, p: 'bg' | 'fg' | 'border') => `var(--c-${k}-${p})`;
const iconOf = (k: ColorKey) => (COLOR_TOKENS[k] as { icon?: string }).icon ?? '';

export interface CellVisual {
  style: CSSProperties;
  icon: string;
  numberPos: 'center' | 'tl' | 'br';
}

function absenceKey(a: DayInfo['absences'][number]): ColorKey {
  if (a.kind === 'BIRTHDAY') return 'birthday';
  return a.bucket === 'CARRYOVER' ? 'carryover' : 'approved';
}

/** Traduce la información de un día a estilo + icono usando solo variables derivadas de COLOR_TOKENS. */
export function cellVisual(info: DayInfo): CellVisual {
  const full = info.absences.find((a) => a.units >= 2);
  const halves = info.absences.filter((a) => a.units === 1);
  if (full) {
    const key = absenceKey(full);
    if (full.status === 'PENDING') {
      const border = key === 'birthday' ? v('birthday', 'border') : v('pending', 'border');
      return {
        style: { backgroundImage: STRIPES('pending'), border: `2px dashed ${border}`, color: v('pending', 'fg') },
        icon: key === 'birthday' ? '🎂' : iconOf('pending'),
        numberPos: 'center',
      };
    }
    return { style: { backgroundColor: v(key, 'bg'), color: v(key, 'fg'), border: `1px solid ${v(key, 'border')}` }, icon: iconOf(key), numberPos: 'center' };
  }
  if (halves.length) {
    const layers = halves.map((h) => {
      const c = h.status === 'PENDING' ? v('pending', 'bg') : v(absenceKey(h), 'bg');
      return h.period === 'PM' ? `linear-gradient(to bottom right, transparent 50%, ${c} 50%)` : `linear-gradient(to bottom right, ${c} 50%, transparent 50%)`;
    });
    const anyPending = halves.some((h) => h.status === 'PENDING');
    const first = halves[0]!;
    const amPresent = halves.some((h) => h.period !== 'PM');
    const fk = anyPending ? 'pending' : absenceKey(first);
    return {
      style: {
        backgroundImage: layers.join(','),
        border: anyPending ? `2px dashed ${v('pending', 'border')}` : `1px solid ${v(fk, 'border')}`,
        color: amPresent ? v(fk, 'fg') : v(fk, 'fg'),
      },
      icon: halves.some((h) => h.kind === 'BIRTHDAY') ? '🎂' : iconOf('halfDay'),
      numberPos: halves.length > 1 ? 'center' : amPresent ? 'tl' : 'br',
    };
  }
  if (info.holiday) {
    const k = (info.holiday.scope === 'national' ? 'holidayNational' : info.holiday.scope === 'regional' ? 'holidayRegional' : 'holidayLocal') as ColorKey;
    return { style: { backgroundColor: v(k, 'bg'), color: v(k, 'fg'), border: `1px solid ${v(k, 'border')}` }, icon: iconOf(k), numberPos: 'center' };
  }
  if (info.birthdayMark) {
    return { style: { border: `2px solid ${v('birthday', 'border')}` }, icon: '🎂', numberPos: 'center' };
  }
  if (info.weekend) {
    return { style: { backgroundColor: v('weekend', 'bg'), color: v('weekend', 'fg'), border: `1px solid ${v('weekend', 'border')}` }, icon: '', numberPos: 'center' };
  }
  return { style: { border: '1px solid transparent' }, icon: '', numberPos: 'center' };
}

export interface DayCellProps {
  info: DayInfo;
  size: 'sm' | 'lg';
  selected?: boolean;
  disabled?: boolean;
  onMouseDown?: () => void;
  onMouseEnter?: () => void;
  onClick?: (detail: number) => void;
  showTitle?: boolean;
}

export function DayCell({ info, size, selected, disabled, onMouseDown, onMouseEnter, onClick, showTitle }: DayCellProps) {
  const vis = cellVisual(info);
  const lines = describeDay(info);
  const day = Number(info.date.slice(8));
  const style: CSSProperties = { ...vis.style };
  if (info.isToday) style.boxShadow = `inset 0 0 0 2px ${v('today', 'border')}`;
  const lg = size === 'lg';
  return (
    <button
      type="button"
      data-testid={`day-${info.date}`}
      data-date={info.date}
      aria-label={lines.join('. ')}
      title={showTitle ? lines.join('\n') : undefined}
      aria-current={info.isToday ? 'date' : undefined}
      aria-pressed={selected || undefined}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onClick={(e) => onClick?.(e.detail)}
      style={style}
      className={cn(
        'relative select-none overflow-hidden rounded text-center font-medium focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        lg ? 'h-16 text-sm sm:h-20' : 'aspect-square text-[11px] leading-none',
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        disabled ? 'cursor-default opacity-60' : onClick && 'cursor-pointer hover:brightness-95',
      )}
    >
      <span
        className={cn(
          'absolute',
          vis.numberPos === 'center' && 'inset-0 flex items-center justify-center',
          vis.numberPos === 'tl' && (lg ? 'left-1.5 top-1' : 'left-0.5 top-0.5'),
          vis.numberPos === 'br' && (lg ? 'bottom-1 right-1.5' : 'bottom-0.5 right-0.5'),
        )}
      >
        {day}
      </span>
      {vis.icon && (
        <span aria-hidden className={cn('absolute', lg ? 'right-1 top-0.5 text-xs' : 'right-px top-px text-[7px]')}>
          {vis.icon}
        </span>
      )}
      {info.isToday && <span className="sr-only">hoy</span>}
    </button>
  );
}
