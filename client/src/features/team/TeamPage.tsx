import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthOf, yearOf, type CalendarAbsence } from '@ht/shared';
import { useOrgTree, useTeamCalendar } from '@/lib/queries';
import { today } from '@/lib/today';
import { MONTH_NAMES, PERIOD_LABEL, STATUS_LABEL, cap, fmtDateLong, KIND_LABEL } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader, Loading } from '@/components/PageHeader';
import { Legend } from '@/components/Legend';
import { STRIPES } from '@/components/calendar/cellStyle';
import { cn } from '@/lib/utils';

const v = (k: string, p: 'bg' | 'fg' | 'border') => `var(--c-${k}-${p})`;

function absenceCell(list: CalendarAbsence[]) {
  if (!list.length) return null;
  const a = list[0]!;
  const half = a.units === 1;
  const pending = a.status === 'PENDING';
  const key = a.kind === 'BIRTHDAY' ? 'birthday' : 'approved';
  const color = pending ? v('pending', 'bg') : v(key, 'bg');
  const style: React.CSSProperties = half
    ? { backgroundImage: a.period === 'PM' ? `linear-gradient(to bottom right, transparent 50%, ${color} 50%)` : `linear-gradient(to bottom right, ${color} 50%, transparent 50%)` }
    : pending
      ? { backgroundImage: STRIPES('pending') }
      : { backgroundColor: color };
  style.border = pending ? `1px dashed ${v('pending', 'border')}` : `1px solid ${v(key, 'border')}`;
  return { style, icon: a.kind === 'BIRTHDAY' ? '🎂' : half ? '◐' : pending ? '⏳' : '✓', fg: half ? 'inherit' : pending ? v('pending', 'fg') : v(key, 'fg') };
}

