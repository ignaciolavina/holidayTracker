/** Ajuste único (28-10-2026): los becarios empiezan 2026 con 0 días. */
import { connectDb, disconnectDb } from '../db/connect';
import { MailItem, User } from '../models';
import { adjustBalance } from '../services/balance/admin';
import { getBalance } from '../services/balance/state';
import type { Actor } from '../services/actor';

const REASON = 'Becario/a: empieza 2026 con 0 días de vacaciones.';
const TARGET: Record<string, number> = {
  'marco.guevara@bemycar.pro': 0, 'cesar.galan@bemycar.pro': 0, 'ivan.serrano@bemycar.pro': 0, 'jaime.ruiz@bemycar.pro': 0,
};

async function main() {
  const start = new Date();
  await connectDb();
  try {
    const ig = (await User.findOne({ email: 'ignacio@bemycar.pro' }).lean())!;
    const actor: Actor = { id: String(ig._id), role: 'admin', name: ig.name };
    for (const [email, days] of Object.entries(TARGET)) {
      const u = (await User.findOne({ email }).lean())!;
      const b = await getBalance(String(u._id), 2026);
      const now = b.available.current + b.available.carryover;
      const diff = days * 2 - now;
      if (diff !== 0) await adjustBalance(actor, String(u._id), { year: 2026, bucket: 'CURRENT', days: diff / 2, reason: REASON });
      const a = await getBalance(String(u._id), 2026);
      console.log(`  ${email}: ${now / 2} → ${(a.available.current + a.available.carryover) / 2} (ajuste ${diff / 2 > 0 ? '+' : ''}${diff / 2})`);
    }
    const del = await MailItem.deleteMany({ createdAt: { $gte: start } });
    console.log(`Emails descartados: ${del.deletedCount}`);
    console.log('ADJUST_DONE');
  } finally {
    await disconnectDb();
  }
}
main().catch((e) => { console.error('ADJUST_FAILED', e); process.exitCode = 1; });
