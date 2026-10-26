import { addDays, dayOfWeek, type ISODate, type Role } from '@ht/shared';
import holidaysJson from './holidays-madrid.json';
import { Holiday, HolidayCalendar, User } from '../models';
import { clock } from '../lib/clock';
import { withTx } from '../db/tx';
import { hashPassword } from '../services/auth';
import type { Actor } from '../services/actor';
import { lockUserYears } from '../services/balance/ledger';
import { ensureYearOpen } from '../services/balance/entitlement';
import { approveRequest, cancelRequest, createRequest, rejectRequest, revokeRequest } from '../services/requests';
import { runJob } from '../services/jobs/runner';

/**
 * Seed de desarrollo (SPEC-20). Todos los saldos y solicitudes se crean con los servicios de dominio
 * (nunca escribiendo en el ledger a mano), usando el reloj inyectable para simular la historia.
 */

export const SEED_PASSWORD = 'vacaciones2026';

type Key = 'ana' | 'bruno' | 'carla' | 'diego' | 'marta' | 'javier' | 'lucia' | 'pablo' | 'sara';

interface Person {
  key: Key;
  email: string;
  name: string;
  role: Role;
  manager: Key | null;
  hireDate: ISODate;
  birthday: string | null;
}

/** Orden: la raíz primero, luego los managers y por último los empleados (cada manager existe antes). */
const PEOPLE: Person[] = [
  { key: 'ana', email: 'ana.admin@holidaytracker.local', name: 'Ana Directora', role: 'admin', manager: null, hireDate: '2024-01-15', birthday: '04-23' },
  { key: 'bruno', email: 'bruno.manager@holidaytracker.local', name: 'Bruno Manager', role: 'admin', manager: 'ana', hireDate: '2024-01-15', birthday: '09-22' },
  { key: 'carla', email: 'carla.manager@holidaytracker.local', name: 'Carla Manager', role: 'admin', manager: 'ana', hireDate: '2024-01-15', birthday: '11-05' },
  { key: 'diego', email: 'diego.ruiz@holidaytracker.local', name: 'Diego Ruiz', role: 'user', manager: 'bruno', hireDate: '2024-01-15', birthday: '06-13' },
  { key: 'marta', email: 'marta.sanchez@holidaytracker.local', name: 'Marta Sánchez', role: 'user', manager: 'bruno', hireDate: '2024-01-15', birthday: '02-18' },
  { key: 'javier', email: 'javier.lopez@holidaytracker.local', name: 'Javier López', role: 'user', manager: 'bruno', hireDate: '2026-06-15', birthday: '10-07' },
  { key: 'lucia', email: 'lucia.fernandez@holidaytracker.local', name: 'Lucía Fernández', role: 'user', manager: 'carla', hireDate: '2024-01-15', birthday: null },
  { key: 'pablo', email: 'pablo.martin@holidaytracker.local', name: 'Pablo Martín', role: 'user', manager: 'carla', hireDate: '2024-01-15', birthday: '07-21' },
  { key: 'sara', email: 'sara.gomez@holidaytracker.local', name: 'Sara Gómez', role: 'user', manager: 'carla', hireDate: '2024-01-15', birthday: '10-02' },
];

export const SEED_USERS = PEOPLE.map(({ email, name, role }) => ({ email, name, role }));

const HOLIDAYS = holidaysJson as Array<{ date: ISODate; name: string; scope: string }>;
const HOLIDAY_DATES = new Set(HOLIDAYS.map((h) => h.date));

// ───────── fechas laborables ─────────

function isWorkday(d: ISODate): boolean {
  const w = dayOfWeek(d);
  return w !== 0 && w !== 6 && !HOLIDAY_DATES.has(d);
}

/** Primer laborable en o después de `d`. */
function workdayFrom(d: ISODate): ISODate {
  let x = d;
  while (!isWorkday(x)) x = addDays(x, 1);
  return x;
}

/** Rango de `days` laborables consecutivos (sin contar fines de semana ni festivos). */
function spanFrom(from: ISODate, days: number): { startDate: ISODate; endDate: ISODate } {
  const startDate = workdayFrom(from);
  let endDate = startDate;
  for (let i = 1; i < days; i++) endDate = workdayFrom(addDays(endDate, 1));
  return { startDate, endDate };
}

// ───────── reloj ─────────

const at = (day: ISODate, hhmm = '10:00:00', offset = '+01:00') => clock.set(`${day}T${hhmm}${offset}`);

/** Si la fecha de inicio ya ha llegado, retrocede el reloj a la víspera para que la solicitud no sea "en el pasado". */
function clockBefore(startDate: ISODate): void {
  if (clock.today() >= startDate) at(addDays(startDate, -1));
}

// ───────── usuarios ─────────

