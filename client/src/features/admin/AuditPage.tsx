import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditLogDto, Paginated } from '@ht/shared';
import { api, qs } from '@/lib/api';
import { useUsers } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loading } from '@/components/PageHeader';
import { UserSelect } from './common';

function flatten(v: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0 && prefix) out[prefix] = {};
    for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || '(valor)'] = v;
  return out;
}
const show = (v: unknown) => (v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v));

/** Diff simple clave a clave entre before y after. */
export function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = flatten(before ?? {});
  const a = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const changed = keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (changed.length === 0) return <p className="text-xs text-muted-foreground">Sin cambios de datos registrados.</p>;
  return (
    <table className="w-full text-xs" data-testid="audit-diff">
      <thead><tr className="text-left text-muted-foreground"><th className="pr-3">Campo</th><th className="pr-3">Antes</th><th>Después</th></tr></thead>
      <tbody>
        {changed.map((k) => (
          <tr key={k} className="align-top">
            <td className="pr-3 font-mono">{k}</td>
            <td className="break-all pr-3 text-destructive">{k in b ? show(b[k]) : '∅'}</td>
            <td className="break-all text-green-700 dark:text-green-400">{k in a ? show(a[k]) : '∅'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditPage() {
  const users = useUsers();
  const [tab, setTab] = useState<'all' | 'sensitive'>('all');
  const [f, setF] = useState({ actorId: '', action: '', from: '', to: '', onlySensitive: false });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ actorId: f.actorId, action: f.action.trim(), from: f.from, to: f.to, sensitive: tab === 'sensitive' || f.onlySensitive ? '1' : undefined }),
    [f, tab],
  );
  const q = useQuery({
    queryKey: ['admin', 'audit', filters, page],
    queryFn: () => api.get<Paginated<AuditLogDto>>(`/audit${qs({ ...filters, page, pageSize: 50 })}`),
  });
  const set = (patch: Partial<typeof f>) => { setF((p) => ({ ...p, ...patch })); setPage(1); };
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div className="space-y-4" data-testid="audit-page">
      <Tabs value={tab} onValueChange={(v) => { setTab(v as 'all' | 'sensitive'); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-audit-all">Registro</TabsTrigger>
          <TabsTrigger value="sensitive" data-testid="tab-audit-sensitive">Actividad sensible</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Usuario (actor)" htmlFor="au-actor"><UserSelect id="au-actor" testId="audit-actor" value={f.actorId} onChange={(v) => set({ actorId: v })} users={users.data ?? []} allowNone noneLabel="Todos" /></Field>
        <Field label="Acción" htmlFor="au-action"><Input id="au-action" data-testid="audit-action" placeholder="p. ej. balance.adjust" value={f.action} onChange={(e) => set({ action: e.target.value })} /></Field>
        <Field label="Desde" htmlFor="au-from"><Input id="au-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
        <Field label="Hasta" htmlFor="au-to"><Input id="au-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
        <div className="flex items-end gap-3">
          {tab === 'all' && <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={f.onlySensitive} onChange={(e) => set({ onlySensitive: e.target.checked })} data-testid="audit-sensitive" /> Solo sensibles</label>}
          <Button asChild variant="outline"><a href={`/api/audit/export.csv${qs(filters)}`} download data-testid="audit-export">Exportar CSV</a></Button>
        </div>
      </div>

      {q.isLoading && <Loading />}
      {q.isError && <Alert variant="destructive">No se ha podido cargar la auditoría.</Alert>}
      {q.data && (
        <>
          <div className="rounded-md border">
            <Table data-testid="audit-table">
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Actor</TableHead><TableHead>Acción</TableHead><TableHead>Objetivo</TableHead><TableHead>Motivo</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {q.data.items.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Sin resultados.</TableCell></TableRow>}
                {q.data.items.map((l) => (
                  <Fragment key={l.id}>
                    <TableRow data-testid={`audit-row-${l.id}`}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</TableCell>
                      <TableCell>{l.actorName ?? 'Sistema'}</TableCell>
                      <TableCell><Badge variant={l.sensitive ? 'warning' : 'outline'} className="font-mono">{l.action}</Badge></TableCell>
                      <TableCell>{l.targetName ?? l.targetId ?? l.targetType}<span className="ml-1 text-xs text-muted-foreground">({l.targetType})</span></TableCell>
                      <TableCell className="max-w-56 truncate text-xs" title={l.reason ?? undefined}>{l.reason ?? ''}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Ocultar' : 'Detalle'}</Button></TableCell>
                    </TableRow>
                    {open === l.id && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <AuditDiff before={l.before} after={l.after} />
                          {l.ip && <p className="mt-1 text-xs text-muted-foreground">IP: {l.ip}</p>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{q.data.total} registros</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="audit-prev">Anterior</Button>
              <span>Página {page} de {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="audit-next">Siguiente</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
