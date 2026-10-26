import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useRequest } from '@/lib/queries';
import { BUCKET_LABEL, PERIOD_LABEL, REASON_LABEL, days, daysLabel, fmtDateLong } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loading, PageHeader } from '@/components/PageHeader';
import { RequestList } from './RequestList';

/** /requests/:id — destino de los enlaces de notificaciones y emails. */
export default function RequestDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const req = useRequest(id);
  const r = req.data;
  // un admin que no es el solicitante va a la vista de aprobación
  if (r && user && user.role === 'admin' && r.userId !== user.id) return <Navigate to={`/approvals/${r.id}`} replace />;
  return (
    <div className="space-y-4" data-testid="request-detail">
      <PageHeader
        title="Detalle de la solicitud"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Volver</Link>
          </Button>
        }
      />
      {req.isLoading && <Loading />}
      {req.isError && <Alert variant="destructive">No se ha podido cargar la solicitud.</Alert>}
      {r && (
        <>
          <RequestList requests={[r]} />
          <Card>
            <CardHeader>
              <CardTitle>Desglose día a día</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-auto rounded-md border">
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
                        <TableCell>
                          {d.units === 0 ? '—' : daysLabel(d.units)}
                          {d.period ? ` (${PERIOD_LABEL[d.period]})` : ''}
                        </TableCell>
                        <TableCell>{d.reason ? (REASON_LABEL[d.reason] ?? d.reason) : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {r.allocation.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Se descuenta de: {r.allocation.map((a) => `${days(a.units)} de ${BUCKET_LABEL[a.bucket]} (${a.year})`).join(' · ')}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
