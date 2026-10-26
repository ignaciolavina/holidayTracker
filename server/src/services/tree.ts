import type { ClientSession } from 'mongoose';
import { User } from '../models';
import { unprocessable } from '../lib/errors';

/** Árbol de empleados (SPEC-04). */

interface TreeUser {
  _id: { toString(): string };
  managerId?: { toString(): string } | null;
  role: string;
  status: string;
}

export async function loadTree(session?: ClientSession): Promise<Map<string, TreeUser>> {
  const users = await User.find({}).select('managerId role status name').session(session ?? null).lean();
  return new Map(users.map((u) => [String(u._id), u as TreeUser]));
}

/** Cadena de managers hacia arriba (sin incluir al propio usuario). Corta si detecta un ciclo. */
export function ancestorsOf(userId: string, tree: Map<string, TreeUser>): string[] {
  const out: string[] = [];
  const seen = new Set([userId]);
  let cur = tree.get(userId)?.managerId ? String(tree.get(userId)!.managerId) : null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    const next = tree.get(cur)?.managerId;
    cur = next ? String(next) : null;
  }
  return out;
}

/** Todos los descendientes (rama) de un usuario. */
export function descendantsOf(userId: string, tree: Map<string, TreeUser>): string[] {
  const children = new Map<string, string[]>();
  for (const [id, u] of tree) {
    if (!u.managerId) continue;
    const m = String(u.managerId);
    children.set(m, [...(children.get(m) ?? []), id]);
  }
  const out: string[] = [];
  const stack = [...(children.get(userId) ?? [])];
  const seen = new Set<string>([userId]);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export function directReportsOf(userId: string, tree: Map<string, TreeUser>, onlyActive = true): string[] {
  return [...tree.entries()]
    .filter(([, u]) => u.managerId && String(u.managerId) === userId && (!onlyActive || u.status !== 'disabled'))
    .map(([id]) => id);
}

export function activeAdmins(tree: Map<string, TreeUser>): string[] {
  return [...tree.entries()].filter(([, u]) => u.role === 'admin' && u.status === 'active').map(([id]) => id);
}

export function rootAdmins(tree: Map<string, TreeUser>): string[] {
  return [...tree.entries()]
    .filter(([, u]) => u.role === 'admin' && u.status === 'active' && !u.managerId)
    .map(([id]) => id);
}

/**
 * Valida un cambio de manager: el manager existe, es admin y está activo; nadie es su propio manager;
 * no se crean ciclos.
 */
export function validateManagerChange(userId: string, managerId: string | null, tree: Map<string, TreeUser>): void {
  if (!managerId) return;
  if (managerId === userId) throw unprocessable('MANAGER_SELF', 'Nadie puede ser su propio manager.');
  const m = tree.get(managerId);
  if (!m) throw unprocessable('MANAGER_NOT_FOUND', 'El manager indicado no existe.');
  if (m.role !== 'admin') throw unprocessable('MANAGER_NOT_ADMIN', 'El manager tiene que tener el rol de admin.');
  if (m.status === 'disabled') throw unprocessable('MANAGER_DISABLED', 'El manager indicado está desactivado.');
  // ciclo: el nuevo manager no puede estar por debajo del usuario
  if (descendantsOf(userId, tree).includes(managerId)) {
    throw unprocessable('MANAGER_CYCLE', 'Ese cambio crearía un ciclo en el árbol de empleados.');
  }
}

/** Tras un cambio, tiene que seguir existiendo al menos un admin raíz activo. */
export function assertRootAdminExists(tree: Map<string, TreeUser>): void {
  if (!rootAdmins(tree).length) {
    throw unprocessable('NO_ROOT_ADMIN', 'Tiene que existir al menos un admin raíz (sin manager) activo.');
  }
}

/** A quién se avisa si la solicitud de `userId` se queda pendiente: manager del manager + resto de admins. */
export function escalationTargets(userId: string, tree: Map<string, TreeUser>): string[] {
  const chain = ancestorsOf(userId, tree);
  const managerId = chain[0] ?? null;
  const out = new Set<string>();
  if (chain[1]) out.add(chain[1]);
  for (const a of activeAdmins(tree)) if (a !== userId && a !== managerId) out.add(a);
  return [...out];
}
