import { describe, expect, it } from 'vitest';
import { clock } from '../src/lib/clock';
import { LedgerEntry, VacationRequest, AuditLog, Notification } from '../src/models';
import { addHoliday, loginAs, standardOrg, useDb, makeUser, makeCalendar } from './helpers';

useDb('requests');

async function balance(agent: Awaited<ReturnType<typeof loginAs>>, year = 2026) {
  return (await agent.get(`/api/balances/me?year=${year}`)).body;
}

describe('solicitudes y estados (SPEC-09)', () => {
  it('crear → PENDING, reserva saldo y avisa al manager; aprobar consume del ledger', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const res = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-10' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.units).toBe(10);
    let b = await balance(emp);
    expect(b.ledger.current).toBe(48);
    expect(b.reserved.current).toBe(10);
    expect(b.available.total).toBe(38);
    expect(await Notification.countDocuments({ type: 'REQUEST_CREATED' })).toBe(1);

    const mgr = await loginAs('manager@test.local');
    const ok = await mgr.post(`/api/requests/${res.body.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    b = await balance(emp);
    expect(b.ledger.current).toBe(38);
    expect(b.reserved.current).toBe(0);
    expect(await LedgerEntry.countDocuments({ type: 'CONSUMPTION' })).toBe(1);
  });

  it('el servidor ignora cualquier número de días que mande el cliente (anti-trampas 7)', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const res = await emp.post('/api/requests', {
      kind: 'VACATION',
      startDate: '2026-04-06',
      endDate: '2026-04-10',
      units: 1,
      totalUnits: 1,
      days: 0.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.units).toBe(10);
  });

  it('no se puede pedir en el pasado ni más allá del 31-12 del año siguiente', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const past = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-02-27', endDate: '2026-03-03' });
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('PAST_DATE');
    const far = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2028-01-03', endDate: '2028-01-04' });
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('TOO_FAR');
    const nextYear = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2027-12-27', endDate: '2027-12-31' });
    expect(nextYear.status).toBe(201);
  });

  it('no se solapa con otra solicitud propia pendiente o aprobada; medio día AM + PM sí', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-08' });
    const dup = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-08', endDate: '2026-04-09' });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('OVERLAP');
    const am = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-13', endDate: '2026-04-13', halfDay: { date: '2026-04-13', period: 'AM' } });
    expect(am.status).toBe(201);
    const pm = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-13', endDate: '2026-04-13', halfDay: { date: '2026-04-13', period: 'PM' } });
    expect(pm.status).toBe(201);
  });

  it('previsualización: resumen, bolsa, saldo antes/después y aviso de solape de equipo', async () => {
    const { employee, peer, cal } = await standardOrg();
    await addHoliday(cal._id, '2026-04-09', 'regional', 'Jueves Santo');
    const p = await loginAs(peer.email);
    await p.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    const emp = await loginAs(employee.email);
    const res = await emp.post('/api/requests/preview', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-12' });
    expect(res.status).toBe(200);
    expect(res.body.computation.summary).toBe('7 días naturales → 4 laborables (1 festivo, 2 fines de semana)');
    expect(res.body.allocation).toEqual([{ year: 2026, bucket: 'CURRENT', units: 8 }]);
    expect(res.body.balanceByYear).toEqual([{ year: 2026, availableBeforeUnits: 48, availableAfterUnits: 40 }]);
    expect(res.body.warnings.map((w: { code: string }) => w.code)).toContain('TEAM_OVERLAP');
    expect(res.body.errors).toEqual([]);
  });

  it('modificar = nueva solicitud; la original sigue aprobada hasta aprobar la nueva', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const mgr = await loginAs('manager@test.local');
    const orig = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-10' });
    await mgr.post(`/api/requests/${orig.body.id}/approve`);
    // la nueva se solapa con la original: se permite porque la sustituye
    const mod = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-08', endDate: '2026-04-14', replacesRequestId: orig.body.id });
    expect(mod.status).toBe(201);
    expect((await VacationRequest.findById(orig.body.id))!.status).toBe('APPROVED');
    let b = await balance(emp);
    expect(b.ledger.current).toBe(38);
    expect(b.available.total).toBe(48 - 10); // la nueva reserva solo la diferencia: 10 − 10

    // si se rechaza, la original se mantiene
    const rej = await mgr.post(`/api/requests/${mod.body.id}/reject`, { reason: 'Coincide con la entrega' });
    expect(rej.status).toBe(200);
    expect((await VacationRequest.findById(orig.body.id))!.status).toBe('APPROVED');

    // al aprobar otra modificación, la original se cancela con REFUND de forma atómica
    const mod2 = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-20', endDate: '2026-04-21', replacesRequestId: orig.body.id });
    const ok = await mgr.post(`/api/requests/${mod2.body.id}/approve`);
    expect(ok.status).toBe(200);
    expect((await VacationRequest.findById(orig.body.id))!.status).toBe('CANCELLED');
    b = await balance(emp);
    expect(b.ledger.current).toBe(48 - 4);
    expect(await LedgerEntry.countDocuments({ type: 'REFUND', requestId: orig.body.id })).toBe(1);
  });

  it('rechazar exige motivo y el usuario lo ve', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const mgr = await loginAs('manager@test.local');
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect((await mgr.post(`/api/requests/${r.body.id}/reject`, {})).status).toBe(400);
    await mgr.post(`/api/requests/${r.body.id}/reject`, { reason: 'Cierre trimestral' });
    const mine = await emp.get(`/api/requests/${r.body.id}`);
    expect(mine.body.status).toBe('REJECTED');
    expect(mine.body.rejectionReason).toBe('Cierre trimestral');
  });

  it('no hay dobles aprobaciones (transición condicional)', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const mgr = await loginAs('manager@test.local');
    const root = await loginAs('root@test.local');
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-10' });
    const [a, b] = await Promise.all([
      mgr.post(`/api/requests/${r.body.id}/approve`),
      root.post(`/api/requests/${r.body.id}/approve`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await LedgerEntry.countDocuments({ type: 'CONSUMPTION', requestId: r.body.id })).toBe(1);
  });

  it('pendiente cuando llega su fecha → urgente; se puede aprobar con aviso', async () => {
    const { employee } = await standardOrg();
    let emp = await loginAs(employee.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-03-05', endDate: '2026-03-06' });
    clock.set('2026-03-05T09:00:00+01:00');
    // la sesión de acceso dura 15 min: se vuelve a entrar tras mover el reloj
    emp = await loginAs(employee.email);
    const mgr = await loginAs('manager@test.local');
    const get = await emp.get(`/api/requests/${r.body.id}`);
    expect(get.body.urgent).toBe(true);
    const noAck = await mgr.post(`/api/requests/${r.body.id}/approve`);
    expect(noAck.status).toBe(422);
    expect(noAck.body.error.code).toBe('STARTED_ACK_REQUIRED');
    const ack = await mgr.post(`/api/requests/${r.body.id}/approve`, { acknowledgeStarted: true });
    expect(ack.status).toBe(200);
  });
});

describe('aprobaciones (SPEC-10)', () => {
  it('nadie aprueba sus propias solicitudes', async () => {
    const { manager } = await standardOrg();
    const mgr = await loginAs(manager.email);
    const r = await mgr.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    const self = await mgr.post(`/api/requests/${r.body.id}/approve`);
    expect(self.status).toBe(403);
    const root = await loginAs('root@test.local');
    expect((await root.post(`/api/requests/${r.body.id}/approve`)).status).toBe(200);
  });

  it('un usuario no admin no puede aprobar', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const peer = await loginAs('peer@test.local');
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect((await peer.post(`/api/requests/${r.body.id}/approve`)).status).toBe(403);
  });

  it('único admin raíz → su solicitud se autoaprueba y queda en auditoría', async () => {
    const cal = await makeCalendar();
    const solo = await makeUser({ email: 'solo@test.local', role: 'admin', calendarId: cal._id });
    await makeUser({ email: 'u@test.local', managerId: solo._id, calendarId: cal._id });
    const s = await loginAs(solo.email);
    const r = await s.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('APPROVED');
    expect(await AuditLog.countDocuments({ action: 'REQUEST_AUTO_APPROVED_NO_APPROVER' })).toBe(1);
  });

  it('al aprobar se revalida el saldo (puede haber cambiado desde el envío)', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const mgr = await loginAs('manager@test.local');
    const root = await loginAs('root@test.local');
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-17' }); // 20 u
    // un ajuste posterior deja el saldo en 48 − 40 = 8 → 8 − 20 = −12 < −10
    await root.post(`/api/balances/${employee._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: -20, reason: 'Corrección de alta' });
    const ok = await mgr.post(`/api/requests/${r.body.id}/approve`);
    expect(ok.status).toBe(422);
    expect(ok.body.error.code).toBe('NEGATIVE_LIMIT');
  });

  it('el aprobador asignado es el manager directo y el escalado avisa al manager del manager', async () => {
    const { employee, manager, root } = await standardOrg();
    const emp = await loginAs(employee.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect(r.body.approverId).toBe(String(manager._id));
    clock.set('2026-03-04T11:00:00+01:00'); // > 48 h
    const { runJob } = await import('../src/services/jobs/runner');
    await runJob('escalation', { trigger: 'manual' });
    expect(await Notification.countDocuments({ userId: root._id, type: 'REQUEST_ESCALATED' })).toBe(1);
    expect((await VacationRequest.findById(r.body.id))!.escalatedAt).not.toBeNull();
  });

  it('si el manager está de vacaciones el día de la solicitud, se escala en el momento', async () => {
    const { employee, manager, root } = await standardOrg();
    const m = await loginAs(manager.email);
    const rt = await loginAs(root.email);
    const mr = await m.post('/api/requests', { kind: 'VACATION', startDate: '2026-03-03', endDate: '2026-03-06' });
    await rt.post(`/api/requests/${mr.body.id}/approve`);
    clock.set('2026-03-04T10:00:00+01:00');
    const emp = await loginAs(employee.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect((await VacationRequest.findById(r.body.id))!.escalatedAt).not.toBeNull();
    expect(await Notification.countDocuments({ userId: root._id, type: 'REQUEST_ESCALATED' })).toBe(1);
  });

  it('enlace del email: firmado, para el aprobador, y no aprueba por sí solo', async () => {
    const { employee, manager } = await standardOrg();
    const emp = await loginAs(employee.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    const { approvalLinkToken } = await import('../src/services/approvalLinks');
    const token = approvalLinkToken(r.body.id, String(manager._id));
    const mgr = await loginAs(manager.email);
    const ok = await mgr.get(`/api/approvals/link/${token}`);
    expect(ok.body).toEqual({ requestId: r.body.id });
    expect((await VacationRequest.findById(r.body.id))!.status).toBe('PENDING');
    const root = await loginAs('root@test.local');
    expect((await root.get(`/api/approvals/link/${token}`)).status).toBe(403);
    expect((await mgr.get(`/api/approvals/link/${token.slice(0, -2)}xx`)).status).toBe(403);
  });
});
