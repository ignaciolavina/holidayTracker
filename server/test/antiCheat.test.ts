import { describe, expect, it } from 'vitest';
import { clock } from '../src/lib/clock';
import { AuditLog, LedgerEntry, Notification, VacationRequest } from '../src/models';
import { getBalance } from '../src/services/balance/state';
import { addHoliday, loginAs, standardOrg, useDb } from './helpers';

useDb('anticheat');

/** Crea y aprueba una solicitud del empleado. */
async function approvedRequest(startDate: string, endDate: string) {
  const emp = await loginAs('emp@test.local');
  const mgr = await loginAs('manager@test.local');
  const r = await emp.post('/api/requests', { kind: 'VACATION', startDate, endDate });
  expect(r.status).toBe(201);
  const a = await mgr.post(`/api/requests/${r.body.id}/approve`);
  expect(a.status).toBe(200);
  return r.body.id as string;
}

describe('SPEC-11 · pasado e iniciado', () => {
  it('regla 1: el usuario no puede cancelar algo que ya ha empezado (ni lo que queda de un rango en curso)', async () => {
    await standardOrg();
    const id = await approvedRequest('2026-03-09', '2026-03-20');
    clock.set('2026-03-12T10:00:00+01:00');
    const emp = await loginAs('emp@test.local');
    const res = await emp.post(`/api/requests/${id}/cancel`, {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REQUEST_STARTED');
  });

  it('regla 1: el usuario no puede modificar algo que ya ha empezado', async () => {
    await standardOrg();
    const id = await approvedRequest('2026-03-09', '2026-03-20');
    clock.set('2026-03-12T10:00:00+01:00');
    const emp = await loginAs('emp@test.local');
    const res = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-03-23', endDate: '2026-03-24', replacesRequestId: id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REQUEST_STARTED');
  });

  it('regla 1: antes de empezar sí puede cancelar, y se devuelve el saldo', async () => {
    const { employee } = await standardOrg();
    const id = await approvedRequest('2026-04-06', '2026-04-10');
    const emp = await loginAs('emp@test.local');
    expect((await emp.post(`/api/requests/${id}/cancel`, {})).status).toBe(200);
    expect((await getBalance(String(employee._id), 2026)).ledger.current).toBe(48);
  });

  it('regla 2: solo un admin anula; un usuario recibe 403 aunque llame a la API', async () => {
    await standardOrg();
    const id = await approvedRequest('2026-03-09', '2026-03-13');
    const emp = await loginAs('emp@test.local');
    const res = await emp.post(`/api/requests/${id}/revoke`, { reason: 'quiero', confirmText: 'ANULAR' });
    expect(res.status).toBe(403);
  });

  it('regla 2: anular exige motivo y escribir ANULAR', async () => {
    await standardOrg();
    const id = await approvedRequest('2026-03-09', '2026-03-13');
    const root = await loginAs('root@test.local');
    expect((await root.post(`/api/requests/${id}/revoke`, { confirmText: 'ANULAR' })).status).toBe(400);
    expect((await root.post(`/api/requests/${id}/revoke`, { reason: 'Error de registro', confirmText: 'anular' })).status).toBe(400);
  });

  it('regla 2: anulación parcial de una solicitud iniciada, con aviso, auditoría y notificación', async () => {
    const { employee, manager } = await standardOrg();
    const id = await approvedRequest('2026-03-09', '2026-03-13'); // 10 u
    clock.set('2026-03-11T10:00:00+01:00');
    const root = await loginAs('root@test.local');
    const pv = await root.post(`/api/requests/${id}/revoke/preview`, { fromDate: '2026-03-11' });
    expect(pv.body).toMatchObject({ refundUnits: 6, enjoyedUnits: 2, touchesEnjoyed: true });
    expect(pv.body.message).toContain('Esta solicitud ya se ha disfrutado total o parcialmente. Anularla devolverá 3 días al saldo de');
    const res = await root.post(`/api/requests/${id}/revoke`, { fromDate: '2026-03-11', reason: 'Volvió antes por un imprevisto', confirmText: 'ANULAR' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');
    expect((await getBalance(String(employee._id), 2026)).ledger.current).toBe(48 - 10 + 6);
    expect(await AuditLog.countDocuments({ action: 'REQUEST_REVOKED', targetId: id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'REQUEST_REVOKED', userId: { $in: [employee._id, manager._id] } })).toBe(2);
  });

  it('regla 3: el usuario no puede pedir días en el pasado; el admin sí puede registrar retroactivamente', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs('emp@test.local');
    expect((await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-02-23', endDate: '2026-02-24' })).body.error.code).toBe('PAST_DATE');
    // ni siquiera usando el endpoint de admin
    expect(
      (await emp.post('/api/requests/retroactive', { userId: String(employee._id), kind: 'VACATION', startDate: '2026-02-23', endDate: '2026-02-24', reason: 'x'.repeat(5), confirmText: 'REGISTRAR' })).status,
    ).toBe(403);
    const root = await loginAs('root@test.local');
    const noReason = await root.post('/api/requests/retroactive', { userId: String(employee._id), kind: 'VACATION', startDate: '2026-02-23', endDate: '2026-02-24', confirmText: 'REGISTRAR' });
    expect(noReason.status).toBe(400);
    const ok = await root.post('/api/requests/retroactive', { userId: String(employee._id), kind: 'VACATION', startDate: '2026-02-23', endDate: '2026-02-24', reason: 'Se olvidó de pedirlo', confirmText: 'REGISTRAR' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.retroactive).toBe(true);
    expect((await getBalance(String(employee._id), 2026)).ledger.current).toBe(44);
    expect(await AuditLog.countDocuments({ action: 'REQUEST_RETROACTIVE' })).toBe(1);
  });
});

describe('SPEC-11 · conflictos de interés (regla 4)', () => {
  it('un admin no aprueba su propia solicitud', async () => {
    await standardOrg();
    const mgr = await loginAs('manager@test.local');
    const r = await mgr.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    const res = await mgr.post(`/api/requests/${r.body.id}/approve`);
    expect(res.status).toBe(403);
  });

  it('un admin no rechaza su propia solicitud', async () => {
    await standardOrg();
    const mgr = await loginAs('manager@test.local');
    const r = await mgr.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect((await mgr.post(`/api/requests/${r.body.id}/reject`, { reason: 'por probar' })).status).toBe(403);
  });

  it('un admin no anula su propia solicitud', async () => {
    const { manager } = await standardOrg();
    const mgr = await loginAs('manager@test.local');
    const root = await loginAs('root@test.local');
    const r = await mgr.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    await root.post(`/api/requests/${r.body.id}/approve`);
    const res = await mgr.post(`/api/requests/${r.body.id}/revoke`, { reason: 'Me lo devuelvo', confirmText: 'ANULAR' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_ACTION_FORBIDDEN');
    void manager;
  });

  it('un admin no ajusta su propio saldo', async () => {
    const { manager } = await standardOrg();
    const mgr = await loginAs('manager@test.local');
    const res = await mgr.post(`/api/balances/${manager._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: 5, reason: 'Me lo merezco' });
    expect(res.status).toBe(403);
    expect(await LedgerEntry.countDocuments({ type: 'ADJUSTMENT' })).toBe(0);
  });

  it('un admin no cambia su propio manager, días anuales ni fecha de alta', async () => {
    const { manager } = await standardOrg();
    const mgr = await loginAs('manager@test.local');
    for (const body of [
      { managerId: null, reason: 'Independencia' },
      { annualDays: 30, reason: 'Más días' },
      { hireDate: '2010-01-01', reason: 'Antigüedad' },
      { role: 'user', reason: 'x'.repeat(5) },
    ]) {
      const res = await mgr.patch(`/api/users/${manager._id}`, body);
      expect(res.status).toBe(403);
    }
  });

  it('otro admin sí puede ajustar, con motivo obligatorio y auditoría', async () => {
    const { employee } = await standardOrg();
    const root = await loginAs('root@test.local');
    expect((await root.post(`/api/balances/${employee._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: 1.5 })).status).toBe(400);
    expect((await root.post(`/api/balances/${employee._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: 0.3, reason: 'Compensación' })).status).toBe(400);
    const ok = await root.post(`/api/balances/${employee._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: 1.5, reason: 'Compensación' });
    expect(ok.status).toBe(200);
    expect(ok.body.after.ledger.current).toBe(51);
    expect(await AuditLog.countDocuments({ action: 'BALANCE_ADJUSTED' })).toBe(1);
  });
});

describe('SPEC-11 · cumpleaños (regla 5)', () => {
  it('el usuario fija su cumpleaños una vez; después solo lo cambia un admin con motivo', async () => {
    const { peer } = await standardOrg(); // peer no tiene cumpleaños
    const p = await loginAs(peer.email);
    expect((await p.post('/api/me/birthday', { birthday: '09-15' })).status).toBe(200);
    const again = await p.post('/api/me/birthday', { birthday: '03-02' });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('BIRTHDAY_LOCKED');
    const root = await loginAs('root@test.local');
    expect((await root.patch(`/api/users/${peer._id}`, { birthday: '03-02' })).status).toBe(422); // sin motivo
    expect((await root.patch(`/api/users/${peer._id}`, { birthday: '03-02', reason: 'Error al escribirlo' })).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'USER_BIRTHDAY_CHANGED' })).toBe(1);
  });

  it('cambiar la fecha no da un segundo día de cumpleaños en el mismo año', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs('emp@test.local');
    const mgr = await loginAs('manager@test.local');
    const r = await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-10', endDate: '2026-06-10' });
    await mgr.post(`/api/requests/${r.body.id}/approve`);
    const root = await loginAs('root@test.local');
    await root.patch(`/api/users/${employee._id}`, { birthday: '09-16', reason: 'Corrección' });
    const second = await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-09-16', endDate: '2026-09-16' });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('BIRTHDAY_ALREADY_USED');
    expect((await getBalance(String(employee._id), 2026)).ledger.birthday).toBe(0);
  });
});

describe('SPEC-11 · integridad (reglas 6-9)', () => {
  it('regla 6: el ledger no se puede editar ni borrar', async () => {
    const { employee } = await standardOrg();
    await expect(LedgerEntry.updateOne({ userId: employee._id }, { $set: { units: 999 } })).rejects.toThrow(/solo admite inserciones/);
    await expect(LedgerEntry.deleteMany({})).rejects.toThrow(/solo admite inserciones/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/solo admite inserciones/);
  });

  it('regla 8: varias pendientes no superan el límite (cuenta lo reservado)', async () => {
    await standardOrg();
    const emp = await loginAs('emp@test.local');
    // 48 u disponibles; límite −10 → máximo 58 u entre pendientes
    expect((await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-05-01' })).status).toBe(201); // 20 laborables = 40 u
    expect((await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-05-04', endDate: '2026-05-13' })).status).toBe(201); // 8 = 16 u → −8
    const third = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-05-18', endDate: '2026-05-18' }); // −10 ok
    expect(third.status).toBe(201);
    const fourth = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-05-19', endDate: '2026-05-19', halfDay: { date: '2026-05-19', period: 'AM' } });
    expect(fourth.status).toBe(422);
  });
});

describe('SPEC-11 · cambios de festivos (regla 10)', () => {
  it('crear un festivo dentro de una solicitud aprobada exige confirmar y devuelve el día (HOLIDAY_RECALC)', async () => {
    const { employee, cal } = await standardOrg();
    const id = await approvedRequest('2026-05-11', '2026-05-15'); // 10 u
    const root = await loginAs('root@test.local');
    const impact = await root.post('/api/holidays/impact', { op: 'create', date: '2026-05-15', scope: 'local', calendarIds: [String(cal._id)] });
    expect(impact.body.affected).toHaveLength(1);
    expect(impact.body.affected[0]).toMatchObject({ requestId: id, deltaUnits: 2, touchesEnjoyed: false, userName: 'Elena Empleada' });
    const noConfirm = await root.post('/api/holidays', { date: '2026-05-15', name: 'San Isidro', scope: 'local', calendarIds: [String(cal._id)] });
    expect(noConfirm.status).toBe(409);
    const ok = await root.post('/api/holidays', { date: '2026-05-15', name: 'San Isidro', scope: 'local', calendarIds: [String(cal._id)], confirm: true });
    expect(ok.status).toBe(201);
    expect((await getBalance(String(employee._id), 2026)).ledger.current).toBe(48 - 8);
    expect((await VacationRequest.findById(id))!.units).toBe(8);
    expect(await LedgerEntry.countDocuments({ type: 'HOLIDAY_RECALC', units: 2 })).toBe(1);
    expect(await Notification.countDocuments({ type: 'HOLIDAY_CHANGED', userId: employee._id })).toBe(1);
  });

  it('borrar un festivo dentro de una solicitud aprobada carga el día; si ya se disfrutó exige CONFIRMAR y motivo', async () => {
    const { employee, cal } = await standardOrg();
    const h = await addHoliday(cal._id, '2026-03-19', 'regional', 'San José');
    const id = await approvedRequest('2026-03-16', '2026-03-20'); // 4 laborables
    clock.set('2026-03-25T10:00:00+01:00');
    const root = await loginAs('root@test.local');
    const res1 = await root.delete(`/api/holidays/${h._id}`, { confirm: true });
    expect(res1.status).toBe(422);
    expect(res1.body.error.code).toBe('HOLIDAY_IMPACT_ENJOYED');
    const ok = await root.delete(`/api/holidays/${h._id}`, { confirm: true, confirmText: 'CONFIRMAR', reason: 'No era festivo este año' });
    expect(ok.status).toBe(200);
    expect((await VacationRequest.findById(id))!.units).toBe(10);
    expect((await getBalance(String(employee._id), 2026)).ledger.current).toBe(48 - 10);
  });
});
