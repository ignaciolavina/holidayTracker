import type { ClientSession } from 'mongoose';
import {
  EngineError,
  allocateDays,
  birthdayEligible,
  birthdayWindow,
  checkNegativeLimit,
  computeRequest,
  describeComputation,
  endOfYear,
  formatDateEs,
  formatUnits,
  formatUnitsWithLabel,
  splitByYear,
  startOfYear,
  totalsOf,
  validateBirthdayDate,
  yearOf,
  type AllocatedDay,
  type Computation,
  type ISODate,
  type PreviewMessage,
  type RequestPreview,
  type Settings,
  type VacationRequestDto,
  type HalfDayPeriod,
  type RequestKind,
} from '@ht/shared';
import { User, UserYear, VacationRequest, LedgerEntry } from '../models';
import { clock } from '../lib/clock';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { withTx, type TxCtx } from '../db/tx';
import type { Actor } from './actor';
import { audit } from './audit';
import { getSettings } from './settings';
import { holidaysFor } from './holidays/query';
import { insertLedger, ledgerSums, lockUserYears, type LedgerInput } from './balance/ledger';
import { ensureYearOpen, type EntitlementUser } from './balance/entitlement';
import {
  allocationOf,
  availableTotal,
  carryoverMapFrom,
  computeReserved,
  daysOf,
  projectedSums,
  type StoredRequest,
} from './balance/state';
import { canApprove, hasPossibleApprover, assertNotSelf, assertAdmin } from './antiCheat/policies';
import { escalationTargets, loadTree } from './tree';
import { notify } from './notifications';
import { approvalLinkPath } from './approvalLinks';
import { teamOverlap } from './calendar';

/**
 * Solicitudes y máquina de estados (SPEC-09), aprobaciones (SPEC-10) y anti-trampas (SPEC-11).
 * El servidor recalcula siempre: nunca confía en cantidades enviadas por el cliente.
 */

export interface RequestInput {
  kind: RequestKind;
  startDate: ISODate;
  endDate: ISODate;
  halfDay?: { date: ISODate; period: HalfDayPeriod } | null;
  comment?: string;
  replacesRequestId?: string;
}

type UserLean = EntitlementUser & {
  _id: { toString(): string };
  name: string;
  email: string;
  role: string;
  status: string;
  managerId?: { toString(): string } | null;
  holidayCalendarId: { toString(): string };
};

type ReqLean = StoredRequest & {
  halfDay?: { date?: string | null; period?: string | null } | null;
  comment?: string | null;
  approverId?: { toString(): string } | null;
  decidedBy?: { toString(): string } | null;
  decidedAt?: Date | null;
  rejectionReason?: string | null;
  cancelReason?: string | null;
  revokeReason?: string | null;
  urgentAt?: Date | null;
  escalatedAt?: Date | null;
  retroactive?: boolean;
  createdAt?: Date;
};

function err(code: string, message: string): PreviewMessage {
  return { code, message };
}

async function loadUser(userId: string, session?: ClientSession): Promise<UserLean> {
  const u = await User.findById(userId).session(session ?? null).lean();
  if (!u) throw notFound('Usuario no encontrado.');
  return u as unknown as UserLean;
}

async function loadRequest(id: string, session?: ClientSession): Promise<ReqLean> {
  const r = await VacationRequest.findById(id).session(session ?? null).lean();
  if (!r) throw notFound('Solicitud no encontrada.');
  return r as unknown as ReqLean;
}

/** Cómputo con los festivos del calendario del usuario. */
export async function computeFor(
  user: UserLean,
  input: Pick<RequestInput, 'startDate' | 'endDate' | 'halfDay'>,
  settings: Settings,
  session?: ClientSession,
): Promise<Computation> {
  const holidays = await holidaysFor(String(user.holidayCalendarId), input.startDate, input.endDate, session);
  return computeRequest({
    startDate: input.startDate,
    endDate: input.endDate,
    halfDay: input.halfDay ?? null,
    holidays,
    weekendDays: settings.weekendDays,
  });
}

function isComputableFactory(holidays: Awaited<ReturnType<typeof holidaysFor>>, settings: Settings) {
  return (date: ISODate) => {
    try {
      return computeRequest({ startDate: date, endDate: date, holidays, weekendDays: settings.weekendDays }).totalUnits > 0;
    } catch {
      return false;
    }
  };
}

interface Evaluation {
  computation: Computation | null;
  allocation: AllocatedDay[];
  errors: PreviewMessage[];
  warnings: PreviewMessage[];
  balanceByYear: RequestPreview['balanceByYear'];
}

/**
 * Evalúa una solicitud contra todas las reglas. Sin efectos: lo usan la previsualización y la creación
 * (esta última dentro de la transacción, tras bloquear los años del usuario).
 */
