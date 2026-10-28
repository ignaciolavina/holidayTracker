/**
 * Importación única (27-10-2026): equipo de Bemycar + vacaciones 2026 de la hoja "Calendario Vacaciones Equipo".
 * Usa los servicios de dominio (invitación, registro retroactivo de admin) para que saldos, ledger y auditoría cuadren.
 * Ejecutar en el contenedor de Railway desde /app/server:  MAIL_TRANSPORT=console npx tsx src/scripts/import-2026.ts
 */
import { connectDb, disconnectDb } from '../db/connect';
import { Holiday, MailItem, User } from '../models';
import { withTx } from '../db/tx';
import { inviteUser, updateUser } from '../services/users';
import { createRetroactive } from '../services/requests';
import { lockUserYears } from '../services/balance/ledger';
import { ensureYearOpen } from '../services/balance/entitlement';
import type { Actor } from '../services/actor';

const YEAR = 2026;
const HIRE = '2026-01-01';
const REASON = 'Importación del calendario de vacaciones 2026 (hoja de Google). Vacaciones ya aprobadas previamente.';
const IGNACIO = 'ignacio@bemycar.pro';
const MARIO = 'mario@bemycar.pro';
const SANTI = 'santiago@bemycar.pro';

interface Person { name: string; email: string; role: 'admin' | 'user'; manager: string | null; days: string }
const PEOPLE: Person[] = [
  { name: 'Mario P. García', email: MARIO, role: 'admin', manager: null, days: '' },
  { name: 'Santiago Miota', email: SANTI, role: 'admin', manager: MARIO, days: '' },
  { name: 'Daniel Stanciu', email: 'daniel.stanciu@bemycar.pro', role: 'user', manager: IGNACIO, days: '01-05 01-26 01-27 01-28 01-29 01-30 02-02 03-16 03-17 03-18 03-19 03-20 03-23 04-06 10-05 10-06 10-07 10-08 10-09' },
  { name: 'Miguel Zamora', email: 'miguel.zamora@bemycar.pro', role: 'user', manager: IGNACIO, days: '01-05 03-23 03-24 03-31 04-01 07-01 07-02 07-03 08-20 08-21 08-24 09-07 09-18 09-21 09-28 12-28 12-29 12-30' },
  { name: 'Miguel Mayans', email: 'miguel.mayans@bemycar.pro', role: 'user', manager: IGNACIO, days: '01-05 03-30 03-31 04-01 04-30 06-22 06-23 06-24 06-25 06-26 08-03 08-04 08-05 08-06 08-07 08-13 08-14 08-17 08-18 08-19 10-30 11-13' },
  { name: 'Emma Martínez', email: 'emma.martinez@bemycar.pro', role: 'user', manager: IGNACIO, days: '01-05 02-23 03-09 03-30 03-31 04-01 04-27 06-29 07-06 07-07 07-08 07-09 07-10 09-16 09-17 09-18 09-21 09-22 09-30' },
  { name: 'Brais Vidal', email: 'brais.vidal@bemycar.pro', role: 'user', manager: IGNACIO, days: '01-05 06-22 08-03 08-04 08-05 08-06 08-07 08-10 08-11 09-02 12-14 12-15 12-16 12-17 12-18 12-21 12-22 12-23 12-24 12-28 12-29 12-30 12-31' },
  { name: 'Soraya Alcobet', email: 'soraya.alcobet@bemycar.pro', role: 'user', manager: IGNACIO, days: '03-30 03-31 04-01=0.5 08-17 08-18 08-19 08-20 08-21 08-24 08-25 08-26 08-27 08-28' },
  { name: 'Cesar Galan', email: 'cesar.galan@bemycar.pro', role: 'user', manager: IGNACIO, days: '' },
  { name: 'Marco Guevara', email: 'marco.guevara@bemycar.pro', role: 'user', manager: IGNACIO, days: '' },
  { name: 'Jaime Ruiz', email: 'jaime.ruiz@bemycar.pro', role: 'user', manager: MARIO, days: '' },
  { name: 'Iván Serrano', email: 'ivan.serrano@bemycar.pro', role: 'user', manager: MARIO, days: '' },
  { name: 'Álvaro Rodríguez', email: 'alvaro.rodriguez@bemycar.pro', role: 'user', manager: MARIO, days: '01-05 01-09 04-17 04-20 04-21 04-22 04-23 04-24 07-27 07-28 07-29 07-30 07-31 08-24 08-25 08-26 08-27 08-28' },
  { name: 'Fabio Martinez', email: 'fabio.martinez@bemycar.pro', role: 'user', manager: SANTI, days: '06-08 06-22 06-23 06-24 06-25 06-26 07-31 08-31 09-01 09-02 09-03 09-04 09-07' },
];

