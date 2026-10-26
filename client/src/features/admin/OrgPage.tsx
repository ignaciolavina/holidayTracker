import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type { OrgNode } from '@ht/shared';
import { api } from '@/lib/api';
import { useOrgTree } from '@/lib/queries';
import { days } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { Loading } from '@/components/PageHeader';
import { UserSelect } from './common';

/** SPEC-04. Árbol plegable con reasignación de manager. */
export function OrgPage() {
  const q = useOrgTree();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<OrgNode | null>(null);
  const [target, setTarget] = useState('');

  const { roots, children, byId } = useMemo(() => {
    const nodes = q.data ?? [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const children = new Map<string, OrgNode[]>();
    const roots: OrgNode[] = [];
    for (const n of nodes) {
      if (n.managerId && byId.has(n.managerId)) children.set(n.managerId, [...(children.get(n.managerId) ?? []), n]);
      else roots.push(n);
    }
    return { roots, children, byId };
  }, [q.data]);

  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (x: string) => (children.get(x) ?? []).forEach((c) => { out.add(c.id); walk(c.id); });
    walk(id);
    return out;
  };
  const candidates = moving ? (q.data ?? []).filter((n) => n.id !== moving.id && n.status === 'active' && n.role === 'admin' && !descendants(moving.id).has(n.id)) : [];
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.name ?? '—') : '—');
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const renderNode = (n: OrgNode): JSX.Element => {
    const kids = children.get(n.id) ?? [];
    const open = !collapsed.has(n.id);
    return (
      <li key={n.id} data-testid={`org-node-${n.id}`}>
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2', n.status !== 'active' && 'opacity-60')}>
          {kids.length > 0 ? (
            <button type="button" aria-label={open ? 'Plegar' : 'Desplegar'} aria-expanded={open} onClick={() => toggle(n.id)} className="rounded p-1 hover:bg-accent" data-testid={`org-toggle-${n.id}`}>
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-6" />
          )}
          <Avatar name={n.name} url={n.avatarUrl} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 font-medium">
              {n.name}
              {n.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
              {n.status !== 'active' && <Badge variant="outline">{n.status === 'disabled' ? 'De baja' : 'Invitado'}</Badge>}
              {n.outToday && <Badge variant="warning" data-testid={`org-out-${n.id}`}>🏖 Fuera hoy</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              Aprueba: {nameOf(n.assignedApproverId)} · Escala a: {n.escalationIds.length ? n.escalationIds.map(nameOf).join(', ') : '—'} · {n.directReports} reportes
            </p>
          </div>
          {n.availableUnits !== undefined && (
            <span className={cn('text-sm font-semibold', n.availableUnits < 0 && 'text-destructive')} title="Saldo disponible">
              {days(n.availableUnits)} días
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => { setMoving(n); setTarget(n.managerId ?? ''); }} data-testid={`org-reassign-${n.id}`}>
            Reasignar manager
          </Button>
        </div>
        {kids.length > 0 && open && <ul className="ml-4 mt-2 space-y-2 border-l pl-3 sm:ml-6">{kids.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="org-page">
      {q.isLoading && <Loading />}
      {q.isError && <Alert variant="destructive">No se ha podido cargar el organigrama.</Alert>}
      {q.data && <ul className="space-y-2" data-testid="org-tree">{roots.map(renderNode)}</ul>}
      {moving && (
        <DangerConfirmDialog
          open
          onOpenChange={(o) => !o && setMoving(null)}
          testId="reassign"
          title={`Reasignar manager de ${moving.name}`}
          confirmWord="REASIGNAR"
          confirmLabel="Reasignar"
          warning={`Las solicitudes pendientes de ${moving.name} pasarán a ser aprobadas por su nuevo manager.`}
          onConfirm={async ({ reason }) => {
            await api.patch(`/users/${moving.id}`, { managerId: target || null, reason });
            toast.success('Manager reasignado.');
            void qc.invalidateQueries({ queryKey: ['org'] });
            void qc.invalidateQueries({ queryKey: ['users'] });
            void qc.invalidateQueries({ queryKey: ['admin'] });
          }}
        >
          <Field label="Nuevo manager (administrador activo)" htmlFor="reassign-manager">
            <UserSelect id="reassign-manager" testId="reassign-manager" value={target} onChange={setTarget} users={candidates} allowNone />
          </Field>
        </DangerConfirmDialog>
      )}
    </div>
  );
}