async function evaluate(
  user: UserLean,
  input: RequestInput,
  opts: { settings: Settings; retroactive: boolean; session?: ClientSession },
): Promise<Evaluation> {
  const { settings, session } = opts;
  const today = clock.today();
  const errors: PreviewMessage[] = [];
  const warnings: PreviewMessage[] = [];
  const userId = String(user._id);

  if (user.status !== 'active') errors.push(err('USER_NOT_ACTIVE', 'El usuario no está activo.'));

  let computation: Computation | null = null;
  try {
    computation = await computeFor(user, input, settings, session);
  } catch (e) {
    if (e instanceof EngineError) errors.push(err(e.code, e.message));
    else throw e;
  }
  if (!computation) return { computation, allocation: [], errors, warnings, balanceByYear: [] };

  // ── fechas ──
  if (!opts.retroactive && input.startDate < today) {
    errors.push(err('PAST_DATE', 'No puedes pedir días en el pasado. Si se te olvidó registrarlos, habla con un admin.'));
  }
  if (!opts.retroactive && input.startDate === today) {
    warnings.push(err('STARTS_TODAY', 'La solicitud empieza hoy: se marcará como urgente.'));
  }
  const maxDate = endOfYear(yearOf(today) + settings.futureYearsAllowed);
  if (input.endDate > maxDate) {
    errors.push(err('TOO_FAR', `Solo se pueden pedir días hasta el ${formatDateEs(maxDate)}.`));
  }
  if (input.startDate < user.hireDate) {
    errors.push(err('BEFORE_HIRE', 'La solicitud empieza antes de la fecha de alta.'));
  }
  if (user.leaveDate && input.endDate > user.leaveDate) {
    errors.push(err('AFTER_LEAVE', 'La solicitud termina después de la fecha de baja.'));
  }

  // ── solapes propios ──
  const replaced = input.replacesRequestId ? await loadRequest(input.replacesRequestId, session) : null;
  if (replaced) {
    if (String(replaced.userId) !== userId) throw forbidden('NOT_OWNER', 'Solo puedes modificar tus solicitudes.');
    if (!['PENDING', 'APPROVED'].includes(replaced.status)) {
      errors.push(err('REPLACE_INVALID_STATUS', 'Solo se puede modificar una solicitud pendiente o aprobada.'));
    }
    if (replaced.startDate <= today) {
      errors.push(err('REQUEST_STARTED', 'No puedes modificar una solicitud que ya ha empezado.'));
    }
    if (replaced.kind !== input.kind) errors.push(err('REPLACE_KIND', 'No se puede cambiar el tipo de la solicitud.'));
  }
  const others = (await VacationRequest.find({
    userId,
    status: { $in: ['PENDING', 'APPROVED'] },
    startDate: { $lte: input.endDate },
    endDate: { $gte: input.startDate },
    ...(replaced ? { _id: { $ne: replaced._id } } : {}),
  })
    .session(session ?? null)
    .lean()) as unknown as ReqLean[];
  const mine = new Map(computation.days.filter((d) => d.units > 0).map((d) => [d.date, d]));
  for (const o of others) {
    // una solicitud pendiente que sustituye a `replaced` también se ignora
    if (replaced && o.replacesRequestId && String(o.replacesRequestId) === String(replaced._id)) continue;
    for (const od of o.breakdown.days as Array<{ date: string; units: number; period?: string }>) {
      const nd = mine.get(od.date);
      if (!nd || od.units === 0) continue;
      const bothHalves = nd.units === 1 && od.units === 1 && nd.period && od.period && nd.period !== od.period;
      if (!bothHalves) {
        errors.push(
          err('OVERLAP', `Se solapa con otra solicitud tuya (${formatDateEs(o.startDate)} – ${formatDateEs(o.endDate)}).`),
        );
        break;
      }
    }
    if (errors.some((e) => e.code === 'OVERLAP')) break;
  }

  // ── años y saldo ──
  const parts = splitByYear(computation);
  const years = [...new Set([...parts.map((p) => p.year), ...(replaced ? daysOf(replaced).map((d) => yearOf(d.date)) : [])])];
  const closed = await UserYear.find({ userId, year: { $in: years }, closed: true }).session(session ?? null).lean();
  if (closed.length) {
    errors.push(err('YEAR_CLOSED', `El año ${closed.map((c) => c.year).join(', ')} está cerrado.`));
  }

  const sums = await projectedSums(user, years, session, settings);
  const { reserved } = await computeReserved(userId, sums, session, {
    excludeIds: replaced ? await pendingReplacementsOf(String(replaced._id), session) : [],
  });
  const reservedCarry = new Map([...reserved.entries()].map(([y, s]) => [y, s.CARRYOVER]));
  const alloc = allocateDays({ kind: input.kind, days: computation.days, carryover: carryoverMapFrom(sums, reservedCarry) });

  // el original que se sustituye devuelve sus días (si está aprobado)
  const credit = new Map<number, number>();
  if (replaced?.status === 'APPROVED') {
    for (const a of allocationOf(replaced)) {
      if (a.bucket !== 'BIRTHDAY') credit.set(a.year, (credit.get(a.year) ?? 0) + a.units);
    }
  }

  const balanceByYear: RequestPreview['balanceByYear'] = [];
  if (input.kind === 'VACATION') {
    for (const p of parts) {
      const before = availableTotal(sums.get(p.year), reserved.get(p.year)) + (credit.get(p.year) ?? 0);
      const check = checkNegativeLimit({
        availableUnits: before,
        requestUnits: p.units,
        negativeLimitUnits: settings.negativeLimitUnits,
      });
      balanceByYear.push({ year: p.year, availableBeforeUnits: before, availableAfterUnits: check.resultingUnits });
      if (!check.ok) {
        errors.push(
          err(
            'NEGATIVE_LIMIT',
            `No tienes saldo suficiente en ${p.year}: quedarías en ${formatUnits(check.resultingUnits)} días y el límite es −${formatUnits(settings.negativeLimitUnits)}.`,
          ),
        );
      } else if (check.negative) {
        warnings.push(
          err(
            'NEGATIVE_BALANCE',
            `Atención: tu saldo de ${p.year} quedará en negativo (${formatUnits(check.resultingUnits)} días). El límite es −${formatUnits(settings.negativeLimitUnits)}.`,
          ),
        );
      }
    }
    if (alloc.usesCurrentWhileCarryoverAvailable) {
      warnings.push(
        err(
          'CARRYOVER_NOT_USED',
          `Estos días se descontarán de ${yearOf(input.startDate)}, no de tus días arrastrados.`,
        ),
      );
    }
  } else {
    // ── cumpleaños (SPEC-08) ──
    if (!settings.birthdayEnabled) errors.push(err('BIRTHDAY_DISABLED', 'El día de cumpleaños no está activado.'));
    if (input.halfDay) errors.push(err('BIRTHDAY_NO_HALF_DAY', 'El día de cumpleaños no admite medio día.'));
    if (input.startDate !== input.endDate) errors.push(err('BIRTHDAY_ONE_DAY', 'El día de cumpleaños es un único día.'));
    const year = yearOf(input.startDate);
    if (!user.birthday) {
      errors.push(err('BIRTHDAY_UNSET', 'Primero tienes que indicar tu cumpleaños en tu perfil.'));
    } else if (!birthdayEligible(year, user.birthday, user.hireDate, user.leaveDate)) {
      errors.push(err('BIRTHDAY_NOT_ELIGIBLE', `En ${year} no te corresponde el día de cumpleaños.`));
    } else {
      const hols = await holidaysFor(String(user.holidayCalendarId), startOfYear(year), endOfYear(year), session);
      const isComputable = isComputableFactory(hols, settings);
      const w = birthdayWindow(year, user.birthday, settings.birthdayWindow, isComputable);
      const code = validateBirthdayDate(input.startDate, w, isComputable);
      if (code === 'BIRTHDAY_MUST_BE_EXACT') {
        errors.push(err(code, `Tu cumpleaños cae en día laborable: el día libre es el propio ${formatDateEs(w.birthday)}.`));
      } else if (code === 'BIRTHDAY_OUT_OF_WINDOW') {
        errors.push(err(code, `Puedes mover el día de cumpleaños entre el ${formatDateEs(w.from)} y el ${formatDateEs(w.to)}.`));
      } else if (code === 'BIRTHDAY_NOT_COMPUTABLE') {
        errors.push(err(code, 'El día de cumpleaños tiene que ser un día laborable.'));
      }
      // solo un día de cumpleaños por año, aunque cambie la fecha
      const existing = await VacationRequest.exists({
        userId,
        kind: 'BIRTHDAY',
        status: { $in: ['PENDING', 'APPROVED'] },
        startDate: { $gte: startOfYear(year), $lte: endOfYear(year) },
        ...(replaced ? { _id: { $ne: replaced._id } } : {}),
      }).session(session ?? null);
      const used = await VacationRequest.exists({
        userId,
        kind: 'BIRTHDAY',
        status: 'REVOKED',
        revokedFromDate: { $gt: startOfYear(year) },
        startDate: { $gte: startOfYear(year), $lte: endOfYear(year) },
      }).session(session ?? null);
      if (existing || used) errors.push(err('BIRTHDAY_ALREADY_USED', `Ya tienes pedido el día de cumpleaños de ${year}.`));
      const s = sums.get(year)!;
      const r = reserved.get(year);
      const avail = s.BIRTHDAY - (r?.BIRTHDAY ?? 0) + (replaced?.status === 'APPROVED' ? 2 : 0);
      if (!existing && avail < computation.totalUnits) {
        errors.push(err('BIRTHDAY_NO_BALANCE', `No tienes disponible el día de cumpleaños de ${year}.`));
      }
    }
  }

  return {
    computation,
    allocation: alloc.perDay,
    errors: dedupe(errors),
    warnings: dedupe(warnings),
    balanceByYear,
  };
}

