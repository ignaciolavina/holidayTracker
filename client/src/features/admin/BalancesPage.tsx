import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BUCKETS, daysToUnits, formatUnits, yearOf, type Bucket, type BalanceRow, type LedgerEntryDto } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BUCKET_LABEL, days, fmtDateTime, signedDays } from '@/lib/format';
import { today } from '@/lib/today';
import { useUsers } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { Loading } from '@/components/PageHeader';
import { LEDGER_LABEL } from './common';

type SortKey = 'name' | 'current' | 'carryover' | 'birthday' | 'reserved' | 'total';
const reservedOf = (r: BalanceRow) => r.reserved.current + r.reserved.carryover + r.reserved.birthday;
const valueOf = (r: BalanceRow, k: SortKey): number | string =>
  k === 'name' ? r.userName.toLowerCase() : k === 'current' ? r.ledger.current : k === 'carryover' ? r.ledger.carryover : k === 'birthday' ? r.ledger.birthday : k === 'reserved' ? reservedOf(r) : r.available.total;

function Units({ v }: { v: number }) {
  return (
    <span className={cn(v < 0 && 'font-semibold text-destructive')} style={v < 0 ? { color: 'var(--c-negative-fg)' } : undefined}>
      {v < 0 && <span aria-hidden>▼ </span>}
      {days(v)}
    </span>
  );
}

