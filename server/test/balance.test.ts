import { describe, expect, it } from 'vitest';
import { clock } from '../src/lib/clock';
import { JobRun, LedgerEntry, UserYear, VacationRequest } from '../src/models';
import { getBalance } from '../src/services/balance/state';
import { catchUp, runJob } from '../src/services/jobs/runner';
import { updateSettings } from '../src/services/settings';
import { SYSTEM } from '../src/services/actor';
import { addHoliday, loginAs, makeCalendar, makeUser, standardOrg, useDb } from './helpers';

useDb('balance');

async function approve(reqId: string) {
  const mgr = await loginAs('manager@test.local');
  const r = await mgr.post(`/api/requests/${reqId}/approve`, { acknowledgeStarted: true });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}

describe('prorrata al alta (SPEC-07)', () => {
  it.each([
    ['2026-01-01', 48],
    ['2026-06-15', 26],
    ['2026-12-31', 0],
  ])('alta el %s → %i unidades', async (hireDate, units) => {
    const cal = await makeCalendar();
    const u = await makeUser({ calendarId: cal._id, hireDate });
    const b = await getBalance(String(u._id), 2026);
    expect(b.ledger.current).toBe(units);
    expect(b.entitlementUnits).toBe(units);
  });

  it('cambio de días anuales a mitad de año → PRORATION_ADJUSTMENT', async () => {
    const { employee } = await standardOrg();
    clock.set('2026-07-01T10:00:00+02:00');
    const root = await loginAs('root@test.local');
    const res = await root.patch(`/api/users/${employee._id}`, { annualDays: 26, annualDaysFrom: '2026-07-01', reason: 'Antigüedad' });
    expect(res.status).toBe(200);
    // 48×181/365 + 52×184/365 = 50,02 → 50
    const b = await getBalance(String(employee._id), 2026);
    expect(b.ledger.current).toBe(50);
    expect(await LedgerEntry.countDocuments({ type: 'PRORATION_ADJUSTMENT', userId: employee._id })).toBe(1);
  });

  it('baja a mitad de año → prorrata y saldo de liquidación', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-17' }); // 20 u
    await approve(r.body.id);
    clock.set('2026-06-01T10:00:00+02:00');
    const root = await loginAs('root@test.local');
    const res = await root.post(`/api/users/${employee._id}/deactivate`, { leaveDate: '2026-06-30', reason: 'Fin de contrato' });
    expect(res.status).toBe(200);
    // derecho hasta el 30-06: 48×181/365 = 23,8 → 24; consumido 20 → liquidación +4 (2 días a favor)
    expect(res.body.entitlementUnits).toBe(24);
    expect(res.body.settlementUnits).toBe(4);
  });
});