function dedupe(list: PreviewMessage[]): PreviewMessage[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.code) ? false : (seen.add(m.code), true)));
}

async function pendingReplacementsOf(requestId: string, session?: ClientSession): Promise<string[]> {
  const docs = await VacationRequest.find({ replacesRequestId: requestId, status: 'PENDING' })
    .select('_id')
    .session(session ?? null)
    .lean();
  return docs.map((d) => String(d._id));
}

// ─────────────────────────── previsualización ───────────────────────────

export async function previewRequest(actor: Actor, input: RequestInput & { userId?: string }): Promise<RequestPreview> {
  const targetId = input.userId ?? actor.id!;
  const forOther = targetId !== actor.id;
  if (forOther) assertAdmin(actor);
  const settings = await getSettings();
  const user = await loadUser(targetId);
  const ev = await evaluate(user, input, { settings, retroactive: forOther });
  const overlap = ev.computation
    ? await teamOverlap(user, ev.computation.days.filter((d) => d.units > 0).map((d) => d.date))
    : [];
  const warnings = [...ev.warnings];
  const maxOut = overlap.reduce((m, o) => Math.max(m, o.count), 0);
  if (maxOut > 0) {
    warnings.push({
      code: 'TEAM_OVERLAP',
      message: `Ese día ya hay ${maxOut} ${maxOut === 1 ? 'persona' : 'personas'} fuera de tu equipo.`,
    });
  }
  if (forOther && ev.computation && input.startDate < clock.today()) {
    warnings.push({
      code: 'RETROACTIVE',
      message: 'Es un registro retroactivo: quedará en la auditoría con el motivo.',
    });
  }
  return {
    computation: ev.computation ? { ...ev.computation, summary: describeComputation(ev.computation) } : null,
    allocation: totalsOf(ev.allocation),
    balanceByYear: ev.balanceByYear,
    negativeLimitUnits: settings.negativeLimitUnits,
    warnings,
    errors: ev.errors,
    teamOverlap: overlap,
  };
}

function throwFirst(ev: Evaluation): void {
  if (ev.errors.length) {
    const first = ev.errors[0]!;
    throw unprocessable(first.code, first.message, { errors: ev.errors });
  }
}

// ─────────────────────────── crear ───────────────────────────

export async function createRequest(actor: Actor, input: RequestInput): Promise<VacationRequestDto> {
  if (!actor.id) throw forbidden('NO_ACTOR', 'Acción no permitida.');
  const userId = actor.id;
  const settings = await getSettings();
  const id = await withTx(async (ctx) => {
    const { session } = ctx;
    const user = await loadUser(userId, session);
    const years = yearsOfRange(input.startDate, input.endDate);
    await lockUserYears(userId, years, session);
    const today = clock.today();
    for (const y of years) if (y >= yearOf(today)) await ensureYearOpen(user, y, session);
    const ev = await evaluate(user, input, { settings, retroactive: false, session });
    throwFirst(ev);
    const [doc] = await VacationRequest.create(
      [
        {
          userId,
          kind: input.kind,
          startDate: input.startDate,
          endDate: input.endDate,
          halfDay: input.halfDay ?? null,
          status: 'PENDING',
          units: ev.computation!.totalUnits,
          breakdown: { days: ev.computation!.days, allocation: ev.allocation },
          comment: input.comment?.trim() || null,
          approverId: user.managerId ?? null,
          replacesRequestId: input.replacesRequestId ?? null,
          urgentAt: input.startDate <= today ? clock.now() : null,
          createdBy: userId,
        },
      ],
      { session },
    );
    const reqId = String(doc!._id);
    await audit.log(actor, 'REQUEST_CREATED', { type: 'request', id: reqId }, null, summaryOf(doc!.toObject() as unknown as ReqLean), null, session);

    // ¿hay alguien que pueda aprobar? Si no (único admin), se autoaprueba (SPEC-10)
    const tree = await loadTree(session);
    if (!hasPossibleApprover(userId, tree, settings.approvalPolicy)) {
      await approveInTx(ctx, { ...actor, id: null, role: 'system', name: 'Sistema' }, reqId, { auto: true });
      return reqId;
    }

    await notifyNewRequest(ctx, user, doc!.toObject() as unknown as ReqLean, tree);
    return reqId;
  });
  return getRequestDto(actor, id);
}

