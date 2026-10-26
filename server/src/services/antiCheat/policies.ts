import type { ApprovalPolicy } from '@ht/shared';
import type { Actor } from '../actor';
import { ancestorsOf, rootAdmins } from '../tree';
import { forbidden } from '../../lib/errors';

/**
 * Reglas de autorización y conflicto de interés (SPEC-04, SPEC-10, SPEC-11).
 */

type Tree = Parameters<typeof ancestorsOf>[1];

/**
 * ¿Puede `actor` aprobar/rechazar la solicitud de `requesterId`?
 * - Nunca sus propias solicitudes.
 * - Política `any_admin` (por defecto, sección 0): cualquier admin.
 * - Política `chain` (SPEC-10 / decisión 6): solo ancestros; las de un admin raíz, cualquier otro admin raíz.
 */
export function canApprove(
  actor: Actor,
  requesterId: string,
  tree: Tree,
  policy: ApprovalPolicy = 'any_admin',
): boolean {
  if (actor.role !== 'admin' || !actor.id) return false;
  if (actor.id === requesterId) return false;
  const actorNode = tree.get(actor.id);
  if (actorNode && actorNode.status !== 'active') return false;
  if (policy === 'any_admin') return true;
  const chain = ancestorsOf(requesterId, tree);
  if (chain.includes(actor.id)) return true;
  const requester = tree.get(requesterId);
  if (requester && !requester.managerId) return rootAdmins(tree).includes(actor.id);
  return false;
}

/** ¿Hay alguien distinto del solicitante que pueda aprobar? Si no, la solicitud se autoaprueba. */
export function hasPossibleApprover(requesterId: string, tree: Tree, policy: ApprovalPolicy): boolean {
  for (const [id, u] of tree) {
    if (id === requesterId || u.role !== 'admin' || u.status !== 'active') continue;
    if (canApprove({ id, role: 'admin' }, requesterId, tree, policy)) return true;
  }
  return false;
}

/** Regla 4: un admin no actúa sobre sí mismo (aprobar, anular, ajustar, manager, días, alta). */
export function assertNotSelf(actor: Actor, targetUserId: string, what: string): void {
  if (actor.id && actor.id === String(targetUserId)) {
    throw forbidden('SELF_ACTION_FORBIDDEN', `No puedes ${what} sobre ti mismo: lo tiene que hacer otro admin.`);
  }
}

export function assertAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw forbidden('ADMIN_ONLY', 'Solo un admin puede hacer esta acción.');
}
