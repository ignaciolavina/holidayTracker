import { addDays } from '@ht/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { PERIOD_LABEL, fmtDateShort } from '@/lib/format';
import { useOut } from '@/lib/queries';
import { today } from '@/lib/today';

export function OutWidget() {
  const now = today();
  const { data, isLoading, isError } = useOut(now, addDays(now, 6));
  const todays = data?.absences.filter((a) => a.date === now) ?? [];
  const week = (data?.absences ?? []).filter((a) => a.date > now);
  const row = (a: NonNullable<typeof data>['absences'][number], showDate: boolean) => (
    <li key={`${a.requestId}-${a.date}`} className="flex items-center gap-2 py-1 text-sm">
      <Avatar name={a.userName} url={a.avatarUrl} className="h-6 w-6 text-[10px]" />
      <span className="flex-1 truncate">{a.userName}</span>
      <span className="text-xs text-muted-foreground">
        {showDate && fmtDateShort(a.date)}
        {a.period && ` · ${PERIOD_LABEL[a.period]}`}
      </span>
    </li>
  );
  return (
    <Card data-testid="out-widget">
      <CardHeader>
        <CardTitle>Quién está fuera</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {isError && <p className="text-sm text-destructive">No se ha podido cargar.</p>}
        {data && (
          <>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hoy</h3>
              {todays.length ? <ul>{todays.map((a) => row(a, false))}</ul> : <p className="text-sm text-muted-foreground">Nadie está fuera hoy.</p>}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Esta semana</h3>
              {week.length ? <ul>{week.map((a) => row(a, true))}</ul> : <p className="text-sm text-muted-foreground">Nadie más en los próximos 6 días.</p>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
