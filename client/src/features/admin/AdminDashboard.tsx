import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AdminOverviewDto } from '@ht/shared';
import { api } from '@/lib/api';
import { fmtDateTime, PERIOD_LABEL } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/PageHeader';
import { DecisionButtons, Empty, RequestRow, Section, UserLine } from './common';

export function AdminDashboard() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<AdminOverviewDto>('/admin/overview'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <Alert variant="destructive">No se ha podido cargar el resumen de administración.</Alert>;
  const o = q.data;
  const variant = { info: 'info', warning: 'warning', danger: 'destructive' } as const;

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="admin-dashboard">
      <div className="space-y-4 lg:col-span-2">
        {o.alerts.length > 0 && (
          <div className="space-y-2" data-testid="admin-alerts">
            {o.alerts.map((a, i) => (
              <Alert key={`${a.code}-${i}`} variant={variant[a.level]} data-testid={`alert-${a.code}`}>
                {a.message}{' '}
                {a.link &&
                  (a.link.startsWith('/') ? (
                    <Link to={a.link} className="font-medium underline">
                      Ver
                    </Link>
                  ) : (
                    <a href={a.link} className="font-medium underline">
                      Ver
                    </a>
                  ))}
              </Alert>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 lg:col-span-2">
        <Section title="Solicitudes que me tocan aprobar" count={o.toApprove.length} testId="section-to-approve">
          {o.toApprove.length === 0 ? (
            <Empty>No tienes solicitudes pendientes de aprobar.</Empty>
          ) : (
            <ul className="space-y-2">
              {o.toApprove.map((r) => (
                <RequestRow key={r.id} r={r} actions={<DecisionButtons request={r} />} />
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Escaladas y urgentes" count={o.escalated.length} testId="section-escalated" tone={o.escalated.length ? 'danger' : undefined}>
        {o.escalated.length === 0 ? (
          <Empty>No hay solicitudes escaladas.</Empty>
        ) : (
          <ul className="space-y-2">
            {o.escalated.map((r) => (
              <RequestRow key={r.id} r={r} actions={<DecisionButtons request={r} />} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Otras pendientes" count={o.otherPending.length} testId="section-other-pending">
        {o.otherPending.length === 0 ? (
          <Empty>No hay otras solicitudes pendientes.</Empty>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">Solo lectura: no te corresponde aprobarlas (p. ej. las tuyas).</p>
            <ul className="space-y-2">
              {o.otherPending.map((r) => (
                <RequestRow key={r.id} r={r} />
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Fuera hoy" count={o.outToday.length} testId="section-out-today">
        {o.outToday.length === 0 ? (
          <Empty>Hoy no hay nadie fuera.</Empty>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {o.outToday.map((a) => (
              <li key={`${a.requestId}-${a.date}`} className="flex flex-wrap items-center justify-between gap-2">
                <UserLine name={a.userName} avatarUrl={a.avatarUrl} />
                <span className="text-xs text-muted-foreground">
                  {a.period ? `Medio día (${PERIOD_LABEL[a.period]})` : 'Día completo'} · {a.status === 'PENDING' ? 'pendiente' : 'aprobado'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Actividad sensible reciente" count={o.recentSensitive.length} testId="section-sensitive">
        {o.recentSensitive.length === 0 ? (
          <Empty>Sin actividad sensible reciente.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {o.recentSensitive.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0">
                <span>
                  <Badge variant="outline" className="mr-2 font-mono">
                    {l.action}
                  </Badge>
                  {l.actorName ?? 'Sistema'} → {l.targetName ?? l.targetType}
                </span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(l.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/admin/audit" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
          Ver auditoría completa
        </Link>
      </Section>
    </div>
  );
}
