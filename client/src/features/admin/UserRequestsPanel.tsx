import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { VacationRequestDto } from '@ht/shared';
import { Button } from '@/components/ui/button';
import { RevokeDialog } from './RevokeDialog';
import { RequestRow } from './common';

/** Vista anual de un usuario (admin): solicitudes con acceso a su detalle y a anularlas (SPEC-11 punto 2). */
export function UserRequestsPanel({ requests }: { requests: VacationRequestDto[] }) {
  const [revoking, setRevoking] = useState<VacationRequestDto | null>(null);
  const list = requests.filter((r) => r.status === 'APPROVED' || r.status === 'PENDING');
  if (list.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Solicitudes del usuario" data-testid="user-requests-panel">
      <h2 className="text-base font-semibold">Solicitudes del año</h2>
      <ul className="space-y-2">
        {list.map((r) => (
          <RequestRow
            key={r.id}
            r={r}
            actions={
              <>
                <Button asChild size="sm" variant="outline"><Link to={`/approvals/${r.id}`}>Detalle</Link></Button>
                {r.can.revoke && <Button size="sm" variant="destructive" onClick={() => setRevoking(r)} data-testid={`revoke-${r.id}`}>Anular</Button>}
              </>
            }
          />
        ))}
      </ul>
      {revoking && <RevokeDialog request={revoking} open onOpenChange={(o) => !o && setRevoking(null)} />}
    </section>
  );
}
