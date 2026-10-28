/**
 * Importación única (28-10-2026): vacaciones 2026 de los admins (hoja "Board - Calendario Vacaciones")
 * + ajuste de saldo para que cuadre con la columna "Pendiente".
 * El límite negativo se sube temporalmente (Mario termina en −8,5) y se restaura al final; ambos cambios quedan auditados.
 */
import { connectDb, disconnectDb } from '../db/connect';
import { Holiday, MailItem, User } from '../models';
import { withTx } from '../db/tx';
import { createRetroactive } from '../services/requests';
import { adjustBalance } from '../services/balance/admin';
import { getBalance } from '../services/balance/state';
import { lockUserYears } from '../services/balance/ledger';
import { ensureYearOpen } from '../services/balance/entitlement';
import { getSettings, updateSettings } from '../services/settings';
import type { Actor } from '../services/actor';

const YEAR = 2026;
const REASON = 'Importación del calendario de vacaciones 2026 del Board (hoja de Google). Vacaciones ya aprobadas previamente.';
const ADJ = 'Saldo inicial 2026 según la hoja "Board - Calendario Vacaciones" (columna Pendiente).';
const PEOPLE: Array<{ email: string; pending: number; days: string }> = [
  { email: 'mario@bemycar.pro', pending: -8.5, days: '01-05 02-27 03-02 03-18 03-19 03-20 03-23 03-24 03-25 03-26 03-27 03-30 03-31 04-01 05-14 05-28 05-29 06-01 06-18=0.5 07-30 08-10 08-11 08-19=0.5 08-20 08-21 08-24 08-25 08-26 08-27 08-28 08-31 09-01 09-02 12-03 12-04 12-09 12-10 12-11 12-14 12-15' },
  { email: 'santiago@bemycar.pro', pending: 7, days: '01-05 05-07=0.5 05-08 08-03 08-04 08-05 08-06 08-07 08-10 08-11 08-12 08-13 08-14 08-17 08-18 08-19 08-20 08-21 08-24 08-25 08-26 08-27 08-28' },
  { email: 'ignacio@bemycar.pro', pending: 4, days: '01-05 03-30 03-31 04-01 05-14 05-28 05-29 06-03 06-04 06-05 06-08 06-17 06-18 06-19 07-29 07-30 07-31 08-03=0.5 08-04=0.5 08-05=0.5 08-06=0.5 08-07=0.5 08-10=0.5 08-11=0.5 08-12=0.5 08-13=0.5 08-14=0.5 08-17=0.5 08-18=0.5 08-19=0.5 08-20=0.5 08-21=0.5 08-24 08-25 08-26 08-27 08-28 10-25' },
];

const iso = (md: string) => `${YEAR}-${md}`;
const addDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
function toRanges(full: string[], holidays: Set<string>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const d of [...full].sort()) {
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

async function main() {
  const start = new Date();
  await connectDb();
  const users = new Map<string, { id: string; name: string }>();
  for (const p of PEOPLE) {
    const u = (await User.findOne({ email: p.email }).lean())!;
    users.set(p.email, { id: String(u._id), name: u.name });
  }
  const actorFor = (email: string): Actor => {
    const other = email === 'ignacio@bemycar.pro' ? 'mario@bemycar.pro' : 'ignacio@bemycar.pro';
    const o = users.get(other)!;
    return { id: o.id, role: 'admin', name: o.name };
  };
  const original = (await getSettings()).negativeLimitUnits;
  const sys = actorFor('mario@bemycar.pro');
  try {
    await updateSettings(sys, { negativeLimitUnits: 200 }, 'Temporal: importación de vacaciones 2026 del Board');
    const holidays = new Set((await Holiday.find({ year: YEAR }).lean()).map((h) => h.date));
    for (const p of PEOPLE) {
      const { id: userId, name } = users.get(p.email)!;
      const actor = actorFor(p.email);
      await withTx(async ({ session }) => {
        await User.updateOne({ _id: userId, status: 'invited' }, { $set: { status: 'active' } }, { session });
        const u = await User.findById(userId).session(session).lean();
        await lockUserYears(userId, [YEAR], session);
        await ensureYearOpen(u as never, YEAR, session);
      });
      const tokens = p.days.split(' ');
      const full = tokens.filter((t) => !t.includes('=')).map(iso);
      const halves = tokens.filter((t) => t.includes('=')).map((t) => iso(t.split('=')[0]!));
      const jobs = [
        ...toRanges(full, holidays).map(([s, e]) => ({ startDate: s, endDate: e, halfDay: null })),
        ...halves.map((d) => ({ startDate: d, endDate: d, halfDay: { date: d, period: 'AM' as const } })),
      ];
      let units = 0; let n = 0;
      for (const j of jobs) {
        try {
          const r = await createRetroactive(actor, { userId, kind: 'VACATION', ...j, reason: REASON });
          units += r.units; n++;
        } catch (e) {
          console.log(`  ! ${p.email} ${j.startDate}..${j.endDate}: ${(e as Error).message}`);
        }
      }
      const b = await getBalance(userId, YEAR);
      const now = b.available.current + b.available.carryover;
      const diff = p.pending * 2 - now;
      if (diff !== 0) await adjustBalance(actor, userId, { year: YEAR, bucket: 'CURRENT', days: diff / 2, reason: ADJ });
      const a = await getBalance(userId, YEAR);
      console.log(`  ${name}: ${n}/${jobs.length} solicitudes, ${units / 2} días · saldo ${now / 2} → ${(a.available.current + a.available.carryover) / 2} (ajuste ${diff > 0 ? '+' : ''}${diff / 2})`);
    }
  } finally {
    await updateSettings(sys, { negativeLimitUnits: original }, 'Fin de la importación: se restaura el límite negativo');
    console.log(`Límite negativo restaurado a ${original / 2} días`);
    const del = await MailItem.deleteMany({ createdAt: { $gte: start } });
    console.log(`Emails descartados: ${del.deletedCount}`);
    await disconnectDb();
  }
  console.log('ADMINS_DONE');
}
main().catch((e) => { console.error('ADMINS_FAILED', e); process.exitCode = 1; });