function yearsOfRange(start: ISODate, end: ISODate): number[] {
  const out: number[] = [];
  for (let y = yearOf(start); y <= yearOf(end); y++) out.push(y);
  return out;
}

function summaryOf(r: ReqLean) {
  return {
    kind: r.kind,
    startDate: r.startDate,
    endDate: r.endDate,
    halfDay: r.halfDay ?? null,
    status: r.status,
    units: r.units,
    replacesRequestId: r.replacesRequestId ? String(r.replacesRequestId) : null,
    revokedFromDate: r.revokedFromDate ?? null,
  };
}

function rangeText(r: { startDate: string; endDate: string }): string {
  return r.startDate === r.endDate
    ? `el ${formatDateEs(r.startDate)}`
    : `del ${formatDateEs(r.startDate)} al ${formatDateEs(r.endDate)}`;
}

function kindText(kind: string): string {
  return kind === 'BIRTHDAY' ? 'día de cumpleaños' : 'vacaciones';
}

async function notifyNewRequest(ctx: TxCtx, user: UserLean, req: ReqLean, tree: Awaited<ReturnType<typeof loadTree>>) {
  const reqId = String(req._id);
  const managerId = user.managerId ? String(user.managerId) : null;
  const recipients = managerId ? [managerId] : escalationTargets(String(user._id), tree);
  const title = `${user.name} ha pedido ${kindText(req.kind)}`;
  const body = `${rangeText(req)} · ${formatUnitsWithLabel(req.units)}`;
  for (const to of recipients) {
    await notify(
      [to],
      {
        type: 'REQUEST_CREATED',
        title,
        body,
        link: `/approvals/${reqId}`,
        payload: { requestId: reqId },
        email: {
          subject: `Nueva solicitud de ${user.name}`,
          paragraphs: [`${user.name} ha pedido ${kindText(req.kind)} ${rangeText(req)} (${formatUnitsWithLabel(req.units)}).`, 'Puedes revisarla y aprobarla desde la app.'],
          cta: { label: 'Revisar solicitud', path: approvalLinkPath(reqId, to) },
          footnote: 'Por seguridad, la aprobación siempre se confirma dentro de la app.',
        },
      },
      { session: ctx.session, after: ctx.after },
    );
  }

  // escalado inmediato si el manager está de vacaciones hoy o la solicitud ya es urgente
  if (managerId) {
    const today = clock.today();
    const managerOut = await VacationRequest.exists({
      userId: managerId,
      status: 'APPROVED',
      startDate: { $lte: today },
      endDate: { $gte: today },
    }).session(ctx.session);
    if (managerOut || req.startDate <= today) {
      await escalateInTx(ctx, reqId, managerOut ? 'MANAGER_AWAY' : 'URGENT');
    }
  }
}

// ─────────────────────────── aprobar ───────────────────────────

export async function approveRequest(
  actor: Actor,
  id: string,
  opts: { acknowledgeStarted?: boolean } = {},
): Promise<VacationRequestDto> {
  await withTx((ctx) => approveInTx(ctx, actor, id, opts));
  return getRequestDto(actor, id);
}

