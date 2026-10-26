import type { ClientSession } from 'mongoose';
import {
  allocateDays,
  computeRequest,
  formatDateEs,
  formatUnitsWithLabel,
  totalsOf,
  yearOf,
  type AllocatedDay,
  type Computation,
  type EngineHoliday,
  type HolidayDto,
  type HolidayImpact,
  type HolidayImpactItem,
  type HolidayScope,
  type ISODate,
} from '@ht/shared';
import { Holiday, HolidayCalendar, User, VacationRequest } from '../../models';
import { withTx } from '../../db/tx';
import { clock } from '../../lib/clock';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { randomToken } from '../../lib/crypto';
import type { Actor } from '../actor';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { insertLedger, ledgerSums, lockUserYears } from '../balance/ledger';
import { allocationOf, carryoverMapFrom, type StoredRequest } from '../balance/state';
import { holidayDto, isYearClosedGlobally } from './dto';

/**
 * Cambios de festivos y su impacto sobre solicitudes (SPEC-05 CRUD + SPEC-11 punto 10, 🟣).
 * Crear, editar o borrar un festivo recalcula las solicitudes afectadas: las aprobadas generan
 * movimientos HOLIDAY_RECALC (±) y se notifica a los afectados.
 */

export interface HolidaySpec {
  date: ISODate;
  name: string;
  scope: HolidayScope;
  calendarIds: string[];
}

type Change =
  | { op: 'create'; after: HolidaySpec }
  | { op: 'update'; id: string; before: HolidaySpec; after: HolidaySpec }
  | { op: 'delete'; id: string; before: HolidaySpec };

interface ReqLean extends StoredRequest {
  halfDay?: { date?: string | null; period?: string | null } | null;
}

async function defaultCalendarIds(session?: ClientSession): Promise<string[]> {
  const def = await HolidayCalendar.findOne({ isDefault: true }).session(session ?? null).lean();
  if (def) return [String(def._id)];
  const any = await HolidayCalendar.findOne({}).session(session ?? null).lean();
  return any ? [String(any._id)] : [];
}

async function specOf(id: string, session?: ClientSession): Promise<HolidaySpec> {
  const h = await Holiday.findById(id).session(session ?? null).lean();
  if (!h) throw notFound('Festivo no encontrado.');
  return { date: h.date, name: h.name, scope: h.scope, calendarIds: h.calendarIds.map(String) };
}

async function assertYearEditable(year: number) {
  if (await isYearClosedGlobally(year)) {
    throw unprocessable('YEAR_LOCKED', `Los festivos de ${year} no se pueden editar: el año está cerrado.`);
  }
}

/** Recalcula el cómputo de una solicitud aplicando virtualmente el cambio de festivo. */
async function recompute(
  req: ReqLean,
  calendarId: string,
  change: Change,
  weekendDays: number[],
  session?: ClientSession,
): Promise<Computation> {
  const docs = await Holiday.find({ calendarIds: calendarId, date: { $gte: req.startDate, $lte: req.endDate } })
    .session(session ?? null)
    .lean();
  let hols: Array<EngineHoliday & { id?: string }> = docs.map((h) => ({ id: String(h._id), date: h.date, scope: h.scope }));
  if (change.op !== 'create') hols = hols.filter((h) => h.id !== change.id);
  if (change.op !== 'delete' && change.after.calendarIds.includes(calendarId)) {
    hols.push({ date: change.after.date, scope: change.after.scope });
  }
  const halfDay =
    req.halfDay?.date && req.halfDay.period ? { date: req.halfDay.date, period: req.halfDay.period as 'AM' | 'PM' } : null;
  return computeRequest({ startDate: req.startDate, endDate: req.endDate, halfDay, holidays: hols, weekendDays, lenient: true });
}

interface Affected {
  req: ReqLean;
  user: { _id: unknown; name: string; holidayCalendarId: unknown };
  next: Computation;
  item: HolidayImpactItem;
}