/** SPEC-17. Usuarios × días del mes. No muestra saldos ni comentarios. */
export default function TeamPage() {
  const now = today();
  const [year, setYear] = useState(yearOf(now));
  const [month, setMonth] = useState(monthOf(now));
  const [scope, setScope] = useState<'all' | 'branch' | 'manager'>('all');
  const [managerId, setManagerId] = useState('');
  const org = useOrgTree();
  const managers = (org.data ?? []).filter((n) => n.directReports > 0);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const q = useTeamCalendar({ month: monthKey, scope, managerId: scope === 'manager' && managerId ? managerId : undefined });
  const data = q.data;

  const byUserDate = useMemo(() => {
    const m = new Map<string, CalendarAbsence[]>();
    for (const a of data?.absences ?? []) m.set(`${a.userId}|${a.date}`, [...(m.get(`${a.userId}|${a.date}`) ?? []), a]);
    return m;
  }, [data]);
  const totals = useMemo(() => new Map((data?.totals ?? []).map((t) => [t.date, t.count])), [data]);

  const shift = (d: number) => {
    let m = month + d;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m);
    setYear(y);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Calendario de equipo" description="Quién está fuera cada día. No se muestran saldos ni comentarios." />
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Ámbito" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="w-52" data-testid="team-scope">
          <option value="all">Todo el equipo</option>
          <option value="branch">Mi rama</option>
          <option value="manager">Reportes de un manager</option>
        </Select>
        {scope === 'manager' && (
          <Select aria-label="Manager" value={managerId} onChange={(e) => setManagerId(e.target.value)} className="w-56" data-testid="team-manager">
            <option value="">Elige un manager…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Mes anterior" onClick={() => shift(-1)} data-testid="team-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-semibold" data-testid="team-title">
            {cap(MONTH_NAMES[month - 1]!)} {year}
          </span>
          <Button variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => shift(1)} data-testid="team-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {q.isLoading && <Loading />}
      {q.isError && <Alert variant="destructive">No se ha podido cargar el calendario de equipo.</Alert>}
      {scope === 'manager' && !managerId && <Alert variant="info">Elige un manager para ver a sus reportes.</Alert>}

      {data && (
        <div className="overflow-x-auto rounded-lg border" data-testid="team-table">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-40 bg-card p-2 text-left text-sm">Persona</th>
                {data.days.map((d) => {
                  const day = Number(d.date.slice(8));
                  const hol = d.holiday;
                  return (
                    <th
                      key={d.date}
                      title={hol ? `${fmtDateLong(d.date)}: ${hol.name}` : fmtDateLong(d.date)}
                      className="h-8 w-7 min-w-7 border-l p-0 text-center font-medium"
                      style={d.weekend ? { backgroundColor: v('weekend', 'bg'), color: v('weekend', 'fg') } : hol ? { backgroundColor: v(hol.scope === 'national' ? 'holidayNational' : hol.scope === 'regional' ? 'holidayRegional' : 'holidayLocal', 'bg'), color: v(hol.scope === 'national' ? 'holidayNational' : hol.scope === 'regional' ? 'holidayRegional' : 'holidayLocal', 'fg') } : d.date === now ? { boxShadow: `inset 0 0 0 2px ${v('today', 'border')}` } : undefined}
                    >
                      {day}
                      {hol && <span aria-hidden className="block text-[8px] leading-none">{hol.scope === 'national' ? 'N' : hol.scope === 'regional' ? 'A' : 'L'}</span>}
                      {d.weekend && <span className="sr-only"> fin de semana</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t" data-testid={`team-row-${u.id}`}>
                  <th scope="row" className="sticky left-0 z-10 bg-card p-1.5 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <Avatar name={u.name} url={u.avatarUrl} className="h-6 w-6 text-[10px]" />
                      <span className="max-w-32 truncate text-sm">{u.name}</span>
                    </span>
                  </th>
                  {data.days.map((d) => {
                    const list = byUserDate.get(`${u.id}|${d.date}`) ?? [];
                    const c = absenceCell(list);
                    const base: React.CSSProperties | undefined = d.weekend ? { backgroundColor: v('weekend', 'bg') } : d.holiday ? { backgroundColor: v(d.holiday.scope === 'national' ? 'holidayNational' : d.holiday.scope === 'regional' ? 'holidayRegional' : 'holidayLocal', 'bg'), opacity: 0.55 } : undefined;
                    const label = list.length
                      ? `${u.name}, ${fmtDateLong(d.date)}: ${list.map((a) => `${KIND_LABEL[a.kind]} ${a.units === 1 ? `medio día${a.period ? ` (${PERIOD_LABEL[a.period]})` : ''}` : 'día completo'}, ${STATUS_LABEL[a.status].toLowerCase()}`).join('; ')}`
                      : undefined;
                    return (
                      <td key={d.date} className="h-8 w-7 min-w-7 border-l p-0" style={base}>
                        {c && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div role="img" aria-label={label} data-testid={`team-abs-${u.id}-${d.date}`} className="flex h-full min-h-8 w-full items-center justify-center text-[10px]" style={{ ...c.style, color: c.fg }}>
                                <span aria-hidden>{c.icon}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 font-semibold" data-testid="team-totals">
                <th scope="row" className="sticky left-0 z-10 bg-card p-2 text-left text-sm">
                  Fuera cada día
                </th>
                {data.days.map((d) => {
                  const n = totals.get(d.date) ?? 0;
                  const over = n > data.threshold;
                  return (
                    <td
                      key={d.date}
                      data-over={over || undefined}
                      title={over ? `${n} personas fuera: supera el umbral de ${data.threshold}` : undefined}
                      className={cn('h-8 border-l text-center', over && 'font-bold')}
                      style={over ? { backgroundColor: v('negative', 'bg'), color: v('negative', 'fg'), boxShadow: `inset 0 0 0 1px ${v('negative', 'border')}` } : undefined}
                    >
                      {n || ''}
                      {over && <span aria-hidden>!</span>}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="text-xs text-muted-foreground">Se resalta con «!» el total cuando hay más de {data.threshold} personas fuera.</p>}
      <Legend />
    </div>
  );
}