export function BalancesPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [year, setYear] = useState(yearOf(today()));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [ledgerFor, setLedgerFor] = useState<BalanceRow | null>(null);
  const [adjustFor, setAdjustFor] = useState<BalanceRow | null>(null);

  const q = useQuery({ queryKey: ['admin', 'balances', year], queryFn: () => api.get<BalanceRow[]>(`/balances?year=${year}`) });
  const rows = useMemo(() => {
    const list = [...(q.data ?? [])];
    list.sort((a, b) => {
      const x = valueOf(a, sort.key);
      const y = valueOf(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    return list;
  }, [q.data, sort]);

  const head = (key: SortKey, label: string, hint?: string) => (
    <TableHead aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} title={hint}>
      <button type="button" className="font-medium hover:text-foreground" data-testid={`sort-${key}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4" data-testid="balances-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-32">
          <Field label="Año" htmlFor="bal-year">
            <Input id="bal-year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} data-testid="balances-year" />
          </Field>
        </div>
        <Button asChild variant="outline">
          <a href={`/api/balances/export.csv?year=${year}`} download data-testid="balances-export">
            Exportar CSV
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Cantidades en días. «Total» = saldo disponible tras descontar lo reservado por solicitudes pendientes.</p>
      {q.isLoading && <Loading />}
      {q.isError && <Alert variant="destructive">No se han podido cargar los saldos.</Alert>}
      {q.data && (
        <div className="rounded-md border">
          <Table data-testid="balances-table">
            <TableHeader>
              <TableRow>
                {head('name', 'Persona')}
                {head('current', 'Actual')}
                {head('carryover', 'Arrastrados')}
                {head('birthday', 'Cumpleaños')}
                {head('reserved', 'Reservado', 'Pendiente de aprobar')}
                {head('total', 'Total', 'Disponible')}
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.userId} data-testid={`balance-row-${r.userId}`}>
                  <TableCell className="font-medium">
                    {r.userName} {r.status !== 'active' && <Badge variant="outline">{r.status === 'disabled' ? 'Baja' : 'Invitado'}</Badge>}
                  </TableCell>
                  <TableCell><Units v={r.ledger.current} /></TableCell>
                  <TableCell><Units v={r.ledger.carryover} /></TableCell>
                  <TableCell><Units v={r.ledger.birthday} /></TableCell>
                  <TableCell>{days(reservedOf(r))}</TableCell>
                  <TableCell className="font-semibold"><Units v={r.available.total} /></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Button asChild size="sm" variant="ghost"><Link to={`/calendar/${r.userId}`}>Vista anual</Link></Button>
                      <Button size="sm" variant="ghost" onClick={() => setLedgerFor(r)} data-testid={`ledger-${r.userId}`}>Ledger</Button>
                      <Button size="sm" variant="outline" disabled={r.userId === me?.id || r.yearClosed} title={r.userId === me?.id ? 'No puedes ajustar tu propio saldo' : r.yearClosed ? 'Año cerrado' : undefined} onClick={() => setAdjustFor(r)} data-testid={`adjust-${r.userId}`}>
                        Ajustar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {ledgerFor && <LedgerDialog row={ledgerFor} year={year} onClose={() => setLedgerFor(null)} />}
      {adjustFor && (
        <AdjustDialog
          row={adjustFor}
          year={year}
          onClose={() => setAdjustFor(null)}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['admin'] });
            void qc.invalidateQueries({ queryKey: ['balance'] });
          }}
        />
      )}
    </div>
  );
}

function LedgerDialog({ row, year, onClose }: { row: BalanceRow; year: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin', 'ledger', row.userId, year], queryFn: () => api.get<LedgerEntryDto[]>(`/ledger/${row.userId}?year=${year}`) });
  const users = useUsers();
  const name = (id: string | null) => (id ? (users.data?.find((u) => u.id === id)?.name ?? '—') : 'Sistema');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="ledger-dialog">
        <DialogHeader>
          <DialogTitle>Ledger de {row.userName} · {year}</DialogTitle>
          <DialogDescription>Movimientos del saldo (solo se añaden, nunca se editan).</DialogDescription>
        </DialogHeader>
        {q.isLoading && <Loading />}
        {q.isError && <Alert variant="destructive">No se ha podido cargar el ledger.</Alert>}
        {q.data && (
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Bolsa</TableHead><TableHead>Días</TableHead><TableHead>Motivo</TableHead><TableHead>Por</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {q.data.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sin movimientos.</TableCell></TableRow>}
                {q.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</TableCell>
                    <TableCell>{LEDGER_LABEL[e.type] ?? e.type}</TableCell>
                    <TableCell>{BUCKET_LABEL[e.bucket]}</TableCell>
                    <TableCell className={cn('font-mono', e.units < 0 && 'text-destructive')}>{signedDays(e.units)}</TableCell>
                    <TableCell className="text-xs">{e.reason ?? ''}</TableCell>
                    <TableCell className="text-xs">{name(e.createdBy)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ row, year, onClose, onDone }: { row: BalanceRow; year: number; onClose: () => void; onDone: () => void }) {
  const [bucket, setBucket] = useState<Bucket>('CURRENT');
  const [daysStr, setDaysStr] = useState('');
  const n = Number(daysStr.replace(',', '.'));
  const valid = daysStr.trim() !== '' && Number.isFinite(n) && Number.isInteger(n * 2) && n !== 0 && Math.abs(n) <= 366;
  const beforeBucket = row.available[bucket === 'CURRENT' ? 'current' : bucket === 'CARRYOVER' ? 'carryover' : 'birthday'];
  const delta = valid ? daysToUnits(n) : 0;

  return (
    <DangerConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      testId="adjust"
      title={`Ajustar saldo de ${row.userName}`}
      confirmWord="AJUSTAR"
      confirmLabel="Aplicar ajuste"
      warning="El ajuste modifica el saldo de la persona y queda registrado en el ledger y en la auditoría."
      impact={
        <div data-testid="adjust-before-after" className="space-y-0.5">
          <p>{BUCKET_LABEL[bucket]}: <strong>{formatUnits(beforeBucket)}</strong> → <strong className={cn(beforeBucket + delta < 0 && 'text-destructive')}>{formatUnits(beforeBucket + delta)}</strong> días</p>
          <p>Total disponible: <strong>{formatUnits(row.available.total)}</strong> → <strong className={cn(row.available.total + delta < 0 && 'text-destructive')}>{formatUnits(row.available.total + delta)}</strong> días</p>
        </div>
      }
      onConfirm={async ({ reason }) => {
        if (!valid) throw new Error('Los días deben ser un número distinto de 0, en múltiplos de 0,5.');
        try {
          await api.post(`/balances/${row.userId}/adjust`, { year, bucket, days: n, reason });
        } catch (e) {
          throw new Error(errorMessage(e));
        }
        toast.success('Ajuste aplicado.');
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bolsa" htmlFor="adjust-bucket">
          <Select id="adjust-bucket" data-testid="adjust-bucket" value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Días (±, múltiplos de 0,5)" htmlFor="adjust-days" error={daysStr && !valid ? 'Valor no válido' : null}>
          <Input id="adjust-days" data-testid="adjust-days" inputMode="decimal" placeholder="-1,5" value={daysStr} onChange={(e) => setDaysStr(e.target.value)} />
        </Field>
      </div>
    </DangerConfirmDialog>
  );
}
