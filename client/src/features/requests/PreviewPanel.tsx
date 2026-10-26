import type { RequestPreview } from '@ht/shared';
import { Alert } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BUCKET_LABEL, PERIOD_LABEL, REASON_LABEL, days, daysLabel, fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';

const isNegative = (m: { code: string; message: string }) => /NEGATIVE|NEGATIV/i.test(m.code) || /negativ/i.test(m.message);

/** Previsualización del cómputo que devuelve el servidor (POST /requests/preview). Aquí no se calcula nada. */
export function PreviewPanel({ preview, stale }: { preview: RequestPreview; stale?: boolean }) {
  const c = preview.computation;
  return (
    <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')} data-testid="preview" aria-busy={stale}>
      {preview.errors.map((e, i) => (
        <Alert key={i} variant="destructive" data-testid="preview-error">
          {e.message}
        </Alert>
      ))}
      {preview.warnings.map((w, i) =>
        isNegative(w) ? (
          <Alert key={i} variant="destructive" title="Saldo negativo" data-testid="preview-warning-negative">
            {w.message}
          </Alert>
        ) : (
          <Alert key={i} variant="warning" data-testid="preview-warning">
            {w.message}
          </Alert>
        ),
      )}

      {c && (
        <>
          <p className="text-base font-semibold" data-testid="preview-summary">
            {c.summary}
          </p>
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Día</TableHead>
                  <TableHead>Computa</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.days.map((d) => (
                  <TableRow key={d.date} className={cn(d.units === 0 && 'text-muted-foreground')} data-testid={`preview-day-${d.date}`}>
                    <TableCell className="whitespace-nowrap">{fmtDateShort(d.date)}</TableCell>
                    <TableCell>
                      {d.units === 0 ? '—' : d.units === 1 ? `Medio día${d.period ? ` (${PERIOD_LABEL[d.period]})` : ''}` : '1 día'}
                    </TableCell>
                    <TableCell>{d.reason ? REASON_LABEL[d.reason] ?? d.reason : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {preview.allocation.length > 0 && (
            <div data-testid="preview-allocation">
              <h3 className="mb-1 text-sm font-semibold">De dónde salen los días</h3>
              <ul className="space-y-0.5 text-sm">
                {preview.allocation.map((a, i) => (
                  <li key={i}>
                    {daysLabel(a.units)} de {BUCKET_LABEL[a.bucket]} de {a.year}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.balanceByYear.length > 0 && (
            <div data-testid="preview-balance">
              <h3 className="mb-1 text-sm font-semibold">Saldo disponible antes y después</h3>
              <ul className="space-y-0.5 text-sm">
                {preview.balanceByYear.map((b) => (
                  <li key={b.year}>
                    {b.year}: {days(b.availableBeforeUnits)} →{' '}
                    <strong className={cn(b.availableAfterUnits < 0 && 'text-destructive')}>
                      {b.availableAfterUnits < 0 && <span aria-hidden>− </span>}
                      {days(Math.abs(b.availableAfterUnits))}
                      {b.availableAfterUnits < 0 && ' (negativo)'}
                    </strong>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">Límite de saldo negativo: −{daysLabel(preview.negativeLimitUnits)}.</p>
            </div>
          )}
        </>
      )}

      {preview.teamOverlap.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Coincidencias con tu equipo: {preview.teamOverlap.map((t) => `${fmtDateShort(t.date)} (${t.count})`).join(', ')}.
        </p>
      )}
    </div>
  );
}