async function createPeople(calendarId: unknown): Promise<People> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const out: People = new Map();
  for (const p of PEOPLE) {
    const manager = p.manager ? out.get(p.manager)! : null;
    const doc = await User.create({
      email: p.email,
      name: p.name,
      passwordHash,
      role: p.role,
      managerId: manager ? manager._id : null,
      holidayCalendarId: calendarId,
      hireDate: p.hireDate,
      birthday: p.birthday,
      birthdayLocked: p.birthday !== null,
      annualUnits: 48,
      annualHistory: [{ from: p.hireDate, units: 48 }],
      status: 'active',
    });
    out.set(p.key, doc);
  }
  return out;
}

async function openYear(user: UserRef, year: number): Promise<void> {
  const userLean = await User.findById(user._id).lean();
  if (!userLean) throw new Error(`usuario no encontrado: ${user.email}`);
  await withTx(async ({ session }) => {
    await lockUserYears(String(user._id), [year], session);
    await ensureYearOpen(userLean, year, session);
  });
}

// ───────── solicitudes ─────────

interface Plan {
  owner: Key;
  /** Primer día pedido; si no es laborable se mueve al siguiente. */
  from: ISODate;
  /** Días laborables (por defecto 1). Ignorado con `half`. */
  days?: number;
  kind?: 'VACATION' | 'BIRTHDAY';
  half?: 'AM' | 'PM';
  outcome: 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED' | 'REVOKED';
  /** Fecha del reloj con la que se crea (por defecto, la víspera del inicio si hiciera falta). */
  clockAt?: ISODate;
  note?: string;
}

type UserRef = { _id: unknown; email: string; name: string; role: string };
type People = Map<Key, UserRef>;

const actorOf = (u: UserRef): Actor => ({ id: String(u._id), role: u.role as Role, name: u.name });

/** Aprobador: el manager del empleado; para Ana (sin manager), Bruno. */
function approverOf(people: People, key: Key): Actor {
  const person = PEOPLE.find((p) => p.key === key)!;
  return actorOf(people.get(person.manager ?? 'bruno')!);
}

/** Anulador: un admin distinto del usuario (Ana, salvo que la solicitud sea suya). */
function revokerOf(people: People, key: Key): Actor {
  return actorOf(people.get(key === 'ana' ? 'bruno' : 'ana')!);
}

async function runPlan(people: People, p: Plan): Promise<void> {
  const ownerDoc = people.get(p.owner)!;
  const owner = actorOf(ownerDoc);
  const startFrom = workdayFrom(p.from);
  const span = p.half
    ? { startDate: startFrom, endDate: startFrom }
    : spanFrom(startFrom, p.days ?? 1);

  if (p.clockAt) at(p.clockAt);
  else clockBefore(span.startDate);

  const dto = await createRequest(owner, {
    kind: p.kind ?? 'VACATION',
    startDate: span.startDate,
    endDate: span.endDate,
    halfDay: p.half ? { date: span.startDate, period: p.half } : null,
  });
  const id = dto.id;

  switch (p.outcome) {
    case 'PENDING':
      return;
    case 'APPROVED':
      await approveRequest(approverOf(people, p.owner), id, { acknowledgeStarted: true });
      return;
    case 'REJECTED':
      await rejectRequest(approverOf(people, p.owner), id, p.note ?? 'No se puede aprobar en esas fechas');
      return;
    case 'CANCELLED':
      await cancelRequest(owner, id, p.note ?? 'Ya no me hace falta');
      return;
    case 'REVOKED':
      await approveRequest(approverOf(people, p.owner), id, { acknowledgeStarted: true });
      await revokeRequest(revokerOf(people, p.owner), id, { reason: p.note ?? 'Cambio de planes del equipo' });
      return;
  }
}

async function runPlanSafely(people: People, p: Plan): Promise<void> {
  try {
    await runPlan(people, p);
  } catch (err) {
    console.warn(`seed: no se pudo crear la solicitud de ${p.owner} desde ${p.from} (${p.outcome}): ${(err as Error).message}`);
  }
}

/** Vacaciones de 2025 (sin festivos cargados para ese año): bloques de días laborables. */
const PLAN_2025: Array<{ owner: Key; blocks: Array<[ISODate, number]> }> = [
  { owner: 'ana', blocks: [['2025-07-07', 10], ['2025-08-18', 9]] }, // 19 → arrastra 5
  { owner: 'bruno', blocks: [['2025-07-14', 10], ['2025-08-25', 10]] }, // 20 → arrastra 4
  { owner: 'carla', blocks: [['2025-07-21', 10], ['2025-09-01', 11]] }, // 21 → arrastra 3
  { owner: 'diego', blocks: [['2025-07-28', 10], ['2025-09-08', 8]] }, // 18 → arrastra 6
  { owner: 'marta', blocks: [['2025-07-01', 10], ['2025-08-04', 4]] }, // 14 → arrastra 10
  { owner: 'lucia', blocks: [['2025-06-30', 10], ['2025-07-28', 10], ['2025-09-29', 2]] }, // 22 → arrastra 2
  { owner: 'pablo', blocks: [['2025-06-02', 10], ['2025-07-14', 10], ['2025-08-25', 6]] }, // 26 → deuda de 2
  { owner: 'sara', blocks: [['2025-08-04', 10], ['2025-09-15', 10]] }, // 20 → arrastra 4
];

