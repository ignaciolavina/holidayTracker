import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { APPROVAL_POLICIES, BIRTHDAY_WINDOW_MODES, TEAM_VISIBILITY, daysToUnits, settingsPatchSchema, unitsToDays, type Settings } from '@ht/shared';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Loading } from '@/components/PageHeader';
import { ApiErrorBox } from './common';

interface Form {
  defaultAnnualDays: string;
  birthdayEnabled: boolean;
  birthdayMode: Settings['birthdayWindow']['mode'];
  birthdayDays: string;
  negativeLimitDays: string;
  carryoverCapDays: string;
  approvalPolicy: Settings['approvalPolicy'];
  escalationHours: string;
  teamVisibility: Settings['teamVisibility'];
  teamOutThreshold: string;
  weekendDays: number[];
  futureYearsAllowed: string;
  reason: string;
}
const toForm = (s: Settings): Form => ({
  defaultAnnualDays: String(unitsToDays(s.defaultAnnualUnits)),
  birthdayEnabled: s.birthdayEnabled,
  birthdayMode: s.birthdayWindow.mode,
  birthdayDays: String(s.birthdayWindow.days),
  negativeLimitDays: String(unitsToDays(s.negativeLimitUnits)),
  carryoverCapDays: String(unitsToDays(s.carryoverCapUnits)),
  approvalPolicy: s.approvalPolicy,
  escalationHours: String(s.escalationHours),
  teamVisibility: s.teamVisibility,
  teamOutThreshold: String(s.teamOutThreshold),
  weekendDays: s.weekendDays,
  futureYearsAllowed: String(s.futureYearsAllowed),
  reason: '',
});
const MODE_LABEL = { sameMonth: 'Durante el mes del cumpleaños', plusMinusDays: '± N días alrededor', year: 'Cualquier día del año' } as const;
const WEEKDAYS: Array<[number, string]> = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];

/** Convierte "1,5" en unidades (medios días). Lanza si no es múltiplo de 0,5. */
const toUnits = (v: string) => daysToUnits(Number(v.replace(',', '.')));