async function approveInTx(
  ctx: TxCtx,
  actor: Actor,
  id: string,
  opts: { acknowledgeStarted?: boolean; auto?: boolean },
): Promise<void> {
  const { session } = ctx;
  const settings = await getSettings(session);
  const req = await loadRequest(id, session);
  const userId = String(req.userId);
  const today = clock.today();

  if (!opts.auto) {
    const tree = await loadTree(session);
    if (actor.id === userId) throw forbidden('SELF_APPROVAL', 'Nadie puede aprobar sus propias solicitudes.');
    if (!canApprove(actor, userId, tree, settings.approvalPolicy)) {
      throw forbidden('CANNOT_APPROVE', 'No puedes aprobar esta solicitud.');
    }
  }
  if (req.status !== 'PENDING') throw conflict('INVALID_STATUS', 'La solicitud ya no está pendiente.');
  if (!opts.auto && req.startDate <= today && !opts.acknowledgeStarted) {
    throw unprocessable(
      'STARTED_ACK_REQUIRED',
      'La solicitud ya ha empezado. Confirma que quieres aprobarla igualmente.',
    );
  }

  const user = await loadUser(userId, session);
  const replaced = req.replacesRequestId ? await loadRequest(String(req.replacesRequestId), session) : null;
  const years = [
    ...new Set([
      ...yearsOfRange(req.startDate, req.endDate),
      ...(replaced?.status === 'APPROVED' ? yearsOfRange(replaced.startDate, replaced.endDate) : []),
    ]),
  ];
  await lockUserYears(userId, years, session);
  for (const y of years) if (y >= yearOf(today)) await ensureYearOpen(user, y, session);

  // se recalcula con los festivos actuales
  let computation: Computation;
  try {
    computation = await computeFor(user, { startDate: req.startDate, endDate: req.endDate, halfDay: halfOf(req) }, settings, session);
  } catch (e) {
    if (e instanceof EngineError) throw unprocessable(e.code, e.message);
    throw e;
  }

  // 1) la original sustituida se cancela y devuelve sus días (si sigue aprobada)
  const ledger: LedgerInput[] = [];
  if (replaced?.status === 'APPROVED') {
    if (replaced.startDate <= today) {
      throw unprocessable('ORIGINAL_STARTED', 'La solicitud original ya ha empezado: no se puede sustituir.');
    }
    const upd = await VacationRequest.updateOne(
      { _id: replaced._id, status: 'APPROVED' },
      { $set: { status: 'CANCELLED', cancelReason: 'Sustituida por una modificación', decidedAt: clock.now() } },
      { session },
    );
    if (upd.modifiedCount !== 1) throw conflict('CONCURRENT_CHANGE', 'La solicitud original ha cambiado. Inténtalo de nuevo.');
    ledger.push(...(await refundEntries(replaced, null, 'cancel', actor, session)));
    await insertLedger(ledger.splice(0), session);
  }

  // 2) revalidación del saldo en el momento de aprobar (solo con lo ya aprobado)
  const sums = await ledgerSums(userId, years, session);
  const alloc = allocateDays({ kind: req.kind, days: computation.days, carryover: carryoverMapFrom(sums) });
  if (req.kind === 'VACATION') {
    for (const p of splitByYear(computation)) {
      const check = checkNegativeLimit({
        availableUnits: availableTotal(sums.get(p.year), undefined),
        requestUnits: p.units,
        negativeLimitUnits: settings.negativeLimitUnits,
      });
      if (!check.ok) {
        throw unprocessable(
          'NEGATIVE_LIMIT',
          `Ya no hay saldo suficiente en ${p.year}: quedaría en ${formatUnits(check.resultingUnits)} días y el límite es −${formatUnits(settings.negativeLimitUnits)}. Rechaza la solicitud o haz antes un ajuste.`,
        );
      }
    }
  } else {
    const y = yearOf(req.startDate);
    if ((sums.get(y)?.BIRTHDAY ?? 0) < computation.totalUnits) {
      throw unprocessable('BIRTHDAY_NO_BALANCE', `El día de cumpleaños de ${y} ya no está disponible.`);
    }
  }

  // 3) transición condicional y consumo
  const upd = await VacationRequest.updateOne(
    { _id: req._id, status: 'PENDING' },
    {
      $set: {
        status: 'APPROVED',
        decidedBy: actor.id,
        decidedAt: clock.now(),
        units: computation.totalUnits,
        breakdown: { days: computation.days, allocation: alloc.perDay },
      },
    },
    { session },
  );
  if (upd.modifiedCount !== 1) throw conflict('CONCURRENT_CHANGE', 'La solicitud ya ha sido decidida por otra persona.');
  await insertLedger(
    alloc.totals.map((t) => ({
      userId,
      year: t.year,
      bucket: t.bucket,
      type: 'CONSUMPTION' as const,
      units: -t.units,
      requestId: id,
      createdBy: actor.id,
      reason: `${kindText(req.kind)} ${rangeText(req)}`,
      idempotencyKey: `consume:${id}:${t.year}:${t.bucket}`,
    })),
    session,
  );

  const after = { ...summaryOf(req), status: 'APPROVED', units: computation.totalUnits };
  if (opts.auto) {
    await audit.log(
      { id: null, role: 'system', name: 'Sistema' },
      'REQUEST_AUTO_APPROVED_NO_APPROVER',
      { type: 'request', id },
      summaryOf(req),
      after,
      'No hay ningún otro admin que pueda aprobarla',
      session,
    );
  } else {
    await audit.log(actor, 'REQUEST_APPROVED', { type: 'request', id }, summaryOf(req), after, null, session);
  }
  await notify(
    [userId],
    {
      type: 'REQUEST_APPROVED',
      title: `Tus ${kindText(req.kind)} están aprobadas`,
      body: `${rangeText(req)} · ${formatUnitsWithLabel(computation.totalUnits)}`,
      link: `/requests/${id}`,
      payload: { requestId: id },
      email: {
        subject: `Solicitud aprobada: ${rangeText(req)}`,
        paragraphs: [
          `¡Buenas noticias! Tu solicitud de ${kindText(req.kind)} ${rangeText(req)} está aprobada (${formatUnitsWithLabel(computation.totalUnits)}).`,
          opts.auto ? 'Se ha aprobado automáticamente porque no hay otro admin que pueda aprobarla.' : '¡Que lo disfrutes!',
        ],
        cta: { label: 'Ver mis vacaciones', path: '/' },
      },
    },
    { session, after: ctx.after },
  );
}

function halfOf(r: ReqLean): RequestInput['halfDay'] {
  return r.halfDay?.date && r.halfDay.period ? { date: r.halfDay.date, period: r.halfDay.period as HalfDayPeriod } : null;
}

/**
 * Movimientos de devolución de una solicitud aprobada (todas sus fechas o desde `fromDate`).
 * Años cerrados → se devuelve en el año abierto (CURRENT). Arrastrados ya caducados → CURRENT del mismo año.
 */
async function refundEntries(
  req: ReqLean,
  fromDate: ISODate | null,
  why: 'cancel' | 'revoke',
  actor: Actor,
  session: ClientSession,
): Promise<LedgerInput[]> {
  const userId = String(req.userId);
  const id = String(req._id);
  const days = allocationOf(req).filter((a) => !fromDate || a.date >= fromDate);
  const years = [...new Set(days.map((d) => d.year))];
  const closed = new Set(
    (await UserYear.find({ userId, year: { $in: years }, closed: true }).session(session).lean()).map((d) => d.year),
  );
  const expired = new Set(
    (
      await LedgerEntry.find({ userId, year: { $in: years }, type: 'CARRYOVER_EXPIRY' }).select('year').session(session).lean()
    ).map((d) => d.year),
  );
  const openYear = yearOf(clock.today());
  const mapped = days.map((d) => {
    if (closed.has(d.year)) return { ...d, year: openYear, bucket: d.bucket === 'BIRTHDAY' ? ('BIRTHDAY' as const) : ('CURRENT' as const) };
    if (d.bucket === 'CARRYOVER' && expired.has(d.year)) return { ...d, bucket: 'CURRENT' as const };
    return d;
  });
  return totalsOf(mapped)
    .filter((t) => !(t.bucket === 'BIRTHDAY' && closed.has(t.year)))
    .map((t) => ({
      userId,
      year: t.year,
      bucket: t.bucket,
      type: 'REFUND' as const,
      units: t.units,
      requestId: id,
      createdBy: actor.id,
      reason: why === 'cancel' ? 'Solicitud cancelada' : `Anulación${fromDate ? ` desde el ${formatDateEs(fromDate)}` : ''}`,
      idempotencyKey: `refund:${id}:${t.year}:${t.bucket}`,
    }));
}

