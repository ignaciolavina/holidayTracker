import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { PageHeader, Loading } from '@/components/PageHeader';
import { useNotificationActions } from '@/components/NotificationBell';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const { data, isLoading, isError } = useNotifications();
  const { readAll, readOne } = useNotificationActions();
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader
        title="Notificaciones"
        description={data ? `${data.unread} sin leer` : undefined}
        actions={
          <Button variant="outline" disabled={!data?.unread || readAll.isPending} onClick={() => readAll.mutate()} data-testid="notifications-page-read-all">
            Marcar todas como leídas
          </Button>
        }
      />
      {isLoading && <Loading />}
      {isError && <Alert variant="destructive">No se han podido cargar las notificaciones.</Alert>}
      {data && data.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No tienes notificaciones.</p>}
      <Card>
        <ul className="divide-y" data-testid="notification-list">
          {data?.items.map((n) => (
            <li key={n.id} data-testid={`notification-${n.id}`} data-unread={!n.readAt || undefined}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  if (!n.readAt) readOne.mutate(n.id);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className={cn('text-sm', !n.readAt && 'font-semibold')}>
                  {!n.readAt && <span className="mr-1 text-primary" aria-label="Sin leer">●</span>}
                  {n.title}
                </span>
                <span className="text-sm text-muted-foreground">{n.body}</span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
