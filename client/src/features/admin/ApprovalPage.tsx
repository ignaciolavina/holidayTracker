import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { yearOf, type BalanceDto } from '@ht/shared';
import { api } from '@/lib/api';
import { useRequest } from '@/lib/queries';
import { BUCKET_LABEL, KIND_LABEL, PERIOD_LABEL, REASON_LABEL, days, daysLabel, fmtDate, fmtDateLong, fmtDateTime, fmtRange } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loading, PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/features/requests/RequestList';
import { DecisionButtons } from './common';
import { RevokeDialog } from './RevokeDialog';

/** SPEC-11/18. /approvals/:id[?t=token]. Nunca aprueba automáticamente al abrir. */
export default function ApprovalPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get('t');
  const [revokeOpen, setRevokeOpen] = useState(false);

  const link = useQuery({
    queryKey: ['approval-link', token],
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
    queryFn: () => api.get<{ requestId: string }>(`/approvals/link/${encodeURIComponent(token ?? '')}`),
  });
  const linkBad = !!token && (link.isError || (link.isSuccess && link.data.requestId !== id));
  const linkReady = !token || link.isSuccess;
  const req = useRequest(linkReady && !linkBad ? id : null);
  const r = req.data;
  const balance = useQuery({
    queryKey: ['admin', 'balance', r?.userId, r ? yearOf(r.startDate) : null],
    enabled: !!r,
    queryFn: () => api.get<BalanceDto>(`/balances/${r!.userId}?year=${yearOf(r!.startDate)}`),
  });

  return (
    <div className="space-y-4" data-testid="approval-page">
      <PageHeader
        title="Solicitud de vacaciones"
        description="Revisa los detalles antes de decidir."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin">Volver al panel</Link>
          </Button>
        }
      />
      {token && link.isLoading && <Loading label="Validando enlace…" />}
      {linkBad && (
        <Alert variant="destructive" title="Enlace no válido" data-testid="approval-link-error">
          {link.error instanceof Error ? link.error.message : 'El enlace no corresponde a esta solicitud.'} Puedes buscar la solicitud en el{' '}
          <Link to="/admin" className="font-medium underline">
            panel de administración
          </Link>
          .
        </Alert>
      )}
      {linkReady && !linkBad && req.isLoading && <Loading />}
      {req.isError && <Alert variant="destructive">No se ha podido cargar la solicitud.</Alert>}
      {r && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {r.userName} <StatusBadge status={r.status} />
                {r.urgent && <Badge variant="destructive">Urgente</Badge>}
                {r.escalatedAt && <Badge variant="warning">Escalada</Badge>}
                {r.retroactive && <Badge variant="outline">Retroactiva</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><dt className="inline text-muted-foreground">Tipo: </dt><dd className="inline">{KIND_LABEL[r.kind]}</dd></div>
                <div><dt className="inline text-muted-foreground">Periodo: </dt><dd className="inline">{fmtRange(r.startDate, r.endDate)}</dd></div>
                <div><dt className="inline text-muted-foreground">Días a descontar: </dt><dd className="inline font-semibold">{daysLabel(r.units)}</dd></div>
                {r.halfDay && <div><dt className="inline text-muted-foreground">Medio día: </dt><dd className="inline">{fmtDate(r.halfDay.date)} ({PERIOD_LABEL[r.halfDay.period]})</dd></div>}
                <div><dt className="inline text-muted-foreground">Solicitada: </dt><dd className="inline">{fmtDateTime(r.createdAt)}</dd></div>
                {r.decidedAt && <div><dt className="inline text-muted-foreground">Decidida: </dt><dd className="inline">{fmtDateTime(r.decidedAt)}</dd></div>}
                {r.revokedFromDate && <div><dt className="inline text-muted-foreground">Anulada desde: </dt><dd className="inline">{fmtDate(r.revokedFromDate)}</dd></div>}
              </dl>
              {r.comment && <p className="rounded-md bg-muted p-2 italic">“{r.comment}”</p>}
              {r.rejectionReason && <Alert variant="destructive">Motivo del rechazo: {r.rejectionReason}</Alert>}
              {r.cancelReason && <Alert variant="warning">Motivo de cancelación: {r.cancelReason}</Alert>}
              <div className="flex flex-wrap items-center gap-2" data-testid="approval-actions">
                <DecisionButtons request={r} />
                {r.can.revoke && (
                  <Button size="sm" variant="destructive" onClick={() => setRevokeOpen(true)} data-testid="revoke-button">
                    Anular solicitud
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/calendar/${r.userId}`}>Ver calendario anual</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Desglose día a día</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-auto rounded-md border" data-testid="approval-days">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Día</TableHead>
                        <TableHead>Cuenta</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.days.map((d) => (
                        <TableRow key={d.date} className={d.units === 0 ? 'text-muted-foreground' : undefined}>
                          <TableCell>{fmtDateLong(d.date)}</TableCell>
                          <TableCell>{d.units === 0 ? '—' : daysLabel(d.units)}{d.period ? ` (${PERIOD_LABEL[d.period]})` : ''}</TableCell>
                          <TableCell>{d.reason ? (REASON_LABEL[d.reason] ?? d.reason) : ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {r.allocation.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bolsas: {r.allocation.map((a) => `${days(a.units)} de ${BUCKET_LABEL[a.bucket]} (${a.year})`).join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Saldo de {r.userName} en {yearOf(r.startDate)}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm" data-testid="approval-balance">
                {balance.isLoading && <Loading />}
                {balance.isError && <Alert variant="destructive">No se ha podido cargar el saldo.</Alert>}
                {balance.data && (
                  <dl className="grid grid-cols-2 gap-y-1.5">
                    <dt className="text-muted-foreground">Días del año</dt><dd>{days(balance.data.available.current)}</dd>
                    <dt className="text-muted-foreground">Arrastrados</dt><dd>{days(balance.data.available.carryover)}</dd>
                    <dt className="text-muted-foreground">Cumpleaños</dt><dd>{days(balance.data.available.birthday)}</dd>
                    <dt className="font-semibold">Disponible total</dt>
                    <dd className={balance.data.available.total < 0 ? 'font-semibold text-destructive' : 'font-semibold'}>{days(balance.data.available.total)}</dd>
                    <dt className="text-muted-foreground">Pendiente de aprobar</dt><dd>{days(balance.data.pendingUnits)}</dd>
                    <dt className="text-muted-foreground">Planificado</dt><dd>{days(balance.data.plannedUnits)}</dd>
                    <dt className="text-muted-foreground">Disfrutado</dt><dd>{days(balance.data.enjoyedUnits)}</dd>
                  </dl>
                )}
              </CardContent>
            </Card>
          </div>
          <RevokeDialog request={r} open={revokeOpen} onOpenChange={setRevokeOpen} />
        </>
      )}
    </div>
  );
}