// ─────────────────────────── rechazar ───────────────────────────

export async function rejectRequest(actor: Actor, id: string, reason: string): Promise<VacationRequestDto> {
  await withTx(async (ctx) => {
    const { session } = ctx;
    const settings = await getSettings(session);
    const req = await loadRequest(id, session);
    const userId = String(req.userId);
    if (actor.id === userId) throw forbidden('SELF_APPROVAL', 'Nadie puede decidir sobre sus propias solicitudes.');
    const tree = await loadTree(session);
    if (!canApprove(actor, userId, tree, settings.approvalPolicy)) {
      throw forbidden('CANNOT_APPROVE', 'No puedes rechazar esta solicitud.');
    }
    const upd = await VacationRequest.updateOne(
      { _id: id, status: 'PENDING' },
      { $set: { status: 'REJECTED', rejectionReason: reason, decidedBy: actor.id, decidedAt: clock.now() } },
      { session },
    );
    if (upd.modifiedCount !== 1) throw conflict('INVALID_STATUS', 'La solicitud ya no está pendiente.');
    await audit.log(actor, 'REQUEST_REJECTED', { type: 'request', id }, summaryOf(req), { ...summaryOf(req), status: 'REJECTED' }, reason, session);
    await notify(
      [userId],
      {
        type: 'REQUEST_REJECTED',
        title: `Tu solicitud de ${kindText(req.kind)} se ha rechazado`,
        body: `${rangeText(req)} · Motivo: ${reason}`,
        link: `/requests/${id}`,
        payload: { requestId: id },
        email: {
          subject: `Solicitud rechazada: ${rangeText(req)}`,
          paragraphs: [`Tu solicitud de ${kindText(req.kind)} ${rangeText(req)} no se ha aprobado.`, `Motivo: ${reason}`],
          cta: { label: 'Ver mis solicitudes', path: '/' },
        },
      },
      { session, after: ctx.after },
    );
  });
  return getRequestDto(actor, id);
}

// ─────────────────────────── cancelar (usuario) ───────────────────────────

export async function cancelRequest(actor: Actor, id: string, reason?: string): Promise<VacationRequestDto> {
  await withTx(async (ctx) => {
    const { session } = ctx;
    const req = await loadRequest(id, session);
    const userId = String(req.userId);
    if (actor.id !== userId) {
      throw forbidden('NOT_OWNER', 'Solo quien hizo la solicitud puede cancelarla. Un admin puede anularla.');
    }
    if (!['PENDING', 'APPROVED'].includes(req.status)) throw conflict('INVALID_STATUS', 'La solicitud no se puede cancelar.');
    // SPEC-11 regla 1: nada que ya haya empezado
    if (req.startDate <= clock.today()) {
      throw forbidden('REQUEST_STARTED', 'No puedes cancelar una solicitud que ya ha empezado. Habla con un admin.');
    }
    await lockUserYears(userId, yearsOfRange(req.startDate, req.endDate), session);
    const upd = await VacationRequest.updateOne(
      { _id: id, status: req.status },
      { $set: { status: 'CANCELLED', cancelReason: reason?.trim() || null, decidedAt: clock.now() } },
      { session },
    );
    if (upd.modifiedCount !== 1) throw conflict('CONCURRENT_CHANGE', 'La solicitud ha cambiado. Recarga la página.');
    if (req.status === 'APPROVED') await insertLedger(await refundEntries(req, null, 'cancel', actor, session), session);
    await audit.log(actor, 'REQUEST_CANCELLED', { type: 'request', id }, summaryOf(req), { ...summaryOf(req), status: 'CANCELLED' }, reason ?? null, session);
    // si era una aprobada, su manager se entera
    if (req.status === 'APPROVED' && req.approverId) {
      const user = await loadUser(userId, session);
      await notify(
        [String(req.approverId)],
        {
          type: 'REQUEST_CANCELLED',
          title: `${user.name} ha cancelado ${kindText(req.kind)}`,
          body: rangeText(req),
          link: `/team`,
          inApp: true,
        },
        { session, after: ctx.after },
      );
    }
  });
  return getRequestDto(actor, id);
}

// ─────────────────────────── anular (admin) ───────────────────────────

export async function revokePreview(
  actor: Actor,
  id: string,
  fromDate?: ISODate,
): Promise<{ refundUnits: number; enjoyedUnits: number; touchesEnjoyed: boolean; message: string }> {
  assertAdmin(actor);
  const req = await loadRequest(id);
  assertNotSelf(actor, String(req.userId), 'anular solicitudes');
  if (req.status !== 'APPROVED') throw conflict('INVALID_STATUS', 'Solo se pueden anular solicitudes aprobadas.');
  const from = fromDate ?? req.startDate;
  validateRevokeFrom(req, from);
  const today = clock.today();
  const days = allocationOf(req).filter((a) => a.date >= from);
  const refundUnits = days.reduce((s, d) => s + d.units, 0);
  const enjoyedUnits = days.filter((d) => d.date <= today).reduce((s, d) => s + d.units, 0);
  const user = await loadUser(String(req.userId));
  return {
    refundUnits,
    enjoyedUnits,
    touchesEnjoyed: enjoyedUnits > 0,
    message:
      enjoyedUnits > 0
        ? `Esta solicitud ya se ha disfrutado total o parcialmente. Anularla devolverá ${formatUnitsWithLabel(refundUnits)} al saldo de ${user.name}.`
        : `Anularla devolverá ${formatUnitsWithLabel(refundUnits)} al saldo de ${user.name}.`,
  };
}

function validateRevokeFrom(req: ReqLean, from: ISODate) {
  if (from < req.startDate || from > req.endDate) {
    throw unprocessable('REVOKE_FROM_OUT_OF_RANGE', 'La fecha de anulación tiene que estar dentro de la solicitud.');
  }
}

