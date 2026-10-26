import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isValidDate, type RequestKind, type RequestPreview, type VacationRequestDto, type HalfDayPeriod } from '@ht/shared';
import { api } from '@/lib/api';
import { PERIOD_LABEL, KIND_LABEL } from '@/lib/format';
import { useUsers } from '@/lib/queries';
import { today } from '@/lib/today';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { PreviewPanel } from '@/features/requests/PreviewPanel';
import { UserSelect, invalidateRequests } from './common';

/** SPEC-11 punto 3: registro retroactivo para otro usuario. */
export function RetroactivePage() {
  const qc = useQueryClient();
  const users = useUsers();
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<RequestKind>('VACATION');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [half, setHalf] = useState(false);
  const [halfDate, setHalfDate] = useState('');
  const [period, setPeriod] = useState<HalfDayPeriod>('AM');
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<VacationRequestDto | null>(null);

  const input = useMemo(() => {
    if (!userId || !isValidDate(startDate) || !isValidDate(endDate)) return null;
    return {
      userId,
      kind,
      startDate,
      endDate,
      halfDay: half && isValidDate(halfDate) ? { date: halfDate, period } : null,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
  }, [userId, kind, startDate, endDate, half, halfDate, period, comment]);

  const preview = useQuery({
    queryKey: ['admin', 'retro-preview', input],
    enabled: !!input,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => api.post<RequestPreview>('/requests/preview', input),
  });
  const blocked = !input || !preview.data || preview.data.errors.length > 0 || preview.isError;
  const active = (users.data ?? []).filter((u) => u.status === 'active');

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="retro-page">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setOpen(true); }} data-testid="retro-form">
        <p className="text-sm text-muted-foreground">
          Registra ausencias ya ocurridas de otra persona. Se aprueban directamente y se descuentan del saldo. Usa la fecha de hoy ({today()}) como referencia.
        </p>
        <Field label="Persona" htmlFor="retro-user">
          <UserSelect id="retro-user" testId="retro-user" value={userId} onChange={setUserId} users={active} placeholder="Selecciona una persona" />
        </Field>
        <Field label="Tipo" htmlFor="retro-kind">
          <Select id="retro-kind" data-testid="retro-kind" value={kind} onChange={(e) => setKind(e.target.value as RequestKind)}>
            <option value="VACATION">{KIND_LABEL.VACATION}</option>
            <option value="BIRTHDAY">{KIND_LABEL.BIRTHDAY}</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde" htmlFor="retro-start">
            <Input id="retro-start" data-testid="retro-start" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }} />
          </Field>
          <Field label="Hasta" htmlFor="retro-end">
            <Input id="retro-end" data-testid="retro-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} data-testid="retro-half" /> Incluye medio día
        </label>
        {half && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Día de medio día" htmlFor="retro-half-date">
              <Input id="retro-half-date" type="date" value={halfDate} min={startDate} max={endDate} onChange={(e) => setHalfDate(e.target.value)} />
            </Field>
            <Field label="Mitad" htmlFor="retro-period">
              <Select id="retro-period" value={period} onChange={(e) => setPeriod(e.target.value as HalfDayPeriod)}>
                <option value="AM">{PERIOD_LABEL.AM}</option>
                <option value="PM">{PERIOD_LABEL.PM}</option>
              </Select>
            </Field>
          </div>
        )}
        <Field label="Comentario (opcional)" htmlFor="retro-comment">
          <Textarea id="retro-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
        </Field>
        <Button type="submit" variant="destructive" disabled={blocked} data-testid="retro-submit">
          Registrar…
        </Button>
        {created && (
          <Alert variant="info" data-testid="retro-done">
            Registrada.{' '}
            <Link className="font-medium underline" to={`/approvals/${created.id}`}>
              Ver solicitud
            </Link>
          </Alert>
        )}
      </form>

      <div>
        <h2 className="mb-2 text-base font-semibold">Previsualización</h2>
        {!input && <p className="text-sm text-muted-foreground">Elige persona y fechas para ver el cómputo.</p>}
        {preview.isError && <Alert variant="destructive">No se ha podido calcular la previsualización.</Alert>}
        {preview.data && input && <PreviewPanel preview={preview.data} stale={preview.isFetching} />}
      </div>

      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        testId="retro"
        title="Registro retroactivo"
        confirmWord="REGISTRAR"
        confirmLabel="Registrar ausencia"
        warning="Se registrará una ausencia aprobada en el pasado y se descontará del saldo de la persona."
        impact={preview.data?.computation?.summary}
        onConfirm={async ({ reason }) => {
          if (!input) throw new Error('Completa el formulario.');
          const res = await api.post<VacationRequestDto>('/requests/retroactive', {
            userId: input.userId,
            kind: input.kind,
            startDate: input.startDate,
            endDate: input.endDate,
            ...(input.halfDay ? { halfDay: input.halfDay } : {}),
            ...(input.comment ? { comment: input.comment } : {}),
            reason,
            confirmText: 'REGISTRAR',
          });
          toast.success('Ausencia registrada.');
          setCreated(res ?? null);
          invalidateRequests(qc);
        }}
      />
    </div>
  );
}
