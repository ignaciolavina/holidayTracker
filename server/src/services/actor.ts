import type { Role } from '@ht/shared';

/** Quién hace la acción. `id: null` = sistema (jobs). */
export interface Actor {
  id: string | null;
  role: Role | 'system';
  name?: string;
  ip?: string | null;
}

export const SYSTEM: Actor = { id: null, role: 'system', name: 'Sistema' };

export function isAdmin(actor: Actor): boolean {
  return actor.role === 'admin';
}
