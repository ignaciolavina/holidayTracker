import { daysToUnits, formatUnitsWithLabel, yearOf, type BalanceRow, type Bucket, type LedgerEntryDto } from '@ht/shared';
import { LedgerEntry, User } from '../../models';
import { withTx } from '../../db/tx';
import { clock } from '../../lib/clock';
import { notFound, unprocessable } from '../../lib/errors';
import type { Actor } from '../actor';
import { audit } from '../audit';
import { notify } from '../notifications';
import { assertAdmin, assertNotSelf } from '../antiCheat/policies';
import { closedYears, insertLedger, lockUserYears } from './ledger';
import { ensureYearOpen } from './entitlement';
import { getBalance } from './state';

/** Ajustes manuales (SPEC-07 / SPEC-11 regla 4) y listados de saldo. */

export async function adjustBalance(
  actor: Actor,
  userId: string,
  input: { year: number; bucket: Bucket; days: number; reason: string },
) {
  assertAdmin(actor);
  assertNotSelf(actor, userId, 'ajustar el saldo');
  const units = daysToUnits(input.days);
  const before = await getBalance(userId, input.year);
  await withTx(async (ctx) => {
    const { session } = ctx;
    const user = await User.findById(userId).session(session).lean();
    if (!user) throw notFound('Usuario no encontrado.');
    await lockUserYears(userId, [input.year], session);
    if ((await closedYears(userId, [input.year], session)).size) {
      throw unprocessable('YEAR_CLOSED', `El año ${input.year} está cerrado: haz el ajuste en el año abierto.`);
    }
    if (input.year > yearOf(clock.today()) + 1) throw unprocessable('YEAR_TOO_FAR', 'Ese año todavía no está abierto.');
    await ensureYearOpen(user, input.year, session);
    const auditId = await audit.log(
      actor,
      'BALANCE_ADJUSTED',
      { type: 'user', id: userId },
      { year: input.year, bucket: input.bucket, available: before.available },
      { year: input.year, bucket: input.bucket, units },
      input.reason,
      session,
    );
    await insertLedger(
      [
        {
          userId,
          year: input.year,
          bucket: input.bucket,
          type: 'ADJUSTMENT',
          units,
          reason: input.reason,
          createdBy: actor.id,
          idempotencyKey: `adjust:${auditId}`,
        },
      ],
      session,
    );
    await notify(
      [userId],
      {
        type: 'BALANCE_ADJUSTED',
        title: 'Se ha ajustado tu saldo',
        body: `${units > 0 ? '+' : '−'}${formatUnitsWithLabel(Math.abs(units))} en ${input.year}. Motivo: ${input.reason}`,
        link: '/',
      },
      { session, after: ctx.after },
    );
  });
  return { before, after: await getBalance(userId, input.year) };
}

export async function listBalances(year: number): Promise<BalanceRow[]> {
  const users = await User.find({ status: { $ne: 'invited' } }).sort({ name: 1 }).lean();
  const rows: BalanceRow[] = [];
  for (const u of users) {
    const b = await getBalance(String(u._id), year);
    rows.push({ ...b, userName: u.name, status: u.status });
  }
  return rows;
}

export function balancesCsv(rows: BalanceRow[]): string {
  const d = (u: number) => String(u / 2).replace('.', ',');
  const header = ['Usuario', 'Estado', 'Año', 'Actual', 'Arrastrados', 'Cumpleaños', 'Reservado', 'Disponible total', 'Disfrutados', 'Pendientes'];
  const lines = rows.map((r) =>
    [
      r.userName,
      r.status,
      r.year,
      d(r.ledger.current),
      d(r.ledger.carryover),
      d(r.ledger.birthday),
      d(r.reserved.current + r.reserved.carryover + r.reserved.birthday),
      d(r.available.total),
      d(r.enjoyedUnits),
      d(r.pendingUnits),
    ]
      .map(csvCell)
      .join(';'),
  );
  return '﻿' + [header.join(';'), ...lines].join('\n');
}

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // evita inyección de fórmulas en hojas de cálculo
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function listLedger(userId: string, year?: number): Promise<LedgerEntryDto[]> {
  const docs = await LedgerEntry.find({ userId, ...(year ? { year } : {}) }).sort({ createdAt: 1, _id: 1 }).lean();
  return docs.map((e) => ({
    id: String(e._id),
    year: e.year,
    bucket: e.bucket,
    type: e.type,
    units: e.units,
    requestId: e.requestId ? String(e.requestId) : null,
    reason: e.reason ?? null,
    createdBy: e.createdBy ? String(e.createdBy) : null,
    createdAt: (e.createdAt as Date).toISOString(),
  }));
}
