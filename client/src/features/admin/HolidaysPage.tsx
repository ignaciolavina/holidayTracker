import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { COLOR_TOKENS, HOLIDAY_SCOPES, isValidDate, yearOf, type HolidayDraftItem, type HolidayDto, type HolidayImpact, type HolidayScope } from '@ht/shared';
import { api } from '@/lib/api';
import { useHolidayCalendars } from '@/lib/queries';
import { daysLabel, fmtDate, fmtRange, signedDays, STATUS_LABEL, weekdayShort } from '@/lib/format';
import { today } from '@/lib/today';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { Loading } from '@/components/PageHeader';
import { ApiErrorBox, invalidateRequests } from './common';

const SCOPE_TOKEN = { national: 'holidayNational', regional: 'holidayRegional', local: 'holidayLocal' } as const;
const SCOPE_LABEL: Record<HolidayScope, string> = { national: 'Nacional', regional: 'Autonómico', local: 'Local' };

function ScopeChip({ scope }: { scope: HolidayScope }) {
  const t = COLOR_TOKENS[SCOPE_TOKEN[scope]];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold"
      style={{ background: `var(--c-${t.key}-bg)`, color: `var(--c-${t.key}-fg)`, borderColor: `var(--c-${t.key}-border)` }}
      data-testid={`scope-${scope}`}
    >
      <span aria-hidden className="font-mono">{t.icon}</span> {SCOPE_LABEL[scope]}
    </span>
  );
}

function useInvalidateHolidays() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['holidays'] });
    void qc.invalidateQueries({ queryKey: ['admin'] });
    invalidateRequests(qc);
  };
}