export async function revokeRequest(
  actor: Actor,
  id: string,
  input: { fromDate?: ISODate; reason: string },
): Promise<VacationRequestDto> {
  assertAdmin(actor);
  await withTx(async (ctx) => {
    const { session } = ctx;
    const req = await loadRequest(id, session);
    const userId = String(req.userId);
    assertNotSelf(actor, userId, 'anular solicitudes');
    if (req.status !== 'APPROVED') throw conflict('INVALID_STATUS', 'Solo se pueden anular solicitudes aprobadas.');
    const from = input.fromDate ?? req.startDate;
    validateRevokeFrom(req, from);
    await lockUserYears(userId, [...yearsOfRange(req.startDate, req.endDate), yearOf(clock.today())], session);
    const upd = await VacationRequest.updateOne(
      { _id: id, status: 'APPROVED' },
      { $set: { status: 'REVOKED', revokedFromDate: from, revokeReason: input.reason, decidedBy: actor.id, decidedAt: clock.now() } },
      { session },
    );
    if (upd.modifiedCount !== 1) throw conflict('CONCURRENT_CHANGE', 'La solicitud ha cambiado. Recarga la página.');
    const entries = await refundEntries(req, from, 'revoke', actor, session);
    await insertLedger(entries, session);
    const refund = entries.reduce((s, e) => s + e.units, 0);
    await audit.log(
      actor,
      'REQUEST_REVOKED',
      { type: 'request', id },
      summaryOf(req),
      { ...summaryOf(req), status: 'REVOKED', revokedFromDate: from, refundUnits: refund, startedAtRevoke: req.startDate <= clock.today() },
      input.reason,
      session,
    );
    const user = await loadUser(userId, session);
    const recipients = [userId, ...(user.managerId && String(user.managerId) !== actor.id ? [String(user.managerId)] : [])];
    await notify(
      recipients,
      {
        type: 'REQUEST_REVOKED',
        title: `Se ha anulado una solicitud de ${user.name}`,
        body: `${rangeText(req)}${from !== req.startDate ? ` (desde el ${formatDateEs(from)})` : ''} · Se devuelven ${formatUnitsWithLabel(refund)}. Motivo: ${input.reason}`,
        link: `/requests/${id}`,
        payload: { requestId: id },
        email: {
          subject: `Solicitud anulada: ${rangeText(req)}`,
          paragraphs: [
            `Un admin ha anulado la solicitud de ${kindText(req.kind)} de ${user.name} ${rangeText(req)}${from !== req.startDate ? `, desde el ${formatDateEs(from)}` : ''}.`,
            `Se devuelven ${formatUnitsWithLabel(refund)} al saldo.`,
            `Motivo: ${input.reason}`,
          ],
          cta: { label: 'Ver en la app', path: '/' },
        },
      },
      { session, after: ctx.after },
    );
  });
  return getRequestDto(actor, id);
}

// ─────────────────────────── registro retroactivo (admin) ───────────────────────────

export async function createRetroactive(
  actor: Actor,
  input: RequestInput & { userId: string; reason: string },
): Promise<VacationRequestDto> {
  assertAdmin(actor);
  assertNotSelf(actor, input.userId, 'registrar días retroactivos');
  const settings = await getSettings();
  const id = await withTx(async (ctx) => {
    const { session } = ctx;
    const user = await loadUser(input.userId, session);
    const years = yearsOfRange(input.startDate, input.endDate);
    await lockUserYears(input.userId, years, session);
    for (const y of years) await ensureYearOpen(user, y, session);
    const ev = await evaluate(user, { ...input, replacesRequestId: undefined }, { settings, retroactive: true, session });
    throwFirst(ev);
    const sums = await ledgerSums(input.userId, years, session);
    const alloc = allocateDays({ kind: input.kind, days: ev.computation!.days, carryover: carryoverMapFrom(sums) });
    const [doc] = await VacationRequest.create(
      [
        {
          userId: input.userId,
          kind: input.kind,
          startDate: input.startDate,
          endDate: input.endDate,
          halfDay: input.halfDay ?? null,
          status: 'APPROVED',
          units: ev.computation!.totalUnits,
          breakdown: { days: ev.computation!.days, allocation: alloc.perDay },
          comment: input.comment?.trim() || null,
          approverId: user.managerId ?? null,
          decidedBy: actor.id,
          decidedAt: clock.now(),
          retroactive: true,
          createdBy: actor.id,
        },
      ],
      { session },
    );
    const reqId = String(doc!._id);
    await insertLedger(
      alloc.totals.map((t) => ({
        userId: input.userId,
        year: t.year,
        bucket: t.bucket,
        type: 'CONSUMPTION' as const,
        units: -t.units,
        requestId: reqId,
        createdBy: actor.id,
        reason: `Registro retroactivo: ${input.reason}`,
        idempotencyKey: `consume:${reqId}:${t.year}:${t.bucket}`,
      })),
      session,
    );
    await audit.log(
      actor,
      'REQUEST_RETROACTIVE',
      { type: 'request', id: reqId },
      null,
      summaryOf(doc!.toObject() as unknown as ReqLean),
      input.reason,
      session,
    );
    await notify(
      [input.userId],
      {
        type: 'REQUEST_RETROACTIVE',
        title: 'Un admin ha registrado días a tu nombre',
        body: `${rangeText(input)} · ${formatUnitsWithLabel(ev.computation!.totalUnits)}. Motivo: ${input.reason}`,
        link: `/requests/${reqId}`,
        email: {
          subject: 'Registro de vacaciones a tu nombre',
          paragraphs: [
            `Un admin ha registrado ${kindText(input.kind)} ${rangeText(input)} (${formatUnitsWithLabel(ev.computation!.totalUnits)}) a tu nombre.`,
            `Motivo: ${input.reason}`,
          ],
          cta: { label: 'Ver mi saldo', path: '/' },
        },
      },
      { session, after: ctx.after },
    );
    return reqId;
  });
  return getRequestDto(actor, id);
}

// ─────────────────────────── escalado ───────────────────────────

