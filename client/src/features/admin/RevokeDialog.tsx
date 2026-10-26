import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isValidDate, type VacationRequestDto } from '@ht/shared';
import { api } from '@/lib/api';
import { daysLabel, fmtRange } from '@/lib/format';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { invalidateRequests } from './common';

interface RevokePreview {
  refundUnits: number;
  enjoyedUnits: number;
  touchesEnjoyed: boolean;
  message: string;
}

/** SPEC-11 punto 2: anular una solicitud aprobada (total o desde una fecha). El servidor calcula el impacto. */
export function RevokeDialog({ request, open, onOpenChange }: { request: VacationRequestDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'total' | 'from'>('total');
  const [fromDate, setFromDate] = useState('');
  const fromOk = mode === 'total' || (isValidDate(fromDate) && fromDate >= request.startDate && fromDate <= request.endDate);
  const from = mode === 'from' && fromOk ? fromDate : undefined;

  const preview = useQuery({
    queryKey: ['admin', 'revoke-preview', request.id, from ?? null],
    enabled: open && fromOk,
    retry: false,
    queryFn: () => api.post<RevokePreview>(`/requests/${request.id}/revoke/preview`, from ? { fromDate: from } : {}),
  });

  return (
    <DangerConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      testId="revoke"
      title={`Anular solicitud de ${request.userName}`}
      confirmWord="ANULAR"
      confirmLabel="Anular solicitud"
      warning={
        preview.data ? (
          <span className="font-semibold" data-testid="revoke-message">
            {preview.data.message}
          </span>
        ) : preview.isError ? (
          'No se ha podido calcular el impacto.'
        ) : (
          'Calculando impacto…'
        )
      }
      impact={
        preview.data && (
          <ul className="list-disc pl-5">
            <li>Solicitud: {fmtRange(request.startDate, request.endDate)} ({daysLabel(request.units)})</li>
            <li>Se devolverán {daysLabel(preview.data.refundUnits)} al saldo.</li>
            <li>Días ya disfrutados: {daysLabel(preview.data.enjoyedUnits)}.</li>
          </ul>
        )
      }
      onConfirm={async ({ reason }) => {
        if (!fromOk) throw new Error('Elige una fecha dentro del periodo de la solicitud.');
        await api.post(`/requests/${request.id}/revoke`, { ...(from ? { fromDate: from } : {}), reason, confirmText: 'ANULAR' });
        toast.success('Solicitud anulada.');
        invalidateRequests(qc);
      }}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="revoke-mode">Alcance</Label>
          <Select id="revoke-mode" data-testid="revoke-mode" value={mode} onChange={(e) => setMode(e.target.value as 'total' | 'from')}>
            <option value="total">Anulación total</option>
            <option value="from">Anular desde una fecha</option>
          </Select>
        </div>
        {mode === 'from' && (
          <div className="space-y-1.5">
            <Label htmlFor="revoke-from">Anular desde (incluida)</Label>
            <Input id="revoke-from" type="date" data-testid="revoke-from" min={request.startDate} max={request.endDate} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            {!fromOk && fromDate !== '' && <Alert variant="warning">La fecha debe estar entre el inicio y el fin de la solicitud.</Alert>}
          </div>
        )}
      </div>
    </DangerConfirmDialog>
  );
}
