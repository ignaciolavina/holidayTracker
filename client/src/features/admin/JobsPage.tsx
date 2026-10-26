import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { JobRunDto } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { Loading } from '@/components/PageHeader';

const JOBS = [
  { name: 'year-close', label: 'Cierre de año', desc: 'Calcula el arrastre y cierra el año anterior.', danger: true },
  { name: 'carryover-expiry', label: 'Caducidad de arrastrados', desc: 'Caduca los días arrastrados no disfrutados.', danger: true },
  { name: 'expiry-reminders', label: 'Avisos de caducidad', desc: 'Envía avisos de días a punto de caducar.', danger: false },
  { name: 'escalation', label: 'Escalado de pendientes', desc: 'Escala solicitudes sin respuesta.', danger: false },
  { name: 'pending-digest', label: 'Resumen de pendientes', desc: 'Envía el resumen de solicitudes pendientes.', danger: false },
  { name: 'holidays-check', label: 'Comprobar festivos', desc: 'Avisa si faltan los festivos del próximo año.', danger: false },
] as const;
const STATUS = { running: 'En curso', done: 'Correcto', failed: 'Con error' } as const;
const TRIGGER = { cron: 'Programado', manual: 'Manual', catchup: 'Recuperación' } as const;

export function JobsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'jobs'], queryFn: () => api.get<JobRunDto[]>('/jobs'), refetchInterval: 15_000 });
  const [confirming, setConfirming] = useState<(typeof JOBS)[number] | null>(null);
  const done = () => { void qc.invalidateQueries({ queryKey: ['admin'] }); void qc.invalidateQueries({ queryKey: ['balance'] }); };
  const run = useMutation({
    mutationFn: (name: string) => api.post(`/jobs/${name}/run`),
    onSuccess: (_d, name) => { toast.success(`Job «${name}» lanzado.`); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const last = (name: string) => q.data?.filter((r) => r.job === name).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

  return (
    <div className="space-y-6" data-testid="jobs-page">
      {q.isLoading && <Loading />}
      {q.isError && <Alert variant="destructive">No se ha podido cargar el historial de jobs.</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        {JOBS.map((j) => {
          const l = last(j.name);
          return (
            <div key={j.name} className="space-y-2 rounded-lg border bg-card p-4" data-testid={`job-${j.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{j.label} <span className="font-mono text-xs text-muted-foreground">{j.name}</span></p><p className="text-sm text-muted-foreground">{j.desc}</p></div>
                <Button size="sm" variant={j.danger ? 'destructive' : 'outline'} disabled={run.isPending} onClick={() => (j.danger ? setConfirming(j) : run.mutate(j.name))} data-testid={`job-run-${j.name}`}>Lanzar</Button>
              </div>
              <p className="text-xs text-muted-foreground">{l ? `Última ejecución: ${fmtDateTime(l.startedAt)} · ${STATUS[l.status]}` : 'Sin ejecuciones registradas.'}</p>
            </div>
          );
        })}
      </div>
      {q.data && (
        <div>
          <h2 className="mb-2 text-base font-semibold">Historial</h2>
          <div className="rounded-md border">
            <Table data-testid="jobs-history">
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Origen</TableHead><TableHead>Inicio</TableHead><TableHead>Fin</TableHead><TableHead>Estado</TableHead><TableHead>Resultado</TableHead></TableRow></TableHeader>
              <TableBody>
                {q.data.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sin ejecuciones.</TableCell></TableRow>}
                {[...q.data].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.job}<span className="text-muted-foreground"> · {r.key}</span></TableCell>
                    <TableCell>{TRIGGER[r.trigger]}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.startedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.finishedAt ? fmtDateTime(r.finishedAt) : '—'}</TableCell>
                    <TableCell><Badge variant={r.status === 'failed' ? 'destructive' : r.status === 'running' ? 'warning' : 'secondary'}>{STATUS[r.status]}</Badge></TableCell>
                    <TableCell className="max-w-64 break-all text-xs">{r.error ?? (r.result != null ? JSON.stringify(r.result) : '')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {confirming && (
        <DangerConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirming(null)}
          testId="job"
          title={`Lanzar «${confirming.label}»`}
          confirmWord="EJECUTAR"
          confirmLabel="Ejecutar ahora"
          requireReason={false}
          warning="Este proceso modifica saldos de toda la plantilla. Ejecútalo solo si sabes lo que haces."
          onConfirm={async () => { await run.mutateAsync(confirming.name); }}
        />
      )}
    </div>
  );
}
