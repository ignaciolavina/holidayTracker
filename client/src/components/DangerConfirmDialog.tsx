import { useState, type ReactNode } from 'react';
import { OctagonAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Textarea, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/api';

export interface DangerConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Aviso destacado (rojo) sobre qué va a pasar */
  warning?: ReactNode;
  /** Texto de impacto: usuarios/solicitudes/saldos afectados */
  impact?: ReactNode;
  /** Palabra exacta que hay que escribir, p. ej. "ANULAR" */
  confirmWord: string;
  confirmLabel?: string;
  /** Motivo obligatorio (por defecto sí, mínimo 3 caracteres como zReason) */
  requireReason?: boolean;
  reasonLabel?: string;
  /** Contenido extra entre el impacto y el motivo (p. ej. selector de fecha) */
  children?: ReactNode;
  /** Debe lanzar si falla; el diálogo muestra el mensaje y no se cierra */
  onConfirm: (data: { reason: string }) => Promise<unknown> | unknown;
  /** Prefijo para los data-testid */
  testId?: string;
}

/** SPEC-11 punto 2: aviso destacado + impacto + motivo obligatorio + palabra exacta para habilitar la acción. */
export function DangerConfirmDialog(props: DangerConfirmDialogProps) {
  const { open, onOpenChange, title, warning, impact, confirmWord, confirmLabel = 'Confirmar', requireReason = true, reasonLabel = 'Motivo', children, onConfirm, testId = 'danger' } = props;
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = !requireReason || reason.trim().length >= 3;
  const wordOk = typed === confirmWord;

  const reset = () => {
    setReason('');
    setTyped('');
    setError(null);
    setBusy(false);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim() });
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid={`${testId}-dialog`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <OctagonAlert className="h-5 w-5" aria-hidden /> {title}
          </DialogTitle>
          <DialogDescription>Esta acción es sensible y quedará registrada en la auditoría.</DialogDescription>
        </DialogHeader>
        {warning && (
          <Alert variant="destructive" title="Atención" data-testid={`${testId}-warning`}>
            {warning}
          </Alert>
        )}
        {impact && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid={`${testId}-impact`}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impacto</p>
            {impact}
          </div>
        )}
        {children}
        {requireReason && (
          <div className="space-y-1.5">
            <Label htmlFor={`${testId}-reason`}>{reasonLabel} (obligatorio)</Label>
            <Textarea id={`${testId}-reason`} data-testid={`${testId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${testId}-confirm`}>
            Para confirmar, escribe <strong className="font-mono">{confirmWord}</strong>
          </Label>
          <Input id={`${testId}-confirm`} data-testid={`${testId}-confirm-text`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert" data-testid={`${testId}-error`}>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid={`${testId}-cancel`}>
            Volver
          </Button>
          <Button variant="destructive" disabled={!reasonOk || !wordOk || busy} onClick={submit} data-testid={`${testId}-submit`}>
            {busy ? 'Procesando…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