async function findAffected(change: Change, session?: ClientSession): Promise<Affected[]> {
  const settings = await getSettings(session);
  const specs = [change.op !== 'create' ? change.before : null, change.op !== 'delete' ? change.after : null].filter(
    (s): s is HolidaySpec => !!s,
  );
  const calendarIds = [...new Set(specs.flatMap((s) => s.calendarIds))];
  const dates = [...new Set(specs.map((s) => s.date))];
  const users = await User.find({ holidayCalendarId: { $in: calendarIds } })
    .select('name holidayCalendarId')
    .session(session ?? null)
    .lean();
  if (!users.length) return [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const reqs = (await VacationRequest.find({
    userId: { $in: users.map((u) => u._id) },
    status: { $in: ['PENDING', 'APPROVED'] },
    $or: dates.map((d) => ({ startDate: { $lte: d }, endDate: { $gte: d } })),
  })
    .session(session ?? null)
    .lean()) as unknown as ReqLean[];
  const today = clock.today();
  const out: Affected[] = [];
  for (const req of reqs) {
    const user = byId.get(String(req.userId))!;
    const next = await recompute(req, String(user.holidayCalendarId), change, settings.weekendDays, session);
    const delta = req.units - next.totalUnits;
    if (delta === 0) continue;
    const changedDates = next.days
      .filter((d) => (req.breakdown.days as Array<{ date: string; units: number }>).find((o) => o.date === d.date)?.units !== d.units)
      .map((d) => d.date);
    out.push({
      req,
      user,
      next,
      item: {
        requestId: String(req._id),
        userId: String(req.userId),
        userName: user.name,
        startDate: req.startDate,
        endDate: req.endDate,
        status: req.status as HolidayImpactItem['status'],
        deltaUnits: delta,
        touchesEnjoyed: req.status === 'APPROVED' && changedDates.some((d) => d <= today),
      },
    });
  }
  return out;
}

function toImpact(list: Affected[]): HolidayImpact {
  return {
    affected: list.map((a) => a.item),
    totalDeltaUnits: list.reduce((s, a) => s + a.item.deltaUnits, 0),
    touchesEnjoyed: list.some((a) => a.item.touchesEnjoyed),
  };
}

/** Previsualización del impacto antes de confirmar. */
export async function holidayImpact(input: {
  op: 'create' | 'update' | 'delete';
  id?: string;
  date?: ISODate;
  scope?: HolidayScope;
  calendarIds?: string[];
  name?: string;
}): Promise<HolidayImpact> {
  return toImpact(await findAffected(await buildChange(input)));
}

async function buildChange(
  input: { op: 'create' | 'update' | 'delete'; id?: string; date?: ISODate; scope?: HolidayScope; calendarIds?: string[]; name?: string },
  session?: ClientSession,
): Promise<Change> {
  if (input.op === 'create') {
    if (!input.date || !input.scope) throw unprocessable('INVALID', 'Faltan la fecha y el ámbito del festivo.');
    return {
      op: 'create',
      after: {
        date: input.date,
        scope: input.scope,
        name: input.name ?? '',
        calendarIds: input.calendarIds?.length ? input.calendarIds : await defaultCalendarIds(session),
      },
    };
  }
  if (!input.id) throw unprocessable('INVALID', 'Falta el festivo.');
  const before = await specOf(input.id, session);
  if (input.op === 'delete') return { op: 'delete', id: input.id, before };
  return {
    op: 'update',
    id: input.id,
    before,
    after: {
      date: input.date ?? before.date,
      scope: input.scope ?? before.scope,
      name: input.name ?? before.name,
      calendarIds: input.calendarIds?.length ? input.calendarIds : before.calendarIds,
    },
  };
}

export interface MutationOpts {
  confirm?: boolean;
  confirmText?: string;
  reason?: string;
}

/**
 * Aplica un cambio de festivo. Si hay solicitudes afectadas exige `confirm`; si afecta a días ya
 * disfrutados exige además el texto `CONFIRMAR` y un motivo (aviso destacado de SPEC-11 punto 2).
 */
export async function mutateHoliday(
  actor: Actor,
  input: { op: 'create' | 'update' | 'delete'; id?: string; date?: ISODate; scope?: HolidayScope; calendarIds?: string[]; name?: string },
  opts: MutationOpts,
): Promise<{ holiday: HolidayDto | null; impact: HolidayImpact }> {
  const change = await buildChange(input);
  for (const s of [change.op !== 'create' ? change.before : null, change.op !== 'delete' ? change.after : null]) {
    if (s) await assertYearEditable(yearOf(s.date));
  }
  const preview = toImpact(await findAffected(change));
  if (preview.affected.length && !opts.confirm) {
    throw conflict('HOLIDAY_IMPACT_CONFIRM_REQUIRED', 'Este cambio afecta a solicitudes existentes. Revisa el impacto y confirma.');
  }
  if (preview.touchesEnjoyed && (opts.confirmText !== 'CONFIRMAR' || !opts.reason?.trim())) {
    throw unprocessable(
      'HOLIDAY_IMPACT_ENJOYED',
      'El cambio afecta a días ya disfrutados: escribe CONFIRMAR e indica un motivo.',
    );
  }

  const changeId = randomToken(9);
  return withTx(async (ctx) => {
    const { session } = ctx;
    // recalcular dentro de la transacción (fuente de verdad)
    const affected = await findAffected(change, session);
    const userIds = [...new Set(affected.map((a) => a.item.userId))];
    for (const uid of userIds) {
      const years = affected.filter((a) => a.item.userId === uid).flatMap((a) => [yearOf(a.req.startDate), yearOf(a.req.endDate)]);
      await lockUserYears(uid, years, session);
    }

    // 1) el cambio en sí
    let holidayId: string | null = null;
    if (change.op === 'create') {
      const [doc] = await Holiday.create(
        [{ ...change.after, year: yearOf(change.after.date), source: 'manual' }],
        { session },
      );
      holidayId = String(doc!._id);
      await audit.log(actor, 'HOLIDAY_CREATED', { type: 'holiday', id: holidayId }, null, change.after, opts.reason ?? null, session);
    } else if (change.op === 'update') {
      holidayId = change.id;
      await Holiday.updateOne(
        { _id: change.id },
        { $set: { ...change.after, year: yearOf(change.after.date) } },
        { session },
      );
      await audit.log(actor, 'HOLIDAY_UPDATED', { type: 'holiday', id: change.id }, change.before, change.after, opts.reason ?? null, session);
    } else {
      await Holiday.deleteOne({ _id: change.id }, { session });
      await audit.log(actor, 'HOLIDAY_DELETED', { type: 'holiday', id: change.id }, change.before, null, opts.reason ?? null, session);
    }

    // 2) recálculo de solicitudes
    for (const a of affected) {
      const id = String(a.req._id);
      const uid = a.item.userId;
      if (a.req.status === 'PENDING') {
        await VacationRequest.updateOne(
          { _id: id, status: 'PENDING' },
          { $set: { units: a.next.totalUnits, 'breakdown.days': a.next.days } },
          { session },
        );
        continue;
      }
      const oldAlloc = allocationOf(a.req);
      const oldDays = new Map((a.req.breakdown.days as Array<{ date: string; units: number }>).map((d) => [d.date, d.units]));
      const kept: AllocatedDay[] = [];
      const refunded: AllocatedDay[] = [];
      const toConsume: Array<{ date: string; units: number }> = [];
      for (const d of a.next.days) {
        const was = oldDays.get(d.date) ?? 0;
        const allocForDay = oldAlloc.filter((x) => x.date === d.date);
        if (d.units < was) {
          // el día pasa a festivo (o a medio día): se devuelve lo que sobra, empezando por CURRENT
          let toRefund = was - d.units;
          const sorted = [...allocForDay].sort((x, y) => (x.bucket === 'CURRENT' ? -1 : y.bucket === 'CURRENT' ? 1 : 0));
          for (const x of sorted) {
            const r = Math.min(x.units, toRefund);
            if (r > 0) refunded.push({ ...x, units: r });
            if (x.units - r > 0) kept.push({ ...x, units: x.units - r });
            toRefund -= r;
          }
        } else {
          kept.push(...allocForDay);
          if (d.units > was) toConsume.push({ date: d.date, units: d.units - was });
        }
      }
      const years = [...new Set(a.next.days.map((d) => yearOf(d.date)))];
      const sums = await ledgerSums(uid, years, session);
      for (const r of refunded) sums.get(r.year)![r.bucket] += r.units;
      const consumed = allocateDays({ kind: a.req.kind, days: toConsume, carryover: carryoverMapFrom(sums) }).perDay;
      const entries = [
        ...totalsOf(refunded).map((t) => ({ ...t, units: t.units })),
        ...totalsOf(consumed).map((t) => ({ ...t, units: -t.units })),
      ];
      const net = new Map<string, { year: number; bucket: AllocatedDay['bucket']; units: number }>();
      for (const e of entries) {
        const k = `${e.year}:${e.bucket}`;
        const cur = net.get(k) ?? { year: e.year, bucket: e.bucket, units: 0 };
        cur.units += e.units;
        net.set(k, cur);
      }
      await insertLedger(
        [...net.values()].map((e) => ({
          userId: uid,
          year: e.year,
          bucket: e.bucket,
          type: 'HOLIDAY_RECALC' as const,
          units: e.units,
          requestId: id,
          createdBy: actor.id,
          reason: `Cambio de festivo (${formatDateEs((change.op !== 'delete' ? change.after : change.before).date)})${opts.reason ? `: ${opts.reason}` : ''}`,
          idempotencyKey: `holiday-recalc:${id}:${changeId}:${e.year}:${e.bucket}`,
        })),
        session,
      );
      await VacationRequest.updateOne(
        { _id: id, status: 'APPROVED' },
        {
          $set: {
            units: a.next.totalUnits,
            'breakdown.days': a.next.days,
            'breakdown.allocation': mergeAlloc([...kept, ...consumed]),
          },
        },
        { session },
      );
    }

    if (affected.length) {
      await audit.log(
        actor,
        'HOLIDAY_RECALC_APPLIED',
        { type: 'holiday', id: holidayId },
        null,
        { change: change.op, affected: affected.map((a) => a.item), touchesEnjoyed: affected.some((a) => a.item.touchesEnjoyed) },
        opts.reason ?? null,
        session,
      );
      const spec = change.op !== 'delete' ? change.after : change.before;
      for (const a of affected) {
        const delta = a.item.deltaUnits;
        await notify(
          [a.item.userId],
          {
            type: 'HOLIDAY_CHANGED',
            title: 'Un cambio de festivo afecta a tu solicitud',
            body: `${formatDateEs(spec.date)} · ${delta > 0 ? `se te devuelven ${formatUnitsWithLabel(delta)}` : `se te descuentan ${formatUnitsWithLabel(-delta)}`}`,
            link: `/requests/${a.item.requestId}`,
            email: {
              subject: 'Cambio de festivo en tus vacaciones',
              paragraphs: [
                `Se ha ${change.op === 'create' ? 'añadido' : change.op === 'delete' ? 'eliminado' : 'modificado'} el festivo del ${formatDateEs(spec.date)}${spec.name ? ` (${spec.name})` : ''}, que cae dentro de tu solicitud del ${formatDateEs(a.item.startDate)} al ${formatDateEs(a.item.endDate)}.`,
                delta > 0
                  ? `Como ese día ya no computa, se te devuelven ${formatUnitsWithLabel(delta)}.`
                  : `Como ese día ahora sí computa, se te descuentan ${formatUnitsWithLabel(-delta)}.`,
              ],
              cta: { label: 'Ver mi saldo', path: '/' },
            },
          },
          { session, after: ctx.after },
        );
      }
    }

    const doc = holidayId ? await Holiday.findById(holidayId).session(session).lean() : null;
    return { holiday: doc ? await holidayDto(doc) : null, impact: toImpact(affected) };
  });
}

function mergeAlloc(list: AllocatedDay[]): AllocatedDay[] {
  const map = new Map<string, AllocatedDay>();
  for (const a of list) {
    const k = `${a.date}:${a.bucket}`;
    const cur = map.get(k);
    if (cur) cur.units += a.units;
    else map.set(k, { ...a });
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
