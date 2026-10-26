import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { VacationRequestDto } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { KIND_LABEL, PERIOD_LABEL, STATUS_ICON, STATUS_LABEL, daysLabel, fmtRange } from '@/lib/format';
import { REQUEST_DEPENDENT_KEYS } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const STATUS_VARIANT = { PENDING: 'warning', APPROVED: 'default', REJECTED: 'destructive', CANCELLED: 'secondary', REVOKED: 'destructive' } as const;

export function StatusBadge({ status }: { status: VacationRequestDto['status'] }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} data-testid={`status-${status}`}>
      <span aria-hidden>{STATUS_ICON[status]}</span> {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Lista de solicitudes con cancelar/modificar según `request.can`. */
export function RequestList({ requests, emptyText = 'No hay solicitudes.' }: { requests: VacationRequestDto[]; emptyText?: string }) {
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState<VacationRequestDto | null>(null);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: (r: VacationRequestDto) => api.post(`/requests/${r.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      toast.success('Solicitud cancelada.');
      setCancelling(null);
      setReason('');
      for (const k of REQUEST_DEPENDENT_KEYS) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!requests.length) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <>
      <ul className="divide-y" data-testid="request-list">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-testid={`request-${r.id}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {fmtRange(r.startDate, r.endDate)}
                {r.halfDay && <span className="ml-2 text-sm text-muted-foreground">(medio día, {PERIOD_LABEL[r.halfDay.period]})</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {r.kind === 'BIRTHDAY' ? '🎂 ' : ''}
                {KIND_LABEL[r.kind]} · {daysLabel(r.units)}
                {r.urgent && <span className="ml-2 font-medium text-destructive">· Urgente</span>}
                {r.replacesRequestId && ' · Modifica otra solicitud'}
              </p>
              {r.rejectionReason && <p className="text-sm text-destructive">Motivo del rechazo: {r.rejectionReason}</p>}
              {r.cancelReason && <p className="text-sm text-muted-foreground">Motivo: {r.cancelReason}</p>}
              {r.comment && <p className="truncate text-sm italic text-muted-foreground">«{r.comment}»</p>}
            </div>
            <StatusBadge status={r.status} />
            <div className="flex gap-2">
              {r.can.modify && (
                <Button asChild variant="outline" size="sm">
                  <Link to={`/requests/new?replaces=${r.id}`} data-testid={`request-modify-${r.id}`}>
                    Modificar
                  </Link>
                </Button>
              )}
              {r.can.cancel && (
                <Button variant="outline" size="sm" onClick={() => setCancelling(r)} data-testid={`request-cancel-${r.id}`}>
                  Cancelar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent data-testid="cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancelar solicitud</DialogTitle>
            <DialogDescription>
              {cancelling && `${fmtRange(cancelling.startDate, cancelling.endDate)}. Se te devolverán los días.`}
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="cancel-reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Volver
            </Button>
            <Button variant="destructive" disabled={cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling)} data-testid="cancel-confirm">
              Cancelar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
