import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { yearOf, REQUEST_STATUSES } from '@ht/shared';
import { useBalance, useRequests } from '@/lib/queries';
import { today } from '@/lib/today';
import { STATUS_LABEL } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Loading } from '@/components/PageHeader';
import { RequestList } from '@/features/requests/RequestList';
import { ExpiryBanner } from './ExpiryBanner';
import { KpiCards } from './KpiCards';
import { OutWidget } from './OutWidget';

export default function DashboardPage() {
  const now = today();
  const thisYear = yearOf(now);
  const balance = useBalance(thisYear);
  const [status, setStatus] = useState('');
  const [year, setYear] = useState(String(thisYear));
  const all = useRequests({});
  const history = useRequests({ status: status || undefined, year: year ? Number(year) : undefined });

  const upcoming = (all.data ?? [])
    .filter((r) => (r.status === 'PENDING' || r.status === 'APPROVED') && r.endDate >= now)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Inicio</h1>
        <Button asChild size="lg" data-testid="request-vacation-button">
          <Link to="/requests/new">
            <Plus className="h-5 w-5" aria-hidden /> Solicitar vacaciones
          </Link>
        </Button>
      </div>

      {balance.isLoading && <Loading />}
      {balance.isError && <Alert variant="destructive">No se han podido cargar tus saldos.</Alert>}
      {balance.data && (
        <>
          <ExpiryBanner balance={balance.data} />
          <KpiCards balance={balance.data} />
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card data-testid="upcoming">
            <CardHeader>
              <CardTitle>Próximas vacaciones</CardTitle>
            </CardHeader>
            <CardContent>
              {all.isLoading ? <Loading /> : <RequestList requests={upcoming} emptyText="No tienes vacaciones próximas." />}
            </CardContent>
          </Card>
          <Card data-testid="history">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>Historial de solicitudes</CardTitle>
              <div className="flex gap-2">
                <Select aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-40" data-testid="history-status">
                  <option value="">Todos los estados</option>
                  {REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Filtrar por año" value={year} onChange={(e) => setYear(e.target.value)} className="h-9 w-28" data-testid="history-year">
                  <option value="">Todos</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {history.isLoading ? <Loading /> : history.isError ? <Alert variant="destructive">No se ha podido cargar el historial.</Alert> : <RequestList requests={[...(history.data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate))} />}
            </CardContent>
          </Card>
        </div>
        <OutWidget />
      </div>
    </div>
  );
}