export function SettingsPage() {
  const q = useSettings();
  const qc = useQueryClient();
  const [f, setF] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setF(toForm(q.data)); }, [q.data]);

  const save = useMutation({
    mutationFn: (body: unknown) => api.patch<Settings>('/settings', body),
    onSuccess: (s) => {
      toast.success('Configuración guardada.');
      if (s) qc.setQueryData(['settings'], s);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['admin'] });
      setErr(null);
    },
    onError: (e) => setErr(e),
  });

  if (!f || !q.data) return <Loading />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p!, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setErr(null);
    try {
      const body = {
        defaultAnnualUnits: toUnits(f!.defaultAnnualDays),
        birthdayEnabled: f!.birthdayEnabled,
        birthdayWindow: { mode: f!.birthdayMode, days: Number(f!.birthdayDays) },
        negativeLimitUnits: toUnits(f!.negativeLimitDays),
        carryoverCapUnits: toUnits(f!.carryoverCapDays),
        approvalPolicy: f!.approvalPolicy,
        escalationHours: Number(f!.escalationHours),
        teamVisibility: f!.teamVisibility,
        teamOutThreshold: Number(f!.teamOutThreshold),
        weekendDays: f!.weekendDays,
        futureYearsAllowed: Number(f!.futureYearsAllowed),
        ...(f!.reason.trim() ? { reason: f!.reason.trim() } : {}),
      };
      const parsed = settingsPatchSchema.safeParse(body);
      if (!parsed.success) {
        setFormError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
        return;
      }
      save.mutate(parsed.data);
    } catch {
      setFormError('Los días deben ser múltiplos de 0,5.');
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-2" data-testid="settings-form">
      <Field label="Días anuales por defecto" htmlFor="s-annual" hint="Para nuevas altas"><Input id="s-annual" data-testid="settings-annual" inputMode="decimal" value={f.defaultAnnualDays} onChange={(e) => set('defaultAnnualDays', e.target.value)} /></Field>
      <Field label="Límite de saldo negativo (días)" htmlFor="s-neg"><Input id="s-neg" inputMode="decimal" value={f.negativeLimitDays} onChange={(e) => set('negativeLimitDays', e.target.value)} /></Field>
      <Field label="Tope de días arrastrados" htmlFor="s-cap" hint="0 = sin tope"><Input id="s-cap" inputMode="decimal" value={f.carryoverCapDays} onChange={(e) => set('carryoverCapDays', e.target.value)} /></Field>
      <Field label="Años futuros permitidos" htmlFor="s-future"><Input id="s-future" type="number" min={0} max={3} value={f.futureYearsAllowed} onChange={(e) => set('futureYearsAllowed', e.target.value)} /></Field>
      <Field label="Política de aprobación" htmlFor="s-policy">
        <Select id="s-policy" value={f.approvalPolicy} onChange={(e) => set('approvalPolicy', e.target.value as Form['approvalPolicy'])}>
          {APPROVAL_POLICIES.map((p) => <option key={p} value={p}>{p === 'any_admin' ? 'Cualquier administrador' : 'Cadena de managers'}</option>)}
        </Select>
      </Field>
      <Field label="Horas hasta escalar" htmlFor="s-esc"><Input id="s-esc" type="number" min={1} value={f.escalationHours} onChange={(e) => set('escalationHours', e.target.value)} /></Field>
      <Field label="Visibilidad del equipo" htmlFor="s-vis">
        <Select id="s-vis" value={f.teamVisibility} onChange={(e) => set('teamVisibility', e.target.value as Form['teamVisibility'])}>
          {TEAM_VISIBILITY.map((v) => <option key={v} value={v}>{v === 'company' ? 'Toda la empresa' : 'Solo mi rama'}</option>)}
        </Select>
      </Field>
      <Field label="Umbral de personas fuera" htmlFor="s-thr" hint="Se resalta el día a partir de este número"><Input id="s-thr" type="number" min={1} value={f.teamOutThreshold} onChange={(e) => set('teamOutThreshold', e.target.value)} /></Field>
      <fieldset className="space-y-2 rounded-md border p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium">Día de cumpleaños</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.birthdayEnabled} onChange={(e) => set('birthdayEnabled', e.target.checked)} data-testid="settings-birthday" /> Activado</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ventana" htmlFor="s-bwin"><Select id="s-bwin" disabled={!f.birthdayEnabled} value={f.birthdayMode} onChange={(e) => set('birthdayMode', e.target.value as Form['birthdayMode'])}>{BIRTHDAY_WINDOW_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select></Field>
          <Field label="Días (solo para ±N)" htmlFor="s-bdays"><Input id="s-bdays" type="number" min={0} max={183} disabled={!f.birthdayEnabled || f.birthdayMode !== 'plusMinusDays'} value={f.birthdayDays} onChange={(e) => set('birthdayDays', e.target.value)} /></Field>
        </div>
      </fieldset>
      <fieldset className="rounded-md border p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium">Días de fin de semana</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {WEEKDAYS.map(([n, label]) => (
            <label key={n} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.weekendDays.includes(n)} onChange={(e) => set('weekendDays', e.target.checked ? [...f.weekendDays, n] : f.weekendDays.filter((x) => x !== n))} /> {label}</label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2"><Field label="Motivo del cambio (opcional)" htmlFor="s-reason"><Textarea id="s-reason" data-testid="settings-reason" value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={1000} /></Field></div>
      {formError && <p className="text-sm font-medium text-destructive sm:col-span-2" role="alert">{formError}</p>}
      {err != null && <div className="sm:col-span-2"><ApiErrorBox error={err} /></div>}
      <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending} data-testid="settings-save">Guardar configuración</Button></div>
    </form>
  );
}
