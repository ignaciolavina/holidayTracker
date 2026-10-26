import { COLOR_TOKENS, LEGEND_ORDER, type ColorKey } from '@ht/shared';
import { cn } from '@/lib/utils';
import { swatchStyle } from '@/components/calendar/cellStyle';

/** Leyenda siempre visible en las vistas de calendario (SPEC-19). Los colores salen de COLOR_TOKENS. */
export function Legend({ className, keys = LEGEND_ORDER }: { className?: string; keys?: ColorKey[] }) {
  return (
    <section aria-label="Leyenda de colores" data-testid="legend" className={cn('rounded-lg border bg-card p-3', className)}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leyenda</h2>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {keys.map((k) => {
          const t = COLOR_TOKENS[k] as { key: string; label: string; icon?: string; marker: string };
          return (
            <li key={k} className="flex items-center gap-2" data-testid={`legend-${k}`}>
              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold" style={swatchStyle(k)}>
                {t.icon ?? ''}
              </span>
              <span>
                {t.label}
                <span className="sr-only"> ({t.marker})</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
