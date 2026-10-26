import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { yearOf } from '@ht/shared';
import { connectDb } from '../src/db/connect';
import { createApp } from '../src/http/app';
import { clock } from '../src/lib/clock';
import { Holiday, HolidayCalendar, User } from '../src/models';
import { hashPassword } from '../src/services/auth';
import { withTx } from '../src/db/tx';
import { ensureYearOpen } from '../src/services/balance/entitlement';
import { lockUserYears } from '../src/services/balance/ledger';
import type { Actor } from '../src/services/actor';

export const PASSWORD = 'contraseña-segura-123';

/** Cada archivo de test usa su propia base de datos dentro del replica set en memoria. */
export function useDb(name: string) {
  beforeAll(async () => {
    const uri = process.env.TEST_MONGODB_URI!;
    await connectDb(uri, `ht_${name}_${process.pid}`);
  });
  beforeEach(async () => {
    clock.set('2026-03-02T10:00:00+01:00');
    await mongoose.connection.db!.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  });
  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
    clock.reset();
  });
}

let app: Express | null = null;
export function getApp(): Express {
  app ??= createApp({ staticDir: '/nonexistent' });
  return app;
}

export async function makeCalendar() {
  return HolidayCalendar.create({ name: 'Madrid capital', regionCode: 'ES-MD', localityName: 'Madrid', isDefault: true });
}

export async function addHoliday(calendarId: unknown, date: string, scope: 'national' | 'regional' | 'local' = 'national', name = 'Festivo') {
  return Holiday.create({ date, name, scope, calendarIds: [calendarId], year: yearOf(date), source: 'manual' });
}

export interface MakeUserOpts {
  email?: string;
  name?: string;
  role?: 'admin' | 'user';
  managerId?: unknown;
  calendarId: unknown;
  hireDate?: string;
  annualDays?: number;
  birthday?: string | null;
  openYears?: number[];
  status?: 'active' | 'invited' | 'disabled';
}

let seq = 0;
export async function makeUser(o: MakeUserOpts) {
  seq++;
  const annualUnits = (o.annualDays ?? 24) * 2;
  const hireDate = o.hireDate ?? '2020-01-01';
  const u = await User.create({
    email: o.email ?? `user${seq}@test.local`,
    name: o.name ?? `Usuario ${seq}`,
    passwordHash: await hashPassword(PASSWORD),
    role: o.role ?? 'user',
    managerId: o.managerId ?? null,
    holidayCalendarId: o.calendarId,
    hireDate,
    annualUnits,
    annualHistory: [{ from: hireDate, units: annualUnits }],
    birthday: o.birthday ?? null,
    birthdayLocked: !!o.birthday,
    status: o.status ?? 'active',
  });
  for (const y of o.openYears ?? [yearOf(clock.today())]) {
    await withTx(async ({ session }) => {
      await lockUserYears(String(u._id), [y], session);
      await ensureYearOpen(u.toObject(), y, session);
    });
  }
  return u;
}

export function actorOf(u: { _id: unknown; role: string; name?: string }): Actor {
  return { id: String(u._id), role: u.role as Actor['role'], name: u.name };
}

/** Agente HTTP con sesión iniciada y la cabecera anti-CSRF. */
export async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(getApp());
  const res = await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'holidaytracker')
    .send({ email, password });
  if (res.status !== 200) throw new Error(`login falló: ${res.status} ${JSON.stringify(res.body)}`);
  return wrap(agent);
}

export function anon() {
  return wrap(request.agent(getApp()));
}

function wrap(agent: ReturnType<typeof request.agent>) {
  const h = (r: request.Test) => r.set('X-Requested-With', 'holidaytracker');
  return {
    agent,
    get: (url: string) => h(agent.get(url)),
    post: (url: string, body: object = {}) => h(agent.post(url)).send(body),
    patch: (url: string, body: object = {}) => h(agent.patch(url)).send(body),
    delete: (url: string, body: object = {}) => h(agent.delete(url)).send(body),
  };
}

/** Escenario estándar: admin raíz → manager (admin) → empleado. */
export async function standardOrg(opts: { years?: number[] } = {}) {
  const cal = await makeCalendar();
  const openYears = opts.years ?? [2026];
  const root = await makeUser({ email: 'root@test.local', name: 'Raíz Admin', role: 'admin', calendarId: cal._id, openYears });
  const manager = await makeUser({ email: 'manager@test.local', name: 'Marta Manager', role: 'admin', managerId: root._id, calendarId: cal._id, openYears });
  const employee = await makeUser({ email: 'emp@test.local', name: 'Elena Empleada', managerId: manager._id, calendarId: cal._id, openYears, birthday: '06-10' });
  const peer = await makeUser({ email: 'peer@test.local', name: 'Pablo Compañero', managerId: manager._id, calendarId: cal._id, openYears });
  return { cal, root, manager, employee, peer };
}