const iso = (md: string) => `${YEAR}-${md}`;
const addDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

/** Agrupa días sueltos en rangos: dos días van juntos si entre ellos solo hay fines de semana o festivos. */
function toRanges(full: string[], holidays: Set<string>): Array<[string, string]> {
  const sorted = [...full].sort();
  const out: Array<[string, string]> = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last) {
      let x = addDay(last[1]);
      while (x < d && (isWeekend(x) || holidays.has(x))) x = addDay(x);
      if (x === d) { last[1] = d; continue; }
    }
    out.push([d, d]);
  }
  return out;
}

async function activate(userId: string) {
  await withTx(async ({ session }) => {
    await User.updateOne({ _id: userId, status: 'invited' }, { $set: { status: 'active' } }, { session });
    const u = await User.findById(userId).session(session).lean();
    await lockUserYears(userId, [YEAR], session);
    await ensureYearOpen(u as never, YEAR, session);
  });
}

async function main() {
  const start = new Date();
  await connectDb();
  try {
    const ignacio = await User.findOne({ email: IGNACIO }).lean();
    if (!ignacio) throw new Error('No existe el admin inicial');
    const asIgnacio: Actor = { id: String(ignacio._id), role: 'admin', name: ignacio.name };
    const holidays = new Set((await Holiday.find({ year: YEAR }).lean()).map((h) => h.date));
    const ids = new Map<string, string>([[IGNACIO, String(ignacio._id)]]);

    for (const p of PEOPLE) {
      const existing = await User.findOne({ email: p.email }).lean();
      if (existing && existing.status !== 'invited') {
        ids.set(p.email, String(existing._id));
        console.log(`= ${p.email} ya existe (${existing.status})`);
      } else {
        await inviteUser(asIgnacio, {
          email: p.email, name: p.name, role: p.role,
          managerId: p.manager ? ids.get(p.manager)! : null, hireDate: HIRE,
        });
        const u = await User.findOne({ email: p.email }).lean();
        ids.set(p.email, String(u!._id));
        console.log(`+ ${p.email} invitado (${p.role}, manager ${p.manager ?? '—'})`);
      }
      if (p.email === MARIO) {
        const asMario: Actor = { id: ids.get(MARIO)!, role: 'admin', name: p.name };
        await updateUser(asMario, String(ignacio._id), { managerId: ids.get(MARIO)! });
        console.log(`~ ${IGNACIO} → manager ${MARIO}`);
      }
    }

    for (const p of PEOPLE) {
      const userId = ids.get(p.email)!;
      await activate(userId);
      if (!p.days) continue;
      const tokens = p.days.split(' ');
      const full = tokens.filter((t) => !t.includes('=')).map(iso);
      const halves = tokens.filter((t) => t.includes('=')).map((t) => iso(t.split('=')[0]!));
      let units = 0; let n = 0;
      const jobs: Array<{ startDate: string; endDate: string; halfDay: { date: string; period: 'AM' } | null }> = [
        ...toRanges(full, holidays).map(([s, e]) => ({ startDate: s, endDate: e, halfDay: null })),
        ...halves.map((d) => ({ startDate: d, endDate: d, halfDay: { date: d, period: 'AM' as const } })),
      ];
      for (const j of jobs) {
        try {
          const r = await createRetroactive(asIgnacio, { userId, kind: 'VACATION', ...j, reason: REASON });
          units += r.units; n++;
        } catch (e) {
          console.log(`  ! ${p.email} ${j.startDate}..${j.endDate}: ${(e as Error).message}`);
        }
      }
      console.log(`  ${p.name}: ${n}/${jobs.length} solicitudes, ${units / 2} días`);
    }

    // Que no salgan emails de la importación cuando se active el envío (se reenviarán las invitaciones a mano).
    const del = await MailItem.deleteMany({ createdAt: { $gte: start } });
    console.log(`Emails de la importación descartados: ${del.deletedCount}`);
    console.log('IMPORT_DONE');
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => { console.error('IMPORT_FAILED', err); process.exitCode = 1; });