export async function escalateInTx(ctx: TxCtx, id: string, why: 'OVERDUE' | 'MANAGER_AWAY' | 'URGENT'): Promise<boolean> {
  const { session } = ctx;
  const req = await loadRequest(id, session);
  if (req.status !== 'PENDING' || req.escalatedAt) return false;
  const upd = await VacationRequest.updateOne(
    { _id: id, status: 'PENDING', escalatedAt: null },
    { $set: { escalatedAt: clock.now(), ...(why === 'URGENT' && !req.urgentAt ? { urgentAt: clock.now() } : {}) } },
    { session },
  );
  if (upd.modifiedCount !== 1) return false;
  const tree = await loadTree(session);
  const user = await loadUser(String(req.userId), session);
  const targets = escalationTargets(String(req.userId), tree);
  const whyText =
    why === 'OVERDUE'
      ? 'lleva más tiempo del previsto pendiente'
      : why === 'MANAGER_AWAY'
        ? 'su aprobador asignado está de vacaciones'
        : 'empieza hoy o ya ha empezado';
  await audit.log({ id: null, role: 'system' }, 'REQUEST_ESCALATED', { type: 'request', id }, null, { why, targets }, null, session);
  for (const to of targets) {
    await notify(
      [to],
      {
        type: 'REQUEST_ESCALATED',
        title: `Solicitud escalada: ${user.name}`,
        body: `${rangeText(req)} · ${whyText}`,
        link: `/approvals/${id}`,
        payload: { requestId: id, why },
        dedupeKey: `escalated:${id}`,
        email: {
          subject: `Solicitud pendiente de ${user.name} (escalada)`,
          paragraphs: [
            `La solicitud de ${kindText(req.kind)} de ${user.name} ${rangeText(req)} ${whyText}.`,
            'Cualquier admin puede revisarla y decidir.',
          ],
          cta: { label: 'Revisar solicitud', path: approvalLinkPath(id, to) },
        },
      },
      { session, after: ctx.after },
    );
  }
  return true;
}

// ─────────────────────────── lectura ───────────────────────────

export async function toRequestDto(
  actor: Actor,
  r: ReqLean,
  ctx: { tree: Awaited<ReturnType<typeof loadTree>>; settings: Settings; names: Map<string, string> },
): Promise<VacationRequestDto> {
  const today = clock.today();
  const userId = String(r.userId);
  const owner = actor.id === userId;
  const notStarted = r.startDate > today;
  const approvable = r.status === 'PENDING' && canApprove(actor, userId, ctx.tree, ctx.settings.approvalPolicy);
  const isAdminOrOwner = owner || actor.role === 'admin';
  return {
    id: String(r._id),
    userId,
    userName: ctx.names.get(userId) ?? '',
    kind: r.kind,
    startDate: r.startDate,
    endDate: r.endDate,
    halfDay: halfOf(r) ?? null,
    status: r.status as VacationRequestDto['status'],
    units: r.units,
    days: (r.breakdown?.days ?? []) as VacationRequestDto['days'],
    allocation: isAdminOrOwner ? allocationOf(r) : [],
    comment: isAdminOrOwner ? (r.comment ?? null) : null,
    approverId: r.approverId ? String(r.approverId) : null,
    decidedBy: r.decidedBy ? String(r.decidedBy) : null,
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    rejectionReason: isAdminOrOwner ? (r.rejectionReason ?? null) : null,
    cancelReason: isAdminOrOwner ? (r.cancelReason ?? null) : null,
    replacesRequestId: r.replacesRequestId ? String(r.replacesRequestId) : null,
    revokedFromDate: r.revokedFromDate ?? null,
    urgent: r.status === 'PENDING' && r.startDate <= today,
    escalatedAt: r.escalatedAt ? new Date(r.escalatedAt).toISOString() : null,
    retroactive: !!r.retroactive,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
    can: {
      cancel: owner && ['PENDING', 'APPROVED'].includes(r.status) && notStarted,
      modify: owner && ['PENDING', 'APPROVED'].includes(r.status) && notStarted,
      approve: approvable,
      reject: approvable,
      revoke: actor.role === 'admin' && !owner && r.status === 'APPROVED',
    },
  };
}

export async function dtoContext() {
  const [tree, settings] = await Promise.all([loadTree(), getSettings()]);
  const names = new Map(
    (await User.find({}).select('name').lean()).map((u) => [String(u._id), u.name] as [string, string]),
  );
  return { tree, settings, names };
}

export async function getRequestDto(actor: Actor, id: string): Promise<VacationRequestDto> {
  const r = await loadRequest(id);
  if (actor.role !== 'admin' && String(r.userId) !== actor.id) throw notFound('Solicitud no encontrada.');
  return toRequestDto(actor, r, await dtoContext());
}

export async function listRequests(
  actor: Actor,
  q: { userId?: string; status?: string; year?: number },
): Promise<VacationRequestDto[]> {
  const userId = q.userId ?? actor.id!;
  if (userId !== actor.id && actor.role !== 'admin') throw forbidden('ADMIN_ONLY', 'Solo puedes ver tus solicitudes.');
  const filter: Record<string, unknown> = { userId };
  if (q.status) filter.status = q.status;
  if (q.year) {
    filter.startDate = { $lte: endOfYear(q.year) };
    filter.endDate = { $gte: startOfYear(q.year) };
  }
  const docs = (await VacationRequest.find(filter).sort({ startDate: -1 }).lean()) as unknown as ReqLean[];
  const ctx = await dtoContext();
  return Promise.all(docs.map((d) => toRequestDto(actor, d, ctx)));
}

/** Solicitudes pendientes visibles para un admin, separadas en "me tocan" y "otras". */
export async function pendingForAdmin(actor: Actor) {
  const docs = (await VacationRequest.find({ status: 'PENDING' }).sort({ startDate: 1 }).lean()) as unknown as ReqLean[];
  const ctx = await dtoContext();
  const dtos = await Promise.all(docs.map((d) => toRequestDto(actor, d, ctx)));
  return {
    toApprove: dtos.filter((d) => d.can.approve),
    otherPending: dtos.filter((d) => !d.can.approve),
    escalated: dtos.filter((d) => d.escalatedAt || d.urgent),
  };
}

