import { describe, expect, it } from 'vitest';
import { canApprove, hasPossibleApprover, assertAdmin, assertNotSelf } from '../src/services/antiCheat/policies';
import { loadTree } from '../src/services/tree';
import { updateSettings } from '../src/services/settings';
import { SYSTEM } from '../src/services/actor';
import { actorOf, loginAs, makeUser, standardOrg, useDb } from './helpers';

useDb('policies');

describe('canApprove (SPEC-04 / SPEC-10)', () => {
  it('any_admin: cualquier admin activo salvo el propio solicitante', async () => {
    const { root, manager, employee, peer } = await standardOrg();
    const tree = await loadTree();
    expect(canApprove(actorOf(root), String(employee._id), tree, 'any_admin')).toBe(true);
    expect(canApprove(actorOf(manager), String(employee._id), tree, 'any_admin')).toBe(true);
    expect(canApprove(actorOf(manager), String(manager._id), tree, 'any_admin')).toBe(false);
    expect(canApprove(actorOf(peer), String(employee._id), tree, 'any_admin')).toBe(false);
    expect(canApprove(SYSTEM, String(employee._id), tree, 'any_admin')).toBe(false);
  });

  it('chain: solo ancestros; las de un admin raíz, otro admin raíz', async () => {
    const { root, manager, employee, cal } = await standardOrg();
    const otherBranch = await makeUser({ email: 'other@test.local', role: 'admin', managerId: root._id, calendarId: cal._id });
    const root2 = await makeUser({ email: 'root2@test.local', role: 'admin', calendarId: cal._id });
    const tree = await loadTree();
    expect(canApprove(actorOf(manager), String(employee._id), tree, 'chain')).toBe(true);
    expect(canApprove(actorOf(root), String(employee._id), tree, 'chain')).toBe(true);
    expect(canApprove(actorOf(otherBranch), String(employee._id), tree, 'chain')).toBe(false);
    expect(canApprove(actorOf(root2), String(root._id), tree, 'chain')).toBe(true);
    expect(canApprove(actorOf(manager), String(root._id), tree, 'chain')).toBe(false);
    expect(hasPossibleApprover(String(root._id), tree, 'chain')).toBe(true);
  });

  it('un admin desactivado no aprueba', async () => {
    const { manager, employee } = await standardOrg();
    const tree = await loadTree();
    tree.get(String(manager._id))!.status = 'disabled';
    expect(canApprove(actorOf(manager), String(employee._id), tree, 'any_admin')).toBe(false);
  });

  it('con política chain, un admin fuera de la cadena ve la solicitud pero no puede aprobarla por API', async () => {
    const { root, employee, cal } = await standardOrg();
    await makeUser({ email: 'other@test.local', role: 'admin', managerId: root._id, calendarId: cal._id });
    await updateSettings(SYSTEM, { approvalPolicy: 'chain' });
    const emp = await loginAs(employee.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    const other = await loginAs('other@test.local');
    const ov = await other.get('/api/admin/overview');
    expect(ov.body.otherPending.map((x: { id: string }) => x.id)).toContain(r.body.id);
    expect((await other.post(`/api/requests/${r.body.id}/approve`)).status).toBe(403);
    expect((await other.post(`/api/requests/${r.body.id}/reject`, { reason: 'fuera de mi cadena' })).status).toBe(403);
  });

  it('assertAdmin y assertNotSelf', () => {
    expect(() => assertAdmin({ id: 'a', role: 'user' })).toThrow();
    expect(() => assertNotSelf({ id: 'a', role: 'admin' }, 'a', 'x')).toThrow();
    expect(() => assertNotSelf({ id: 'a', role: 'admin' }, 'b', 'x')).not.toThrow();
  });
});

describe('listados de saldo (SPEC-18)', () => {
  it('tabla de saldos, CSV y ledger', async () => {
    const { employee } = await standardOrg();
    const root = await loginAs('root@test.local');
    await root.post(`/api/balances/${employee._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: -1, reason: '=HYPERLINK("x")' });
    const rows = await root.get('/api/balances?year=2026');
    expect(rows.body).toHaveLength(4);
    const emp = rows.body.find((r: { userId: string }) => r.userId === String(employee._id));
    expect(emp.available.total).toBe(46);
    expect(emp.userName).toBe('Elena Empleada');
    const csv = await root.get('/api/balances/export.csv?year=2026');
    expect(csv.text).toContain('Elena Empleada;active;2026;23');
    const ledger = await root.get(`/api/ledger/${employee._id}?year=2026`);
    expect(ledger.body.map((e: { type: string }) => e.type)).toEqual(['ANNUAL_ALLOWANCE', 'BIRTHDAY_ALLOWANCE', 'ADJUSTMENT']);
    const own = await (await loginAs(employee.email)).get('/api/ledger/me');
    expect(own.body).toHaveLength(3);
    // el motivo con fórmula sale neutralizado en el CSV de auditoría
    const audit = await root.get('/api/audit/export.csv');
    expect(audit.text).toContain(`'=HYPERLINK`);
  });
});
