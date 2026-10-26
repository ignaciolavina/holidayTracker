import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useNotifications } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  return { readAll, readOne };
}

export function NotificationBell() {
  const { data } = useNotifications();
  const { readAll, readOne } = useNotificationActions();
  const navigate = useNavigate();
  const unread = data?.unread ?? 0;
  const items = (data?.items ?? []).slice(0, 6);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'} data-testid="notification-bell">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span data-testid="notification-count" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
          <Button variant="link" size="sm" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()} data-testid="notifications-read-all">
            Marcar todas como leídas
          </Button>
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No tienes notificaciones.</p>}
        {items.map((n) => (
          <DropdownMenuItem
            key={n.id}
            className="flex-col items-start gap-0.5"
            onSelect={() => {
              if (!n.readAt) readOne.mutate(n.id);
              if (n.link) navigate(n.link);
            }}
          >
            <span className={cn('text-sm', !n.readAt && 'font-semibold')}>
              {!n.readAt && <span aria-label="Sin leer" className="mr-1 text-primary">●</span>}
              {n.title}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
            <span className="text-[10px] text-muted-foreground">{fmtDateTime(n.createdAt)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/notifications">Ver todas</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
