import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthOf, yearOf } from '@ht/shared';
import { useAuth } from '@/lib/auth';
import { useCalendar, useSettings, useUsers } from '@/lib/queries';
import { today } from '@/lib/today';
import { MONTH_NAMES, cap } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { PageHeader, Loading } from '@/components/PageHeader';
import { Legend } from '@/components/Legend';
import { MiniMonth } from '@/components/calendar/MiniMonth';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { makeDayLookup } from '@/components/calendar/model';
import { UserRequestsPanel } from '@/features/admin/UserRequestsPanel';

/** SPEC-16. /calendar (propio) y /calendar/:userId (admin, solo lectura). */
export default function CalendarPage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const now = today();
  const [view, setView] = useState<'year' | 'month'>('year');
  const [year, setYear] = useState(yearOf(now));
  const [month, setMonth] = useState(monthOf(now));

  const isOther = !!userId && userId !== user?.id;
  const cal = useCalendar(year, isOther ? userId : undefined);
  const settings = useSettings();
  const users = useUsers(isOther);
  const target = users.data?.find((u) => u.id === userId);
  const weekendDays = settings.data?.weekendDays;
  const lookup = useMemo(() => makeDayLookup(cal.data, weekendDays ?? [6, 0], now), [cal.data, weekendDays, now]);

  const shiftMonth = (d: number) => {
    let m = month + d;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m);
    setYear(y);
  };

  const title = isOther ? `Calendario de ${target?.name ?? 'usuario'}` : 'Mi calendario';
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={isOther ? 'Vista de solo lectura (administrador).' : 'Haz clic en un día o arrastra un rango en la vista mensual para solicitarlo.'} />
      <Tabs value={view} onValueChange={(v) => setView(v as 'year' | 'month')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="year" data-testid="tab-year">Anual</TabsTrigger>
            <TabsTrigger value="month" data-testid="tab-month">Mensual</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label={view === 'year' ? 'Año anterior' : 'Mes anterior'} onClick={() => (view === 'year' ? setYear(year - 1) : shiftMonth(-1))} data-testid="cal-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite" data-testid="cal-title">
              {view === 'year' ? year : `${cap(MONTH_NAMES[month - 1]!)} ${year}`}
            </span>
            <Button variant="outline" size="icon" aria-label={view === 'year' ? 'Año siguiente' : 'Mes siguiente'} onClick={() => (view === 'year' ? setYear(year + 1) : shiftMonth(1))} data-testid="cal-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setYear(yearOf(now)); setMonth(monthOf(now)); }}>
              Hoy
            </Button>
          </div>
        </div>

        {cal.isLoading && <Loading />}
        {cal.isError && <Alert variant="destructive" className="mt-3">No se ha podido cargar el calendario.</Alert>}

        <TabsContent value="year">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4" data-testid="year-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <MiniMonth key={i} year={year} month={i + 1} lookup={lookup} onOpenMonth={(m) => { setMonth(m); setView('month'); }} />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="month">
          <MonthGrid
            year={year}
            month={month}
            lookup={lookup}
            onSelect={isOther ? undefined : (s, e) => navigate(`/requests/new?start=${s}&end=${e}`)}
          />
        </TabsContent>
      </Tabs>
      <Legend />
      {isOther && cal.data && <UserRequestsPanel requests={cal.data.requests} />}
    </div>
  );
}