export function HolidaysPage() {
  const calendars = useHolidayCalendars();
  const [year, setYear] = useState(yearOf(today()));
  const [calendarId, setCalendarId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [editor, setEditor] = useState<{ op: 'create' | 'update' | 'delete'; holiday?: HolidayDto } | null>(null);

  useEffect(() => {
    if (!calendarId && calendars.data?.length) setCalendarId(calendars.data.find((c) => c.isDefault)?.id ?? calendars.data[0]!.id);
  }, [calendars.data, calendarId]);

  const q = useQuery({
    queryKey: ['holidays', year, calendarId],
    enabled: !!calendarId,
    queryFn: () => api.get<HolidayDto[]>(`/holidays?year=${year}&calendarId=${calendarId}`),
  });
  const status = useQuery({ queryKey: ['admin', 'holiday-status'], queryFn: () => api.get<{ year: number; nextYearMissing: boolean }>('/holidays/status') });
  const list = [...(q.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-4" data-testid="holidays-page">
      {status.data?.nextYearMissing && (
        <Alert variant="warning" title="Faltan los festivos del próximo año" data-testid="holidays-missing">
          Aún no se han cargado los festivos de {status.data.year + 1}.{' '}
          <button type="button" className="font-medium underline" onClick={() => { setYear(status.data!.year + 1); setImportOpen(true); }}>
            Importarlos ahora
          </button>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28"><Field label="Año" htmlFor="hol-year"><Input id="hol-year" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} data-testid="holidays-year" /></Field></div>
        <div className="min-w-48 flex-1 sm:flex-none"><Field label="Calendario" htmlFor="hol-cal">
          <Select id="hol-cal" data-testid="holidays-calendar" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            {(calendars.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field></div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="holidays-import">Importar año</Button>
          <Button onClick={() => setEditor({ op: 'create' })} data-testid="holidays-new">Nuevo festivo</Button>
        </div>
      </div>

      {q.isLoading && <Loading />}
      {q.isError && <Alert variant="destructive">No se han podido cargar los festivos.</Alert>}
      {q.data && (
        <div className="rounded-md border">
          <Table data-testid="holidays-table">
            <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Nombre</TableHead><TableHead>Ámbito</TableHead><TableHead>Origen</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No hay festivos para este año y calendario.</TableCell></TableRow>}
              {list.map((h) => (
                <TableRow key={h.id} data-testid={`holiday-row-${h.id}`}>
                  <TableCell className="whitespace-nowrap">{weekdayShort(h.date)} {fmtDate(h.date)}</TableCell>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell><ScopeChip scope={h.scope} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{h.source === 'import' ? 'Importado' : 'Manual'}</TableCell>
                  <TableCell>
                    {h.locked ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Año cerrado: solo lectura"><Lock className="h-3.5 w-3.5" aria-hidden /> Solo lectura</span>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditor({ op: 'update', holiday: h })} data-testid={`holiday-edit-${h.id}`}>Editar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditor({ op: 'delete', holiday: h })} data-testid={`holiday-delete-${h.id}`}>Borrar</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Leyenda de ámbitos">{HOLIDAY_SCOPES.map((s) => <ScopeChip key={s} scope={s} />)}</div>

      {importOpen && <ImportDialog year={year} calendarId={calendarId} onClose={() => setImportOpen(false)} />}
      {editor && <HolidayEditor op={editor.op} holiday={editor.holiday} year={year} calendarId={calendarId} onClose={() => setEditor(null)} />}
    </div>
  );
}

function ImportDialog({ year: initialYear, calendarId, onClose }: { year: number; calendarId: string; onClose: () => void }) {
  const calendars = useHolidayCalendars();
  const invalidate = useInvalidateHolidays();
  const [year, setYear] = useState(initialYear);
  const [cal, setCal] = useState(calendarId);
  const [rows, setRows] = useState<HolidayDraftItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const preview = useMutation({
    mutationFn: () => api.post<HolidayDraftItem[]>('/holidays/import/preview', { year }),
    onSuccess: (d) => { setRows(d); setErr(null); },
    onError: (e) => setErr(e),
  });
  const confirm = useMutation({
    mutationFn: () => api.post('/holidays/import/confirm', { year, ...(cal ? { calendarId: cal } : {}), holidays: rows }),
    onSuccess: () => { toast.success('Festivos importados.'); invalidate(); onClose(); },
    onError: (e) => setErr(e),
  });
  const upd = (i: number, patch: Partial<HolidayDraftItem>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = (mmdd = '', name = '', scope: HolidayScope = 'local') => setRows((r) => [...(r ?? []), { date: mmdd ? `${year}-${mmdd}` : '', name, scope }]);
  const invalid = !rows || rows.length === 0 || rows.some((r) => !isValidDate(r.date) || r.name.trim().length < 1);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="import-dialog">
        <DialogHeader><DialogTitle>Importar festivos</DialogTitle><DialogDescription>Se obtiene un borrador que puedes editar antes de confirmar. Los festivos locales hay que añadirlos a mano.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><Field label="Año" htmlFor="imp-year"><Input id="imp-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} data-testid="import-year" /></Field></div>
          <div className="min-w-48 flex-1"><Field label="Calendario destino" htmlFor="imp-cal"><Select id="imp-cal" value={cal} onChange={(e) => setCal(e.target.value)}>{(calendars.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field></div>
          <Button onClick={() => preview.mutate()} disabled={preview.isPending} data-testid="import-preview">{preview.isPending ? 'Buscando…' : 'Obtener borrador'}</Button>
        </div>
        {rows && (
          <div className="space-y-2" data-testid="import-draft">
            <div className="max-h-[45vh] space-y-2 overflow-auto">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border p-2 sm:grid-cols-[9rem_1fr_9rem_auto]" data-testid={`import-row-${i}`}>
                  <Input type="date" aria-label="Fecha" value={r.date} onChange={(e) => upd(i, { date: e.target.value })} />
                  <Input aria-label="Nombre" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} className="order-last col-span-2 sm:order-none sm:col-span-1" />
                  <Select aria-label="Ámbito" value={r.scope} onChange={(e) => upd(i, { scope: e.target.value as HolidayScope })}>{HOLIDAY_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</Select>
                  <Button size="sm" variant="ghost" onClick={() => setRows((x) => x!.filter((_, j) => j !== i))} aria-label="Quitar fila" data-testid={`import-remove-${i}`}>Quitar</Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => add('05-15', 'San Isidro')} data-testid="import-add-isidro">+ San Isidro (15-05)</Button>
              <Button size="sm" variant="outline" onClick={() => add('11-09', 'La Almudena')} data-testid="import-add-almudena">+ La Almudena (09-11)</Button>
              <Button size="sm" variant="outline" onClick={() => add()} data-testid="import-add-row">+ Añadir fila</Button>
            </div>
          </div>
        )}
        {err != null && <ApiErrorBox error={err} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={invalid || confirm.isPending} onClick={() => confirm.mutate()} data-testid="import-confirm">Confirmar importación</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactList({ impact }: { impact: HolidayImpact }) {
  return (
    <div className="space-y-2 text-sm" data-testid="holiday-impact">
      <p className="font-medium">
        {impact.affected.length} solicitud(es) afectada(s) · impacto total {signedDays(impact.totalDeltaUnits)} días
      </p>
      <ul className="max-h-48 space-y-1 overflow-auto">
        {impact.affected.map((a) => (
          <li key={a.requestId} className="rounded border p-2">
            <strong>{a.userName}</strong> · {fmtRange(a.startDate, a.endDate)} · {STATUS_LABEL[a.status]} ·{' '}
            <span className={a.deltaUnits < 0 ? 'text-destructive' : ''}>{a.deltaUnits > 0 ? 'se devuelven' : 'se cargan'} {daysLabel(Math.abs(a.deltaUnits))}</span>
            {a.touchesEnjoyed && <span className="ml-1 font-semibold text-destructive">(incluye días ya disfrutados)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HolidayEditor({ op, holiday, year, calendarId, onClose }: { op: 'create' | 'update' | 'delete'; holiday?: HolidayDto; year: number; calendarId: string; onClose: () => void }) {
  const calendars = useHolidayCalendars();
  const invalidate = useInvalidateHolidays();
  const [f, setF] = useState({
    date: holiday?.date ?? `${year}-01-01`,
    name: holiday?.name ?? '',
    scope: (holiday?.scope ?? 'local') as HolidayScope,
    calendarIds: holiday?.calendarIds ?? (calendarId ? [calendarId] : []),
  });
  const [impact, setImpact] = useState<HolidayImpact | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const body = () => ({ date: f.date, name: f.name.trim(), scope: f.scope, ...(f.calendarIds.length ? { calendarIds: f.calendarIds } : {}) });

  const check = useMutation({
    mutationFn: () => api.post<HolidayImpact>('/holidays/impact', { op, ...(holiday ? { id: holiday.id } : {}), date: f.date, scope: f.scope, ...(f.calendarIds.length ? { calendarIds: f.calendarIds } : {}) }),
    onSuccess: (r) => { setImpact(r); setErr(null); },
    onError: (e) => setErr(e),
  });

  async function apply(extra: Record<string, unknown>) {
    const confirmBody = { confirm: true, ...extra };
    if (op === 'create') await api.post('/holidays', { ...body(), ...confirmBody });
    else if (op === 'update') await api.patch(`/holidays/${holiday!.id}`, { ...body(), ...confirmBody });
    else await api.del(`/holidays/${holiday!.id}`, confirmBody);
    toast.success(op === 'delete' ? 'Festivo borrado.' : 'Festivo guardado.');
    invalidate();
    onClose();
  }
  const simple = useMutation({ mutationFn: () => apply({}), onError: (e) => setErr(e) });

  const formOk = op === 'delete' || (isValidDate(f.date) && f.name.trim().length >= 2);
  const title = op === 'create' ? 'Nuevo festivo' : op === 'update' ? 'Editar festivo' : 'Borrar festivo';
  const toggleCal = (id: string) => setF((p) => ({ ...p, calendarIds: p.calendarIds.includes(id) ? p.calendarIds.filter((c) => c !== id) : [...p.calendarIds, id] }));

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent data-testid="holiday-dialog">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Antes de guardar se calcula el impacto sobre solicitudes existentes.</DialogDescription></DialogHeader>
          {op === 'delete' ? (
            <p className="text-sm">¿Borrar <strong>{holiday!.name}</strong> ({fmtDate(holiday!.date)})?</p>
          ) : (
            <div className="space-y-3">
              <Field label="Fecha" htmlFor="hol-date"><Input id="hol-date" type="date" data-testid="holiday-date" value={f.date} disabled={!!impact} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <Field label="Nombre" htmlFor="hol-name"><Input id="hol-name" data-testid="holiday-name" value={f.name} disabled={!!impact} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Ámbito" htmlFor="hol-scope"><Select id="hol-scope" data-testid="holiday-scope" value={f.scope} disabled={!!impact} onChange={(e) => setF({ ...f, scope: e.target.value as HolidayScope })}>{HOLIDAY_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</Select></Field>
              <fieldset className="space-y-1" disabled={!!impact}>
                <legend className="text-sm font-medium">Calendarios</legend>
                {(calendars.data ?? []).map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.calendarIds.includes(c.id)} onChange={() => toggleCal(c.id)} /> {c.name}</label>
                ))}
              </fieldset>
            </div>
          )}
          {impact && (impact.affected.length === 0 ? <Alert variant="info" data-testid="holiday-no-impact">Este cambio no afecta a ninguna solicitud.</Alert> : <ImpactList impact={impact} />)}
          {err != null && <ApiErrorBox error={err} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            {!impact && <Button disabled={!formOk || check.isPending} onClick={() => check.mutate()} data-testid="holiday-check">Revisar impacto</Button>}
            {impact && impact.touchesEnjoyed && <Button variant="destructive" onClick={() => setDangerOpen(true)} data-testid="holiday-confirm">Continuar…</Button>}
            {impact && !impact.touchesEnjoyed && <Button disabled={simple.isPending} onClick={() => simple.mutate()} data-testid="holiday-confirm">Confirmar</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dangerOpen && impact && (
        <DangerConfirmDialog
          open
          onOpenChange={setDangerOpen}
          testId="holiday-danger"
          title={title}
          confirmWord="CONFIRMAR"
          warning="Este cambio afecta a días que la persona ya ha disfrutado."
          impact={<ImpactList impact={impact} />}
          onConfirm={({ reason }) => apply({ confirmText: 'CONFIRMAR', reason })}
        />
      )}
    </>
  );
}
