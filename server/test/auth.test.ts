import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLog, Invitation, MailItem, PasswordReset, User } from '../src/models';
import { routeRegistry } from '../src/http/route';
import { sha256 } from '../src/lib/crypto';
import { AUDIT_ACTIONS } from '../src/services/audit';
import { anon, getApp, loginAs, makeCalendar, makeUser, PASSWORD, standardOrg, useDb } from './helpers';

useDb('auth');

const PUBLIC = new Set([
  'get /api/health',
  'post /api/auth/login',
  'post /api/auth/refresh',
  'post /api/auth/logout',
  'post /api/auth/forgot',
  'post /api/auth/reset',
  'get /api/invitations/token/:token',
  'post /api/invitations/accept',
]);

function concrete(path: string) {
  return path.replace(/:[a-zA-Z]+/g, (m) => (m === ':token' ? 'tok' : m === ':name' ? 'escalation' : '0123456789abcdef01234567'));
}

describe('políticas por endpoint (SPEC-04)', () => {
  it('todas las rutas montadas en la app están en el registro con política', () => {
    getApp();
    type Layer = { route?: { path: string; methods: Record<string, boolean> }; name: string; handle: { stack?: Layer[] }; regexp: RegExp };
    const stack = (getApp() as unknown as { _router: { stack: Layer[] } })._router.stack;
    let count = 0;
    for (const layer of stack) {
      if (layer.name !== 'router' || !layer.handle.stack) continue;
      for (const sub of layer.handle.stack) {
        if (!sub.route) continue;
        count++;
        // cada ruta del router tiene que existir en el registro con la misma política
        const methods = Object.keys(sub.route.methods);
        const found = routeRegistry.some((r) => methods.includes(r.method) && r.path.endsWith(sub.route!.path === '/' ? '' : sub.route!.path));
        expect(found, `${methods.join(',')} ${sub.route.path} sin política`).toBe(true);
      }
    }
    expect(count).toBe(routeRegistry.length);
    for (const r of routeRegistry) expect(['public', 'auth', 'admin']).toContain(r.policy);
  });

  it('solo las rutas públicas declaradas lo son', () => {
    const publics = routeRegistry.filter((r) => r.policy === 'public').map((r) => `${r.method} ${r.path}`);
    expect(new Set(publics)).toEqual(PUBLIC);
  });

  it('ninguna ruta no pública es accesible sin sesión (401)', async () => {
    const a = anon();
    for (const r of routeRegistry.filter((x) => x.policy !== 'public')) {
      const url = concrete(r.path);
      const res = await (r.method === 'get' ? a.get(url) : a[r.method === 'delete' ? 'delete' : r.method === 'patch' ? 'patch' : 'post'](url, {}));
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it('las rutas admin devuelven 403 a un usuario normal', async () => {
    await standardOrg();
    const u = await loginAs('emp@test.local');
    for (const r of routeRegistry.filter((x) => x.policy === 'admin')) {
      const url = concrete(r.path);
      const res = await (r.method === 'get' ? u.get(url) : u[r.method === 'delete' ? 'delete' : r.method === 'patch' ? 'patch' : 'post'](url, {}));
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
    }
  });
});

describe('autenticación y sesiones (SPEC-02)', () => {
  it('login correcto pone cookies httpOnly y sameSite=lax; incorrecto da 401 con mensaje genérico', async () => {
    await standardOrg();
    const res = await request(getApp()).post('/api/auth/login').set('X-Requested-With', 'holidaytracker').send({ email: 'emp@test.local', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('ht_access=') && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('ht_refresh=') && /Path=\/api\/auth/i.test(c))).toBe(true);
    const bad = await anon().post('/api/auth/login', { email: 'emp@test.local', password: 'mala-contraseña' });
    const unknown = await anon().post('/api/auth/login', { email: 'nadie@test.local', password: 'mala-contraseña' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('las peticiones que modifican exigen la cabecera anti-CSRF', async () => {
    await standardOrg();
    const res = await request(getApp()).post('/api/auth/login').send({ email: 'emp@test.local', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
    const evil = await request(getApp())
      .post('/api/auth/login')
      .set('X-Requested-With', 'holidaytracker')
      .set('Origin', 'https://evil.example')
      .send({ email: 'emp@test.local', password: PASSWORD });
    expect(evil.status).toBe(403);
  });

  it('un usuario desactivado pierde el acceso en su siguiente request', async () => {
    const { employee } = await standardOrg();
    const emp = await loginAs('emp@test.local');
    expect((await emp.get('/api/auth/me')).status).toBe(200);
    const root = await loginAs('root@test.local');
    expect((await root.post(`/api/users/${employee._id}/deactivate`, { leaveDate: '2026-03-02' })).status).toBe(200);
    expect((await emp.get('/api/auth/me')).status).toBe(401);
    expect((await emp.post('/api/auth/refresh')).status).toBe(401);
  });

  it('cambiar el rol invalida las sesiones (tokenVersion)', async () => {
    const { peer } = await standardOrg();
    const p = await loginAs(peer.email);
    const root = await loginAs('root@test.local');
    await root.patch(`/api/users/${peer._id}`, { role: 'admin', reason: 'Nuevo responsable' });
    expect((await p.get('/api/auth/me')).status).toBe(401);
  });

  it('refresh rotativo: un refresh token no se puede reutilizar y reutilizarlo revoca la familia', async () => {
    await standardOrg();
    const res = await request(getApp()).post('/api/auth/login').set('X-Requested-With', 'holidaytracker').send({ email: 'emp@test.local', password: PASSWORD });
    const refreshCookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('ht_refresh='))!.split(';')[0]!;
    const r1 = await request(getApp()).post('/api/auth/refresh').set('X-Requested-With', 'holidaytracker').set('Cookie', refreshCookie);
    expect(r1.status).toBe(200);
    const newRefresh = ([] as string[]).concat(r1.headers['set-cookie']).find((c) => c.startsWith('ht_refresh='))!.split(';')[0]!;
    const reuse = await request(getApp()).post('/api/auth/refresh').set('X-Requested-With', 'holidaytracker').set('Cookie', refreshCookie);
    expect(reuse.status).toBe(401);
    // la familia queda revocada: el token nuevo tampoco vale
    const r2 = await request(getApp()).post('/api/auth/refresh').set('X-Requested-With', 'holidaytracker').set('Cookie', newRefresh);
    expect(r2.status).toBe(401);
  });

  it('recuperación: respuesta idéntica exista o no el email; token de un solo uso que caduca en 1 h', async () => {
    const { employee } = await standardOrg();
    const a = await anon().post('/api/auth/forgot', { email: 'emp@test.local' });
    const b = await anon().post('/api/auth/forgot', { email: 'noexiste@test.local' });
    expect(a.status).toBe(204);
    expect(b.status).toBe(204);
    expect(a.body).toEqual(b.body);
    expect(await PasswordReset.countDocuments()).toBe(1);
    expect(await MailItem.countDocuments({ to: 'emp@test.local' })).toBe(1);
    // generamos un token conocido para probar el reset
    await PasswordReset.create({ userId: employee._id, tokenHash: sha256('token-de-prueba-123'), expiresAt: new Date(Date.UTC(2026, 2, 2, 10, 0)) });
    const ok = await anon().post('/api/auth/reset', { token: 'token-de-prueba-123', password: 'nueva-contraseña-larga' });
    expect(ok.status).toBe(204);
    const again = await anon().post('/api/auth/reset', { token: 'token-de-prueba-123', password: 'otra-contraseña-larga' });
    expect(again.status).toBe(422);
    await expect(loginAs('emp@test.local', 'nueva-contraseña-larga')).resolves.toBeTruthy();
  });

  it('política de contraseña: mínimo 10 caracteres', async () => {
    await standardOrg();
    const res = await anon().post('/api/auth/reset', { token: 'x'.repeat(20), password: 'corta' });
    expect(res.status).toBe(400);
  });

  it('errores sin stack trace', async () => {
    const res = await anon().post('/api/auth/login', { email: 'no-es-un-email' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
});

describe('invitaciones (SPEC-03)', () => {
  it('invitar → aceptar → entra con su contraseña y fija su cumpleaños', async () => {
    const { root, cal } = await standardOrg();
    const r = await loginAs(root.email);
    const inv = await r.post('/api/invitations', { email: 'nueva@test.local', name: 'Nuria Nueva', role: 'user', managerId: String(root._id), holidayCalendarId: String(cal._id), hireDate: '2026-03-02', annualDays: 24 });
    expect(inv.status).toBe(200);
    expect(inv.body.status).toBe('pending');
    // token conocido para la prueba
    const token = 'token-de-invitacion-0123456789';
    await Invitation.updateOne({ _id: inv.body.id }, { $set: { tokenHash: sha256(token) } });
    const info = await anon().get(`/api/invitations/token/${token}`);
    expect(info.body).toEqual({ email: 'nueva@test.local', name: 'Nuria Nueva', needsBirthday: true });
    const acc = await anon().post('/api/invitations/accept', { token, password: 'contraseña-nueva-1', birthday: '07-07' });
    expect(acc.status).toBe(200);
    const again = await anon().post('/api/invitations/accept', { token, password: 'contraseña-nueva-1' });
    expect(again.status).toBe(422);
    const u = await User.findOne({ email: 'nueva@test.local' }).lean();
    expect(u!.status).toBe('active');
    expect(u!.birthdayLocked).toBe(true);
    await expect(loginAs('nueva@test.local', 'contraseña-nueva-1')).resolves.toBeTruthy();
  });

  it('el manager tiene que ser admin; sin ciclos; nadie es su propio manager', async () => {
    const { root, employee, manager } = await standardOrg();
    const r = await loginAs(root.email);
    const bad = await r.post('/api/invitations', { email: 'x@test.local', name: 'Xavi', role: 'user', managerId: String(employee._id), hireDate: '2026-03-02' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('MANAGER_NOT_ADMIN');
    const cycle = await r.patch(`/api/users/${manager._id}`, { managerId: String(manager._id), reason: 'test' });
    expect(cycle.body.error.code).toBe('MANAGER_SELF');
    // root bajo manager → ciclo
    const m = await loginAs(manager.email);
    const c2 = await m.patch(`/api/users/${root._id}`, { managerId: String(manager._id), reason: 'test' });
    expect(c2.body.error.code).toBe('MANAGER_CYCLE');
  });

  it('no se quita el admin ni se desactiva a quien tiene reportes directos', async () => {
    const { root, manager } = await standardOrg();
    const r = await loginAs(root.email);
    expect((await r.patch(`/api/users/${manager._id}`, { role: 'user', reason: 'test' })).body.error.code).toBe('HAS_DIRECT_REPORTS');
    expect((await r.post(`/api/users/${manager._id}/deactivate`, { leaveDate: '2026-03-02' })).body.error.code).toBe('HAS_DIRECT_REPORTS');
  });

  it('reenviar invalida el token anterior; revocar impide aceptar', async () => {
    const { root } = await standardOrg();
    const r = await loginAs(root.email);
    const inv = await r.post('/api/invitations', { email: 'n2@test.local', name: 'Nico', role: 'user', managerId: String(root._id), hireDate: '2026-03-02' });
    await Invitation.updateOne({ _id: inv.body.id }, { $set: { tokenHash: sha256('viejo-token-0123456789') } });
    await r.post(`/api/invitations/${inv.body.id}/resend`);
    expect((await anon().get('/api/invitations/token/viejo-token-0123456789')).status).toBe(422);
    await r.post(`/api/invitations/${inv.body.id}/revoke`);
    const list = await r.get('/api/invitations');
    expect(list.body.find((i: { id: string }) => i.id === inv.body.id).status).toBe('revoked');
  });

  it('los usuarios normales no ven saldos ajenos ni detalles de admin', async () => {
    await standardOrg();
    const u = await loginAs('emp@test.local');
    const users = await u.get('/api/users');
    expect(users.status).toBe(200);
    expect(Object.keys(users.body[0]).sort()).toEqual(['avatarUrl', 'id', 'managerId', 'name', 'role', 'status']);
    const tree = await u.get('/api/org/tree');
    expect(tree.body.every((n: { availableUnits?: number }) => n.availableUnits === undefined)).toBe(true);
  });
});

describe('auditoría (SPEC-12)', () => {
  it('las acciones sensibles de SPEC-11 punto 11 están en el catálogo', () => {
    for (const a of [
      'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_REVOKED', 'REQUEST_RETROACTIVE', 'BALANCE_ADJUSTED',
      'USER_ANNUAL_DAYS_CHANGED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_BIRTHDAY_CHANGED', 'USER_MANAGER_CHANGED',
      'USER_ROLE_CHANGED', 'HOLIDAY_CREATED', 'HOLIDAY_UPDATED', 'HOLIDAY_DELETED', 'SETTINGS_CHANGED', 'REQUEST_AUTO_APPROVED_NO_APPROVER',
    ]) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
  });

  it('cada acción sensible deja registro con antes y después', async () => {
    const { root, employee, peer, cal } = await standardOrg();
    const r = await loginAs(root.email);
    const mgr = await loginAs('manager@test.local');
    const emp = await loginAs(employee.email);
    const a = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-07' });
    await mgr.post(`/api/requests/${a.body.id}/approve`);
    const b = await emp.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-13', endDate: '2026-04-13' });
    await mgr.post(`/api/requests/${b.body.id}/reject`, { reason: 'No encaja' });
    await r.post(`/api/requests/${a.body.id}/revoke`, { reason: 'Prueba', confirmText: 'ANULAR' });
    await r.post('/api/requests/retroactive', { userId: String(employee._id), kind: 'VACATION', startDate: '2026-02-23', endDate: '2026-02-23', reason: 'Olvido', confirmText: 'REGISTRAR' });
    await r.post(`/api/balances/${employee._id}/adjust`, { year: 2026, bucket: 'CURRENT', days: 1, reason: 'Ajuste' });
    await r.patch(`/api/users/${employee._id}`, { annualDays: 25, reason: 'Convenio' });
    await r.patch(`/api/users/${employee._id}`, { birthday: '06-11', reason: 'Error' });
    await r.patch(`/api/users/${peer._id}`, { managerId: String(root._id), reason: 'Reorganización' });
    await r.patch(`/api/users/${peer._id}`, { role: 'admin', reason: 'Ascenso' });
    await r.post('/api/holidays', { date: '2026-05-15', name: 'San Isidro', scope: 'local', calendarIds: [String(cal._id)] });
    await r.patch('/api/settings', { escalationHours: 24, reason: 'Más ágil' });
    const peerUser = await makeUser({ email: 'leave@test.local', calendarId: cal._id, managerId: root._id });
    await r.post(`/api/users/${peerUser._id}/deactivate`, { leaveDate: '2026-03-02' });
    const actions = new Set((await AuditLog.find({}).lean()).map((x) => x.action));
    for (const act of ['REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_REVOKED', 'REQUEST_RETROACTIVE', 'BALANCE_ADJUSTED', 'USER_ANNUAL_DAYS_CHANGED', 'USER_BIRTHDAY_CHANGED', 'USER_MANAGER_CHANGED', 'USER_ROLE_CHANGED', 'HOLIDAY_CREATED', 'SETTINGS_CHANGED', 'USER_DEACTIVATED']) {
      expect(actions, act).toContain(act);
    }
    const adj = await AuditLog.findOne({ action: 'USER_ANNUAL_DAYS_CHANGED' }).lean();
    expect(adj!.before).toEqual({ annualUnits: 48 });
    expect(adj!.reason).toBe('Convenio');
    // vista de actividad sensible y exportación
    const sens = await r.get('/api/audit?sensitive=1');
    expect(sens.body.items.every((i: { sensitive: boolean }) => i.sensitive)).toBe(true);
    expect(sens.body.total).toBeGreaterThanOrEqual(3);
    const csv = await r.get('/api/audit/export.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('BALANCE_ADJUSTED');
  });

  it('un admin único sin otros admins → autoaprobación visible en el panel', async () => {
    const cal = await makeCalendar();
    const solo = await makeUser({ email: 'solo@test.local', role: 'admin', calendarId: cal._id });
    const s = await loginAs(solo.email);
    await s.post('/api/requests', { kind: 'VACATION', startDate: '2026-04-06', endDate: '2026-04-06' });
    const ov = await s.get('/api/admin/overview');
    expect(ov.body.alerts.map((a: { code: string }) => a.code)).toContain('AUTO_APPROVALS');
  });
});
