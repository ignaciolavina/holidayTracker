import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InvitationDto, UserDetail, VacationRequestDto } from '@ht/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { REQUEST_DEPENDENT_KEYS } from '@/lib/queries';
import { KIND_LABEL, daysLabel, fmtRange } from '@/lib/format';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/features/requests/RequestList';

/** Lista completa de usuarios (UserDetail[] para admin). Comparte prefijo ['users'] con useUsers. */
export const useAdminUsers = () =>
  useQuery({ queryKey: ['users', 'admin'], queryFn: () => api.get<UserDetail[]>('/users'), staleTime: 60_000 });

export const useInvitations = () =>
  useQuery({ queryKey: ['admin', 'invitations'], queryFn: () => api.get<InvitationDto[]>('/invitations') });

/** Invalida todo lo que depende de solicitudes, saldos y del panel. */
export function invalidateRequests(qc: QueryClient) {
  for (const k of REQUEST_DEPENDENT_KEYS) void qc.invalidateQueries({ queryKey: [k] });
  void qc.invalidateQueries({ queryKey: ['admin'] });
}

export const LEDGER_LABEL: Record<string, string> = {
  ANNUAL_ALLOWANCE: 'Días anuales',
  BIRTHDAY_ALLOWANCE: 'Día de cumpleaños',
  CARRYOVER_IN: 'Arrastre entrante',
  CARRYOVER_EXPIRY: 'Caducidad de arrastrados',
  BIRTHDAY_EXPIRY: 'Caducidad de cumpleaños',
  NEGATIVE_CARRYOVER: 'Arrastre negativo',
  CONSUMPTION: 'Consumo',
  REFUND: 'Devolución',
  REALLOCATION: 'Reasignación',
  HOLIDAY_RECALC: 'Recálculo por festivo',
  ADJUSTMENT: 'Ajuste manual',
  PRORATION_ADJUSTMENT: 'Ajuste de prorrateo',
};

export function Section({ title, count, children, testId, tone }: { title: string; count?: number; children: ReactNode; testId?: string; tone?: 'danger' }) {
  return (
    <section className="rounded-lg border bg-card p-4" data-testid={testId} aria-label={title}>
      <h2 className={`mb-3 flex items-center gap-2 text-base font-semibold ${tone === 'danger' ? 'text-destructive' : ''}`}>
        {title}
        {count !== undefined && <Badge variant="secondary">{count}</Badge>}
      </h2>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** Error de API; en 422 relacionados con reportes directos guía al organigrama. */
export function ApiErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const reports = !!e && e.status === 422 && (/DIRECT_REPORTS/i.test(e.code) || /report|subordinad/i.test(e.message));
  return (
    <Alert variant="destructive" data-testid="admin-error">
      <p>{errorMessage(error)}</p>
      {reports && (
        <p className="mt-1">
          <Link to="/admin/org" className="font-medium underline">
            Reasigna primero a sus reportes en el organigrama
          </Link>
          .
        </p>
      )}
    </Alert>
  );
}

export function UserSelect({
  value,
  onChange,
  users,
  placeholder = 'Selecciona…',
  id,
  testId,
  allowNone,
  noneLabel = 'Sin manager',
}: {
  value: string;
  onChange: (v: string) => void;
  users: { id: string; name: string }[];
  placeholder?: string;
  id?: string;
  testId?: string;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <Select id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowNone ? noneLabel : placeholder}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}

/** Fila de solicitud con insignias y enlace a la página del aprobador. */
export function RequestRow({ r, actions }: { r: VacationRequestDto; actions?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" data-testid={`admin-request-${r.id}`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.userName}</span>
          <StatusBadge status={r.status} />
          {r.urgent && <Badge variant="destructive">Urgente</Badge>}
          {r.escalatedAt && <Badge variant="warning">Escalada</Badge>}
          {r.retroactive && <Badge variant="outline">Retroactiva</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {KIND_LABEL[r.kind]} · {fmtRange(r.startDate, r.endDate)} · {daysLabel(r.units)}
        </p>
        {r.comment && <p className="truncate text-xs italic text-muted-foreground">“{r.comment}”</p>}
        <Link to={`/approvals/${r.id}`} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
          Ver detalle
        </Link>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </li>
  );
}

export function UserLine({ name, avatarUrl, children }: { name: string; avatarUrl?: string | null; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} url={avatarUrl} className="h-6 w-6 text-[10px]" />
      <span>{name}</span>
      {children}
    </span>
  );
}

/** Aprobar / rechazar según request.can. Maneja STARTED_ACK_REQUIRED y el motivo obligatorio al rechazar. */
export function DecisionButtons({ request, onDone }: { request: VacationRequestDto; onDone?: () => void }) {
  const qc = useQueryClient();
  const [ackMsg, setAckMsg] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: (acknowledgeStarted: boolean) =>
      api.post(`/requests/${request.id}/approve`, acknowledgeStarted ? { acknowledgeStarted: true } : {}),
    onSuccess: () => {
      toast.success(`Solicitud de ${request.userName} aprobada.`);
      setAckMsg(null);
      invalidateRequests(qc);
      onDone?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422 && e.code === 'STARTED_ACK_REQUIRED') {
        setAckMsg(e.message);
        return;
      }
      setAckMsg(null);
      toast.error(errorMessage(e));
    },
  });

  const reject = useMutation({
    mutationFn: () => api.post(`/requests/${request.id}/reject`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success(`Solicitud de ${request.userName} rechazada.`);
      setRejectOpen(false);
      setReason('');
      invalidateRequests(qc);
      onDone?.();
    },
    onError: (e) => setRejectError(errorMessage(e)),
  });

  if (!request.can.approve && !request.can.reject) return null;
  return (
    <>
      {request.can.approve && (
        <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(false)} data-testid={`approve-${request.id}`}>
          Aprobar
        </Button>
      )}
      {request.can.reject && (
        <Button size="sm" variant="outline" onClick={() => { setRejectError(null); setRejectOpen(true); }} data-testid={`reject-${request.id}`}>
          Rechazar
        </Button>
      )}

      <Dialog open={ackMsg !== null} onOpenChange={(o) => !o && setAckMsg(null)}>
        <DialogContent data-testid="started-ack-dialog">
          <DialogHeader>
            <DialogTitle>La solicitud ya ha empezado</DialogTitle>
            <DialogDescription>{ackMsg}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">¿Quieres aprobarla igualmente? Los días ya transcurridos se registrarán como disfrutados.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckMsg(null)}>
              Volver
            </Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate(true)} data-testid={`approve-ack-${request.id}`}>
              Aprobar igualmente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent data-testid="reject-dialog">
          <DialogHeader>
            <DialogTitle>Rechazar solicitud de {request.userName}</DialogTitle>
            <DialogDescription>
              {fmtRange(request.startDate, request.endDate)} · {daysLabel(request.units)}. El motivo se enviará a la persona solicitante.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`reject-reason-${request.id}`}>Motivo (obligatorio)</Label>
            <Textarea id={`reject-reason-${request.id}`} data-testid="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </div>
          {rejectError && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {rejectError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Volver
            </Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || reject.isPending} onClick={() => reject.mutate()} data-testid="reject-confirm">
              Rechazar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