describe('límite negativo (SPEC-07)', () => {
  it('−5 días se permite con aviso; −5,5 se bloquea', async () => {
    const cal = await makeCalendar();
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    await makeUser({ email: 'manager@test.local', role: 'admin', managerId: root._id, calendarId: cal._id });
    const u = await makeUser({ email: 'neg@test.local', calendarId: cal._id, annualDays: 0 });
    const emp = await loginAs(u.email);
    // 5 días laborables exactos: −10 unidades
    const p1 = await emp.post('/api/requests/preview', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-10' });
    expect(p1.body.errors).toEqual([]);
    expect(p1.body.warnings.map((w: { code: string }) => w.code)).toContain('NEGATIVE_BALANCE');
    const ok = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-10' });
    expect(ok.status).toBe(201);
    // medio día más: −10,5 → bloqueado (cuenta lo reservado por la pendiente)
    const bad = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-13', endDate: '2026-04-13', halfDay: { date: '2026-04-13', period: 'AM' } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('NEGATIVE_LIMIT');
  });

  it('el límite es configurable', async () => {
    const cal = await makeCalendar();
    await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    const u = await makeUser({ email: 'neg@test.local', calendarId: cal._id, annualDays: 0 });
    await updateSettings(SYSTEM, { negativeLimitUnits: 0 });
    const emp = await loginAs(u.email);
    const bad = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    expect(bad.body.error.code).toBe('NEGATIVE_LIMIT');
  });
});

describe('doble gasto concurrente (SPEC-01 / SPEC-11 regla 8)', () => {
  it('dos solicitudes simultáneas no superan el límite', async () => {
    const cal = await makeCalendar();
    await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    const u = await makeUser({ email: 'c@test.local', calendarId: cal._id, annualDays: 5 }); // 10 u, límite −10
    const emp = await loginAs(u.email);
    // cada una pide 4 días (8 u): una cabe (10 − 8 = 2), las dos juntas no (2 − 8 = −6 ≥ −10 sí cabe)…
    // así que pedimos 8 días cada una (16 u): una deja −6, la segunda dejaría −22 → solo una puede entrar
    const body = (s: string, e: string) => ({ kind: 'VACATION', startDate: s, endDate: e });
    const results = await Promise.all([
      emp.post('/api/requests', body('2026-04-06', '2026-04-15')),
      emp.post('/api/requests', body('2026-05-04', '2026-05-13')),
      emp.post('/api/requests', body('2026-06-01', '2026-06-10')),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 422, 422]);
    const b = await getBalance(String(u._id), 2026);
    expect(b.available.total).toBeGreaterThanOrEqual(-10);
  });
});

describe('arrastre, cierre y caducidad (SPEC-07 / SPEC-14)', () => {
  async function scenario(annualDays: number, consumeDays: [string, string] | null) {
    const cal = await makeCalendar();
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    await makeUser({ email: 'manager@test.local', role: 'admin', managerId: root._id, calendarId: cal._id });
    const u = await makeUser({ email: 'y@test.local', calendarId: cal._id, annualDays, managerId: root._id });
    if (consumeDays) {
      const emp = await loginAs(u.email);
      const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: consumeDays[0], endDate: consumeDays[1] });
      expect(r.status).toBe(201);
      await approve(r.body.id);
    }
    return u;
  }

  it('saldo positivo → CARRYOVER_IN que caduca el último día de febrero', async () => {
    const u = await scenario(24, ['2026-04-06', '2026-04-17']); // quedan 28 u
    clock.set('2027-01-01T00:10:00+01:00');
    const run = await runJob('year-close', { trigger: 'manual' });
    expect(run!.status).toBe('done');
    const b = await getBalance(String(u._id), 2027);
    expect(b.ledger.carryover).toBe(28);
    expect(b.ledger.current).toBe(48);
    expect(b.carryoverExpiresOn).toBe('2027-02-28');
    expect((await UserYear.findOne({ userId: u._id, year: 2026 }))!.closed).toBe(true);
  });

  it('saldo cero → nada que arrastrar', async () => {
    const cal = await makeCalendar();
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    const u = await makeUser({ email: 'z@test.local', calendarId: cal._id, annualDays: 0, managerId: root._id });
    clock.set('2027-01-02T10:00:00+01:00');
    await runJob('year-close', { trigger: 'manual', year: 2026 });
    const b = await getBalance(String(u._id), 2027);
    expect(b.ledger.carryover).toBe(0);
    expect(await LedgerEntry.countDocuments({ userId: u._id, type: { $in: ['CARRYOVER_IN', 'NEGATIVE_CARRYOVER'] } })).toBe(0);
  });

  it('saldo negativo → NEGATIVE_CARRYOVER en CURRENT del año siguiente (la deuda no caduca)', async () => {
    const u = await scenario(1, ['2026-04-06', '2026-04-08']); // 2 − 6 = −4
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    const b = await getBalance(String(u._id), 2027);
    expect(b.ledger.carryover).toBe(0);
    expect(b.ledger.current).toBe(2 - 4);
  });

  it('ejecutar el cierre dos veces da el mismo resultado (idempotente)', async () => {
    const u = await scenario(24, null);
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    await JobRun.deleteMany({}); // forzamos una segunda ejecución real
    await runJob('year-close', { trigger: 'manual' });
    const b = await getBalance(String(u._id), 2027);
    expect(b.ledger.carryover).toBe(48);
    expect(b.ledger.current).toBe(48);
    expect(await LedgerEntry.countDocuments({ userId: u._id, type: 'CARRYOVER_IN' })).toBe(1);
  });

  it('servidor caído el 1 de enero y arrancado el 3: el catch-up recupera el cierre', async () => {
    const u = await scenario(24, null);
    clock.set('2027-01-03T08:00:00+01:00');
    const ran = await catchUp();
    expect(ran).toContain('year-close:2026');
    expect((await getBalance(String(u._id), 2027)).ledger.carryover).toBe(48);
  });

  it('reasignación: días de enero-febrero ya aprobados se pasan a CARRYOVER al cerrar', async () => {
    const u = await scenario(24, null);
    const emp = await loginAs(u.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2027-01-11', endDate: '2027-01-15' }); // 10 u
    await approve(r.body.id);
    let b2027 = await getBalance(String(u._id), 2027);
    expect(b2027.ledger.current).toBe(48 - 10);
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    b2027 = await getBalance(String(u._id), 2027);
    expect(b2027.ledger.current).toBe(48);
    expect(b2027.ledger.carryover).toBe(48 - 10);
    const req = await VacationRequest.findById(r.body.id).lean();
    expect(req!.breakdown!.allocation.every((a) => a.bucket === 'CARRYOVER')).toBe(true);
  });

  it('consumo: días ≤ caducidad salen de arrastrados; posteriores de CURRENT con aviso', async () => {
    const u = await scenario(24, null);
    clock.set('2027-01-02T10:00:00+01:00');
    await runJob('year-close', { trigger: 'manual', year: 2026 });
    const emp = await loginAs(u.email);
    const p = await emp.post('/api/requests/preview', { kind: 'VACATION', startDate: '2027-02-25', endDate: '2027-03-02' });
    expect(p.body.allocation).toEqual([
      { year: 2027, bucket: 'CARRYOVER', units: 4 },
      { year: 2027, bucket: 'CURRENT', units: 4 },
    ]);
    expect(p.body.warnings.map((w: { code: string }) => w.code)).toContain('CARRYOVER_NOT_USED');
  });

  it('caducidad el 1 de marzo en año bisiesto (29-02)', async () => {
    const cal = await makeCalendar();
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id, openYears: [2027] });
    await makeUser({ email: 'manager@test.local', role: 'admin', managerId: root._id, calendarId: cal._id, openYears: [2027] });
    clock.set('2027-06-01T10:00:00+02:00');
    const u = await makeUser({ email: 'leap@test.local', calendarId: cal._id, managerId: root._id, openYears: [2027] });
    clock.set('2028-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual', year: 2027 });
    let b = await getBalance(String(u._id), 2028);
    expect(b.carryoverExpiresOn).toBe('2028-02-29');
    expect(b.ledger.carryover).toBe(48);
    // el 29-02 todavía se puede consumir de arrastrados
    clock.set('2028-02-28T10:00:00+01:00');
    const emp = await loginAs(u.email);
    const r = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2028-02-29', endDate: '2028-02-29' });
    expect(r.status).toBe(201);
    await approve(r.body.id);
    clock.set('2028-03-01T00:10:00+01:00');
    await runJob('carryover-expiry', { trigger: 'manual' });
    b = await getBalance(String(u._id), 2028);
    expect(b.ledger.carryover).toBe(0);
    const exp = await LedgerEntry.findOne({ userId: u._id, type: 'CARRYOVER_EXPIRY' }).lean();
    expect(exp!.units).toBe(-(48 - 2));
  });

  it('tope de arrastre configurable', async () => {
    const u = await scenario(24, null);
    await updateSettings(SYSTEM, { carryoverCapUnits: 10 });
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    expect((await getBalance(String(u._id), 2027)).ledger.carryover).toBe(10);
  });

  it('el ledger de un año cerrado queda congelado', async () => {
    const u = await scenario(24, null);
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    const root = await loginAs('root@test.local');
    const res = await root.post(`/api/balances/${u._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: 1, reason: 'Corrección tardía' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('YEAR_CLOSED');
  });

  it('avisos a 30 y 7 días de la caducidad, una sola vez cada uno', async () => {
    const u = await scenario(24, null);
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    const { Notification } = await import('../src/models');
    clock.set('2027-01-29T09:00:00+01:00'); // 30 días antes del 28-02
    await runJob('expiry-reminders', { trigger: 'manual' });
    await JobRun.deleteMany({ job: 'expiry-reminders' });
    await runJob('expiry-reminders', { trigger: 'manual' });
    expect(await Notification.countDocuments({ userId: u._id, type: 'CARRYOVER_EXPIRING' })).toBe(1);
    clock.set('2027-02-21T09:00:00+01:00'); // 7 días antes
    await runJob('expiry-reminders', { trigger: 'manual' });
    expect(await Notification.countDocuments({ userId: u._id, type: 'CARRYOVER_EXPIRING' })).toBe(2);
  });
});

describe('día de cumpleaños (SPEC-08)', () => {
  it('se asigna 1 día en la bolsa BIRTHDAY y se pide con aprobación', async () => {
    const { employee } = await standardOrg(); // cumpleaños 10-06 (miércoles)
    const b = await getBalance(String(employee._id), 2026);
    expect(b.ledger.birthday).toBe(2);
    expect(b.birthday.status).toBe('available');
    const emp = await loginAs(employee.email);
    const wrong = await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-11', endDate: '2026-06-11' });
    expect(wrong.body.error.code).toBe('BIRTHDAY_MUST_BE_EXACT');
    const half = await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-10', endDate: '2026-06-10', halfDay: { date: '2026-06-10', period: 'AM' } });
    expect(half.body.error.code).toBe('BIRTHDAY_NO_HALF_DAY');
    const r = await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-10', endDate: '2026-06-10' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('PENDING');
    await approve(r.body.id);
    const after = await getBalance(String(employee._id), 2026);
    expect(after.ledger.birthday).toBe(0);
    expect(after.ledger.current).toBe(48);
    expect(after.birthday.status).toBe('approved');
  });

  it('si cae en fin de semana se puede mover a un laborable del mismo mes', async () => {
    const cal = await makeCalendar();
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    const u = await makeUser({ email: 'b@test.local', calendarId: cal._id, birthday: '06-13', managerId: root._id }); // sábado
    const emp = await loginAs(u.email);
    expect((await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-07-01', endDate: '2026-07-01' })).body.error.code).toBe('BIRTHDAY_OUT_OF_WINDOW');
    expect((await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-15', endDate: '2026-06-15' })).status).toBe(201);
  });

  it('si cae en festivo también se puede mover', async () => {
    const cal = await makeCalendar();
    await addHoliday(cal._id, '2026-05-15', 'local', 'San Isidro');
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id });
    const u = await makeUser({ email: 'b@test.local', calendarId: cal._id, birthday: '05-15', managerId: root._id });
    const emp = await loginAs(u.email);
    expect((await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-05-18', endDate: '2026-05-18' })).status).toBe(201);
  });

  it('solo un día de cumpleaños por año', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs(employee.email);
    await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-10', endDate: '2026-06-10' });
    const again = await emp.post('/api/requests', { kind: 'BIRTHDAY', startDate: '2026-06-10', endDate: '2026-06-10' });
    expect(again.status).toBe(422);
  });

  it('no se arrastra: caduca el 31-12 si no se usa', async () => {
    const { employee } = await standardOrg();
    clock.set('2027-01-01T00:10:00+01:00');
    await runJob('year-close', { trigger: 'manual' });
    expect(await LedgerEntry.countDocuments({ userId: employee._id, type: 'BIRTHDAY_EXPIRY', year: 2026, units: -2 })).toBe(1);
    const b27 = await getBalance(String(employee._id), 2027);
    expect(b27.ledger.birthday).toBe(2);
    expect(b27.ledger.carryover).toBe(48);
  });

  it('si entra después de su cumpleaños, ese año no le corresponde', async () => {
    const cal = await makeCalendar();
    const u = await makeUser({ calendarId: cal._id, hireDate: '2026-06-11', birthday: '06-10' });
    const b = await getBalance(String(u._id), 2026);
    expect(b.ledger.birthday).toBe(0);
    expect(b.birthday.status).toBe('not-eligible');
  });

  it('29-02 en año no bisiesto se trata como 28-02', async () => {
    const cal = await makeCalendar();
    clock.set('2027-01-10T10:00:00+01:00');
    const root = await makeUser({ email: 'root@test.local', role: 'admin', calendarId: cal._id, openYears: [2027] });
    const u = await makeUser({ email: 'l@test.local', calendarId: cal._id, birthday: '02-29', managerId: root._id, openYears: [2027] });
    const b = await getBalance(String(u._id), 2027);
    expect(b.birthday.date).toBe('2027-02-28'); // domingo → movible en febrero
    expect(b.birthday.window).toEqual({ from: '2027-02-01', to: '2027-02-28', movable: true });
  });
});
