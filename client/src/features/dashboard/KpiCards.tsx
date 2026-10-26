import type { ReactNode } from 'react';
import { diffDays, type BalanceDto } from '@ht/shared';
import { Card } from '@/components/ui/card';
import { BIRTHDAY_STATUS_LABEL, days, daysLabel, fmtDate } from '@/lib/format';
import { today } from '@/lib/today';
import { cn } from '@/lib/utils';

function Kpi({ id, title, value, children, style, className }: { id: string; title: string; value: ReactNode; children?: ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <Card className={cn('p-4', className)} style={style} data-testid={`kpi-${id}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" data-testid={`kpi-${id}-value`}>
        {value}
      </p>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">{children}</div>
    </Card>
  );
}

export function KpiCards({ balance: b }: { balance: BalanceDto }) {
  const now = today();
  const left = diffDays(now, b.carryoverExpiresOn);
  const expired = left < 0;
  const negative = b.available.total < 0;
  const bd = b.birthday;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="kpis">
      <Kpi id="available" title={`Disponibles ${b.year}`} value={days(b.available.current)}>
        <p>de {days(b.entitlementUnits)} días del año</p>
        {b.reserved.current > 0 && <p>{days(b.reserved.current)} reservados por pendientes</p>}
      </Kpi>

      <Kpi
        id="carryover"
        title="Arrastrados"
        value={
          <span>
            <span aria-hidden className="mr-1">↻</span>
            {days(b.available.carryover)}
          </span>
        }
        style={{ borderColor: 'var(--c-carryover-border)', borderLeftWidth: 4 }}
      >
        {b.available.carryover > 0 && !expired ? (
          <>
            <p>Caducan el {fmtDate(b.carryoverExpiresOn)}</p>
            <p className="font-medium text-foreground">{left === 0 ? 'Caducan hoy' : `Quedan ${left} ${left === 1 ? 'día' : 'días'}`}</p>
          </>
        ) : (
          <p>{expired ? 'Ya han caducado' : 'Sin arrastrados'}</p>
        )}
      </Kpi>

      <Kpi id="birthday" title="Cumpleaños" value={<span><span aria-hidden className="mr-1">🎂</span>{BIRTHDAY_STATUS_LABEL[bd.status] ?? bd.status}</span>} className="[&_[data-testid$=-value]]:text-xl" style={{ borderColor: 'var(--c-birthday-border)', borderLeftWidth: 4 }}>
        {bd.date && <p>Fecha: {fmtDate(bd.date)}</p>}
        {bd.window && bd.status === 'available' && (
          <p>
            Puedes pedirlo entre el {fmtDate(bd.window.from, false)} y el {fmtDate(bd.window.to, false)}
          </p>
        )}
      </Kpi>

      <Kpi id="enjoyed" title="Disfrutados" value={days(b.enjoyedUnits)}>
        {b.plannedUnits > 0 && <p>{days(b.plannedUnits)} ya aprobados por disfrutar</p>}
      </Kpi>

      <Kpi id="pending" title="Pendientes de aprobar" value={days(b.pendingUnits)}>
        <p>{b.pendingUnits ? 'Esperando respuesta' : 'Nada pendiente'}</p>
      </Kpi>

      <Kpi
        id="total"
        title="Saldo total"
        value={
          <span className={cn(negative && 'text-destructive')} style={negative ? { color: 'var(--c-negative-fg)' } : undefined}>
            {negative && <span aria-hidden>− </span>}
            {days(negative ? -b.available.total : b.available.total)}
            {negative && <span className="sr-only"> (saldo negativo)</span>}
          </span>
        }
        className={cn(negative && 'border-destructive')}
      >
        <p>Límite negativo: −{daysLabel(b.negativeLimitUnits)}</p>
        {negative && <p className="font-medium text-destructive">Estás en negativo</p>}
      </Kpi>
    </div>
  );
}