/** Solicitudes de 2026 en todos los estados. Fechas laborables y sin solapes por usuario. */
const PLAN_2026: Plan[] = [
  // Ana (aprueba Bruno)
  { owner: 'ana', from: '2026-03-02', days: 5, outcome: 'APPROVED' },
  { owner: 'ana', from: '2026-11-02', days: 3, outcome: 'APPROVED' },
  // Bruno (aprueba Ana)
  { owner: 'bruno', from: '2026-04-13', days: 5, outcome: 'APPROVED' },
  { owner: 'bruno', from: '2026-12-28', days: 3, outcome: 'PENDING' },
  // Carla (aprueba Ana)
  { owner: 'carla', from: '2026-05-18', days: 4, outcome: 'APPROVED' },
  { owner: 'carla', from: '2026-11-16', days: 5, outcome: 'PENDING' },
  // Diego (aprueba Bruno). Cumpleaños el sábado 13-06: se mueve al lunes 15-06
  { owner: 'diego', from: '2026-03-23', days: 5, outcome: 'APPROVED' },
  { owner: 'diego', kind: 'BIRTHDAY', from: '2026-06-15', outcome: 'APPROVED' },
  { owner: 'diego', from: '2026-08-17', days: 5, outcome: 'APPROVED' },
  { owner: 'diego', from: '2026-09-07', days: 5, outcome: 'REVOKED', note: 'Cambio de planes del equipo' },
  { owner: 'diego', from: '2026-11-23', days: 4, outcome: 'CANCELLED' },
  // Marta (aprueba Bruno). Usa los días arrastrados en febrero
  { owner: 'marta', from: '2026-02-09', days: 5, outcome: 'APPROVED', clockAt: '2026-01-20' },
  { owner: 'marta', from: '2026-04-06', days: 5, outcome: 'APPROVED' },
  { owner: 'marta', from: '2026-09-14', half: 'AM', outcome: 'APPROVED' },
  { owner: 'marta', from: '2026-12-14', days: 4, outcome: 'PENDING' },
  // Javier (alta 15-06-2026, aprueba Bruno)
  { owner: 'javier', from: '2026-07-20', days: 5, outcome: 'APPROVED' },
  { owner: 'javier', from: '2026-11-30', days: 3, outcome: 'PENDING' },
  // Lucía (aprueba Carla)
  { owner: 'lucia', from: '2026-06-01', days: 5, outcome: 'APPROVED' },
  { owner: 'lucia', from: '2026-09-28', days: 3, outcome: 'REJECTED', note: 'Coincide con el cierre trimestral del equipo' },
  // Pablo (aprueba Carla). Arranca con saldo negativo de 2025
  { owner: 'pablo', from: '2026-01-26', days: 3, outcome: 'APPROVED' },
  { owner: 'pablo', from: '2026-03-16', days: 4, outcome: 'APPROVED' },
  { owner: 'pablo', from: '2026-07-27', days: 5, outcome: 'APPROVED' },
  // Sara (aprueba Carla)
  { owner: 'sara', from: '2026-08-03', days: 5, outcome: 'APPROVED' },
  { owner: 'sara', from: '2026-11-23', days: 4, outcome: 'PENDING' },
];

// ───────── seed completo ─────────

export async function runSeed(): Promise<void> {
  try {
    // 1) calendario y festivos
    const cal = await HolidayCalendar.create({ name: 'Madrid capital', regionCode: 'ES-MD', localityName: 'Madrid', isDefault: true });
    for (const h of HOLIDAYS) {
      await Holiday.create({ ...h, calendarIds: [cal._id], year: Number(h.date.slice(0, 4)), source: 'import' });
    }

    // 2) usuarios
    const people = await createPeople(cal._id);

    // 3) 2025: abrir año, vacaciones, cierre del año
    at('2025-03-03');
    for (const p of PEOPLE) {
      if (p.hireDate < '2026-01-01') await openYear(people.get(p.key)!, 2025);
    }
    for (const plan of PLAN_2025) {
      for (const [from, days] of plan.blocks) {
        await runPlanSafely(people, { owner: plan.owner, from, days, outcome: 'APPROVED' });
      }
    }
    at('2026-01-01', '00:10:00');
    const job = await runJob('year-close', { trigger: 'manual', year: 2025 });
    if (!job || job.status !== 'done') console.warn(`seed: el cierre de 2025 no terminó bien (${job?.status ?? 'sin ejecutar'})`);

    // 4) alta de Javier: 2026 con prorrata
    at('2026-06-15', '10:00:00', '+02:00');
    await openYear(people.get('javier')!, 2026);

    // 5) 2026 con solicitudes en todos los estados (reloj real, retrocediendo cuando haga falta)
    clock.reset();
    for (const p of PLAN_2026) await runPlanSafely(people, p);
  } finally {
    clock.reset();
  }
}

export async function seedIfEmpty(): Promise<boolean> {
  if (await User.exists({})) return false;
  await runSeed();
  return true;
}
