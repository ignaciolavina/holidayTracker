import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isValidDate, type HalfDayPeriod, type RequestInput, type RequestKind, type VacationRequestDto } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { REQUEST_DEPENDENT_KEYS, usePreview, useRequest } from '@/lib/queries';
import { today } from '@/lib/today';
import { fmtRange } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/PageHeader';
import { PreviewPanel } from './PreviewPanel';

type Mode = 'range' | 'day' | 'half';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'range', label: 'Rango de días' },
  { id: 'day', label: 'Un solo día' },
  { id: 'half', label: 'Medio día' },
];

/** Solicitud nueva o modificación (?replaces=ID). Parámetros opcionales: start, end, kind. */
export default function RequestPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const replacesId = params.get('replaces');
  const original = useRequest(replacesId);

  const qStart = params.get('start');
  const qEnd = params.get('end');
  const [kind, setKind] = useState<RequestKind>(params.get('kind') === 'BIRTHDAY' ? 'BIRTHDAY' : 'VACATION');
  const [mode, setMode] = useState<Mode>(qStart && qEnd && qStart !== qEnd ? 'range' : qStart ? 'day' : 'range');
  const [start, setStart] = useState(qStart && isValidDate(qStart) ? qStart : '');
  const [end, setEnd] = useState(qEnd && isValidDate(qEnd) ? qEnd : qStart && isValidDate(qStart) ? qStart : '');
  const [period, setPeriod] = useState<HalfDayPeriod>('AM');
  const [comment, setComment] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Modificar: precarga los datos de la solicitud original una sola vez
  useEffect(() => {
    const r: VacationRequestDto | undefined = original.data;
    if (!r || prefilled) return;
    setPrefilled(true);
    setKind(r.kind);
    setStart(r.startDate);
    setEnd(r.endDate);
    setComment(r.comment ?? '');
    if (r.halfDay) {
      setMode('half');
      setPeriod(r.halfDay.period);
    } else setMode(r.startDate === r.endDate ? 'day' : 'range');
  }, [original.data, prefilled]);

  const effectiveMode: Mode = kind === 'BIRTHDAY' ? 'day' : mode;
  const effectiveEnd = effectiveMode === 'range' ? end : start;

  const input = useMemo<RequestInput | null>(() => {
    if (!isValidDate(start) || !isValidDate(effectiveEnd) || effectiveEnd < start) return null;
    const base: RequestInput = { kind, startDate: start, endDate: effectiveEnd };
    if (effectiveMode === 'half') base.halfDay = { date: start, period };
    if (comment.trim()) base.comment = comment.trim();
    if (replacesId) base.replacesRequestId = replacesId;
    return base;
  }, [kind, start, effectiveEnd, effectiveMode, period, comment, replacesId]);

  // El comentario no cambia el cómputo: no se incluye en la previsualización
  const previewInput = useMemo(() => {
    if (!input) return null;
    const { comment: _c, ...rest } = input;
    return rest as RequestInput;
  }, [input]);
  const debounced = useDebounced(previewInput, 400);
  const settled = JSON.stringify(debounced) === JSON.stringify(previewInput);
  const preview = usePreview(debounced);
  const data = preview.data;

  const blocked = !input || !settled || preview.isFetching || !data || data.errors.length > 0 || !data.computation;

  const submit = useMutation({
    mutationFn: (body: RequestInput) => api.post<VacationRequestDto>('/requests', body),
    onSuccess: () => {
      toast.success(replacesId ? 'Modificación enviada. Tu solicitud original se mantiene hasta que se apruebe.' : 'Solicitud enviada.');
      for (const k of REQUEST_DEPENDENT_KEYS) qc.invalidateQueries({ queryKey: [k] });
      navigate('/');
    },
    onError: (e) => setSubmitError(errorMessage(e)),
  });

  const min = today();
  return (
    <div>
      <PageHeader title={replacesId ? 'Modificar solicitud' : 'Solicitar vacaciones'} description="Elige las fechas: el servidor calcula cuántos días computan y te lo muestra antes de enviar." />
      {replacesId && original.data && (
        <Alert variant="info" className="mb-4" data-testid="replaces-info">
          Estás modificando la solicitud del {fmtRange(original.data.startDate, original.data.endDate)}. Seguirá vigente hasta que se apruebe la nueva.
        </Alert>
      )}
      {replacesId && original.isError && <Alert variant="destructive" className="mb-4">{errorMessage(original.error)}</Alert>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fechas</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              data-testid="request-form"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitError(null);
                if (input && !blocked) submit.mutate(input);
              }}
            >
              <Field label="Tipo" htmlFor="kind">
                <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as RequestKind)} data-testid="request-kind">
                  <option value="VACATION">Vacaciones</option>
                  <option value="BIRTHDAY">Día de cumpleaños 🎂</option>
                </Select>
              </Field>

              <div role="group" aria-label="Duración" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={effectiveMode === m.id}
                    disabled={kind === 'BIRTHDAY' && m.id !== 'day'}
                    data-testid={`mode-${m.id}`}
                    onClick={() => setMode(m.id)}
                    className={cn('rounded px-2 py-1.5 text-sm font-medium disabled:opacity-40', effectiveMode === m.id ? 'bg-background shadow-sm' : 'text-muted-foreground')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className={cn('grid gap-3', effectiveMode === 'range' && 'sm:grid-cols-2')}>
                <Field label={effectiveMode === 'range' ? 'Desde' : 'Fecha'} htmlFor="start">
                  <Input
                    id="start"
                    type="date"
                    min={min}
                    value={start}
                    data-testid="request-start"
                    onChange={(e) => {
                      setStart(e.target.value);
                      if (effectiveMode !== 'range' || !end || end < e.target.value) setEnd(e.target.value);
                    }}
                  />
                </Field>
                {effectiveMode === 'range' && (
                  <Field label="Hasta (incluido)" htmlFor="end">
                    <Input id="end" type="date" min={start || min} value={end} onChange={(e) => setEnd(e.target.value)} data-testid="request-end" />
                  </Field>
                )}
              </div>

              {effectiveMode === 'half' && (
                <Field label="¿Qué parte del día?" htmlFor="period">
                  <Select id="period" value={period} onChange={(e) => setPeriod(e.target.value as HalfDayPeriod)} data-testid="request-period">
                    <option value="AM">Mañana</option>
                    <option value="PM">Tarde</option>
                  </Select>
                </Field>
              )}

              <Field label="Comentario (opcional)" htmlFor="comment">
                <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} data-testid="request-comment" />
              </Field>

              {submitError && (
                <Alert variant="destructive" data-testid="request-error">
                  {submitError}
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" disabled={blocked || submit.isPending} data-testid="request-submit">
                  {submit.isPending ? 'Enviando…' : replacesId ? 'Enviar modificación' : 'Enviar solicitud'}
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={() => navigate(-1)} data-testid="request-back">
                  Volver
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Previsualización</CardTitle>
          </CardHeader>
          <CardContent>
            {!input ? (
              <p className="text-sm text-muted-foreground" data-testid="preview-empty">
                Elige las fechas para ver el cómputo.
              </p>
            ) : preview.isError && !data ? (
              <Alert variant="destructive">{errorMessage(preview.error)}</Alert>
            ) : !data ? (
              <p className="text-sm text-muted-foreground" role="status">
                Calculando…
              </p>
            ) : (
              <PreviewPanel preview={data} stale={!settled || preview.isFetching} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
