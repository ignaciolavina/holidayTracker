import type { CSSProperties } from 'react';
import type { ColorKey } from '@ht/shared';

const v = (k: ColorKey | string, part: 'bg' | 'fg' | 'border') => `var(--c-${k}-${part})`;

export const STRIPES = (k: ColorKey | string) =>
  `repeating-linear-gradient(45deg, ${v(k, 'bg')} 0 4px, transparent 4px 8px)`;

/** Estilo del cuadradito de la leyenda: refleja exactamente el tratamiento de las celdas. */
export function swatchStyle(k: ColorKey): CSSProperties {
  const base: CSSProperties = { color: v(k, 'fg'), border: `2px solid ${v(k, 'border')}` };
  switch (k) {
    case 'pending':
      return { ...base, backgroundImage: STRIPES('pending'), border: `2px dashed ${v('pending', 'border')}`, color: v('pending', 'fg') };
    case 'halfDay':
      return { ...base, backgroundImage: `linear-gradient(to bottom right, ${v('halfDay', 'bg')} 50%, transparent 50%)`, color: 'inherit' };
    case 'weekend':
      return { backgroundColor: v('weekend', 'bg'), color: v('weekend', 'fg'), border: `1px solid ${v('weekend', 'border')}` };
    case 'today':
      return { background: 'transparent', color: 'inherit', boxShadow: `0 0 0 2px ${v('today', 'border')}`, border: '1px solid transparent' };
    case 'negative':
      return { backgroundColor: v('negative', 'bg'), color: v('negative', 'fg'), border: `1px solid ${v('negative', 'border')}` };
    default:
      return { ...base, backgroundColor: v(k, 'bg') };
  }
}
