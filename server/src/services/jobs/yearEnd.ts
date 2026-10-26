import {
  diffDays,
  endOfYear,
  formatDateEs,
  formatUnitsWithLabel,
  lastDayOfFebruary,
  startOfYear,
  yearOf,
  type AllocatedDay,
} from '@ht/shared';
import { LedgerEntry, User, UserYear, VacationRequest } from '../../models';
import { withTx } from '../../db/tx';
import { clock } from '../../lib/clock';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { insertLedger, ledgerSums, lockUserYears } from '../balance/ledger';
import { activeInYear, ensureYearOpen } from '../balance/entitlement';
import { allocationOf, type StoredRequest } from '../balance/state';

/**
 * Cierre de año, caducidad de arrastrados y avisos (SPEC-07 / SPEC-14). Todo idempotente por `idempotencyKey`
 * y por el flag `userYears.closed`.
 */

export interface YearCloseResult {
  year: number;
  users: number;
  closed: number;
  skipped: number;
  carriedUnits: number;
  negativeUnits: number;
  reallocatedUnits: number;
}

export async function closeYear(year: number): Promise<YearCloseResult> {
  const settings = await getSettings();
  const next = year + 1;
  const users = await User.find({ status: { $ne: 'invited' }, hireDate: { $lte: endOfYear(year) } }).lean();
  const result: YearCloseResult = { year, users: users.length, closed: 0, skipped: 0, carriedUnits: 0, negativeUnits: 0, reallocatedUnits: 0 };

  for (const u of users) {
    const userId = String(u._id);
    const r = await withTx(async (ctx) => {
      const { session } = ctx;
      await lockUserYears(userId, [year, next], session);
      const uy = await UserYear.findOne({ userId, year }).session(session).lean();
      if (uy?.closed) return null;
      if (!activeInYear(u, year)) {
        await UserYear.updateOne({ userId, year }, { $set: { closed: true, closedAt: clock.now() } }, { session });
        return { carried: 0, negative: 0, realloc: 0, birthdayExpired: 0 };
      }
      // el año N tiene que estar abierto para poder cerrarlo con sus asignaciones
      await ensureYearOpen(u, year, session);
      const sums = (await ledgerSums(userId, [year], session)).get(year)!;
      const leftInYear = !!u.leaveDate && u.leaveDate <= endOfYear(year);

      // 1) cumpleaños no disfrutado de N caduca el 31-12
      let birthdayExpired = 0;
      if (sums.BIRTHDAY > 0) {
        birthdayExpired = sums.BIRTHDAY;
        await insertLedger(
          [{ userId, year, bucket: 'BIRTHDAY', type: 'BIRTHDAY_EXPIRY', units: -sums.BIRTHDAY, reason: `El día de cumpleaños de ${year} no se ha usado`, idempotencyKey: `birthday-expiry:${userId}:${year}` }],
          session,
        );
      }

      // 2) apertura de N+1 y arrastre / deuda
      let carried = 0;
      let negative = 0;
      if (!leftInYear) {
        await ensureYearOpen(u, next, session);
        const balance = sums.CURRENT;
        if (balance > 0) {
          carried = settings.carryoverCapUnits > 0 ? Math.min(balance, settings.carryoverCapUnits) : balance;
          await insertLedger(
            [{ userId, year: next, bucket: 'CARRYOVER', type: 'CARRYOVER_IN', units: carried, reason: `Días arrastrados de ${year}`, idempotencyKey: `carryover-in:${userId}:${next}` }],
            session,
          );
        } else if (balance < 0) {
          negative = balance;
          await insertLedger(
            [{ userId, year: next, bucket: 'CURRENT', type: 'NEGATIVE_CARRYOVER', units: balance, reason: `Saldo negativo de ${year}`, idempotencyKey: `negative-carryover:${userId}:${next}` }],
            session,
          );
        }
      }

      // 3) reasignación: días de enero-febrero de N+1 ya aprobados y cargados a CURRENT pasan a CARRYOVER
      let realloc = 0;
      if (carried > 0) {
        const expiresOn = lastDayOfFebruary(next);
        let available = carried;
        const reqs = (await VacationRequest.find({
          userId,
          kind: 'VACATION',
          status: 'APPROVED',
          startDate: { $lte: expiresOn },
          endDate: { $gte: startOfYear(next) },
        })
          .sort({ startDate: 1 })
          .session(session)
          .lean()) as unknown as StoredRequest[];
        for (const req of reqs) {
          if (available <= 0) break;
          const alloc = allocationOf(req);
          const nextAlloc: AllocatedDay[] = [];
          let moved = 0;
          for (const a of alloc) {
            if (available > 0 && a.year === next && a.bucket === 'CURRENT' && a.date <= expiresOn) {
              const m = Math.min(a.units, available);
              available -= m;
              moved += m;
              nextAlloc.push({ ...a, bucket: 'CARRYOVER', units: m });
              if (a.units - m > 0) nextAlloc.push({ ...a, units: a.units - m });
            } else nextAlloc.push(a);
          }
          if (!moved) continue;
          const id = String(req._id);
          await insertLedger(
            [
              { userId, year: next, bucket: 'CURRENT', type: 'REALLOCATION', units: moved, requestId: id, reason: 'Reasignación a días arrastrados', idempotencyKey: `realloc:${id}:${next}:CURRENT` },
              { userId, year: next, bucket: 'CARRYOVER', type: 'REALLOCATION', units: -moved, requestId: id, reason: 'Reasignación a días arrastrados', idempotencyKey: `realloc:${id}:${next}:CARRYOVER` },
            ],
            session,
          );
          await VacationRequest.updateOne({ _id: id }, { $set: { 'breakdown.allocation': nextAlloc } }, { session });
          realloc += moved;
        }
      }

      // 4) cerrar N
      await UserYear.updateOne({ userId, year }, { $set: { closed: true, closedAt: clock.now() } }, { session });
      await UserYear.updateOne({ userId, year: next }, { $set: { carryoverExpiresOn: lastDayOfFebruary(next) } }, { session });

      // 5) resumen por email con el aviso de caducidad
      if (u.status === 'active' && !leftInYear) {
        const remaining = carried - realloc;
        const paragraphs = [
          `Hemos cerrado ${year}. Te quedaban ${formatUnitsWithLabel(sums.CURRENT)} del año.`,
          carried > 0
            ? `Tienes ${formatUnitsWithLabel(carried)} de ${year} que caducan el ${formatDateEs(lastDayOfFebruary(next))}. Si no los disfrutas antes de esa fecha, se perderán.`
            : negative < 0
              ? `Terminaste el año con saldo negativo: se descuentan ${formatUnitsWithLabel(-negative)} de ${next}.`
              : `No arrastras días a ${next}.`,
          ...(realloc > 0 ? [`Ya tienes ${formatUnitsWithLabel(realloc)} aprobados en enero y febrero que se descuentan de los arrastrados. Te quedan ${formatUnitsWithLabel(remaining)} por planificar antes de la caducidad.`] : []),
          ...(birthdayExpired > 0 ? [`Tu día de cumpleaños de ${year} no se usó y ha caducado.`] : []),
        ];
        await notify(
          [userId],
          {
            type: 'YEAR_CLOSED',
            title: `Cierre de ${year}`,
            body: paragraphs[1]!,
            link: '/',
            inApp: carried > 0,
            dedupeKey: `year-close:${year}`,
            email: { subject: `Resumen de tus vacaciones de ${year}`, paragraphs, cta: { label: `Planificar ${next}`, path: '/calendar' } },
          },
          { session, after: ctx.after },
        );
      }
      return { carried, negative, realloc, birthdayExpired };
    });
    if (!r) {
      result.skipped++;
      continue;
    }
    result.closed++;
    result.carriedUnits += r.carried;
    result.negativeUnits += r.negative;
    result.reallocatedUnits += r.realloc;
  }
  return result;
}

/** 1 de marzo: el saldo restante de CARRYOVER caduca. */
export async function expireCarryover(year: number): Promise<{ year: number; users: number; expiredUnits: number }> {
  const rows = await LedgerEntry.aggregate<{ _id: unknown; units: number }>([
    { $match: { year, bucket: 'CARRYOVER' } },
    { $group: { _id: '$userId', units: { $sum: '$units' } } },
    { $match: { units: { $gt: 0 } } },
  ]);
  let expired = 0;
  for (const r of rows) {
    const userId = String(r._id);
    await withTx(async ({ session }) => {
      await lockUserYears(userId, [year], session);
      const s = (await ledgerSums(userId, [year], session)).get(year)!;
      if (s.CARRYOVER <= 0) return;
      const ins = await insertLedger(
        [{ userId, year, bucket: 'CARRYOVER', type: 'CARRYOVER_EXPIRY', units: -s.CARRYOVER, reason: `Caducidad de los días arrastrados (${formatDateEs(lastDayOfFebruary(year))})`, idempotencyKey: `carryover-expiry:${userId}:${year}` }],
        session,
      );
      if (ins.length) expired += s.CARRYOVER;
    });
  }
  return { year, users: rows.length, expiredUnits: expired };
}

/** Avisos a 30 y 7 días de la caducidad de los arrastrados. */
export async function carryoverReminders(): Promise<{ sent: number }> {
  const today = clock.today();
  const year = yearOf(today);
  const expiresOn = lastDayOfFebruary(year);
  const daysLeft = diffDays(today, expiresOn);
  if (daysLeft < 0 || daysLeft > 30) return { sent: 0 };
  const stage = daysLeft <= 7 ? 7 : 30;
  const rows = await LedgerEntry.aggregate<{ _id: unknown; units: number }>([
    { $match: { year, bucket: 'CARRYOVER' } },
    { $group: { _id: '$userId', units: { $sum: '$units' } } },
    { $match: { units: { $gt: 0 } } },
  ]);
  let sent = 0;
  for (const r of rows) {
    const userId = String(r._id);
    const msg = `Tienes ${formatUnitsWithLabel(r.units)} de ${year - 1} que caducan el ${formatDateEs(expiresOn)}. Si no los disfrutas antes de esa fecha, se perderán.`;
    await notify([userId], {
      type: 'CARRYOVER_EXPIRING',
      title: `Tus días arrastrados caducan en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`,
      body: msg,
      link: '/requests/new',
      dedupeKey: `carryover-reminder:${year}:${stage}`,
      email: { subject: `Te quedan ${daysLeft} días para usar tus días de ${year - 1}`, paragraphs: [msg, 'Recuerda: no basta con pedirlos, hay que disfrutarlos antes de esa fecha.'], cta: { label: 'Pedir vacaciones', path: '/requests/new' } },
    });
    sent++;
  }
  return { sent };
}
