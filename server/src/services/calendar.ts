import {
  addDays,
  daysInMonth,
  dayOfWeek,
  eachDay,
  endOfYear,
  formatDate,
  startOfYear,
  birthdayInYear,
  type CalendarAbsence,
  type HolidayScope,
  type ISODate,
  type OutDto,
  type TeamCalendarDto,
  type UserCalendarDto,
  type UserSummary,
} from '@ht/shared';
import { Holiday, User, VacationRequest } from '../models';
import { clock } from '../lib/clock';
import { forbidden, notFound } from '../lib/errors';
import type { Actor } from './actor';
import { getSettings } from './settings';
import { descendantsOf, loadTree } from './tree';
import { dtoContext, toRequestDto } from './requests';
import { allocationOf, type StoredRequest } from './balance/state';
import { holidayDto } from './holidays/dto';

/** Vistas de calendario (SPEC-15, 16, 17). Sin saldos ni comentarios ajenos. */

interface ReqForCal extends StoredRequest {
  halfDay?: { date?: string | null; period?: string | null } | null;
}

function absencesOf(r: ReqForCal, withBucket: boolean, from?: ISODate, to?: ISODate): CalendarAbsence[] {
  if (r.status !== 'PENDING' && r.status !== 'APPROVED' && r.status !== 'REVOKED') return [];
  const alloc = withBucket ? allocationOf(r) : [];
  const out: CalendarAbsence[] = [];
  for (const d of r.breakdown.days as Array<{ date: string; units: number; period?: string }>) {
    if (d.units === 0) continue;
    if (from && d.date < from) continue;
    if (to && d.date > to) continue;
    // de una anulada solo se muestran los días disfrutados antes de la anulación
    if (r.status === 'REVOKED' && (!r.revokedFromDate || d.date >= r.revokedFromDate)) continue;
    const buckets = alloc.filter((a) => a.date === d.date);
    out.push({
      requestId: String(r._id),
      userId: String(r.userId),
      date: d.date,
      units: d.units,
      period: (d.period as CalendarAbsence['period']) ?? null,
      status: r.status === 'PENDING' ? 'PENDING' : 'APPROVED',
      kind: r.kind,
      ...(withBucket
        ? { bucket: buckets.find((b) => b.bucket === 'CARRYOVER') ? 'CARRYOVER' : (buckets[0]?.bucket ?? (r.kind === 'BIRTHDAY' ? 'BIRTHDAY' : 'CURRENT')) }
        : {}),
    });
  }
  return out;
}

async function requestsInRange(userIds: string[] | null, from: ISODate, to: ISODate) {
  return (await VacationRequest.find({
    ...(userIds ? { userId: { $in: userIds } } : {}),
    status: { $in: ['PENDING', 'APPROVED', 'REVOKED'] },
    startDate: { $lte: to },
    endDate: { $gte: from },
  }).lean()) as unknown as ReqForCal[];
}

export async function userCalendar(actor: Actor, userId: string, year: number): Promise<UserCalendarDto> {
  if (actor.id !== userId && actor.role !== 'admin') throw forbidden('ADMIN_ONLY', 'Solo puedes ver tu calendario.');
  const user = await User.findById(userId).lean();
  if (!user) throw notFound('Usuario no encontrado.');
  const from = startOfYear(year);
  const to = endOfYear(year);
  const holidays = await Holiday.find({ calendarIds: user.holidayCalendarId, date: { $gte: from, $lte: to } })
    .sort({ date: 1 })
    .lean();
  const reqs = await requestsInRange([userId], from, to);
  const ctx = await dtoContext();
  const allReqs = (await VacationRequest.find({
    userId,
    startDate: { $lte: to },
    endDate: { $gte: from },
  })
    .sort({ startDate: 1 })
    .lean()) as unknown as Parameters<typeof toRequestDto>[1][];
  return {
    userId,
    year,
    holidays: await Promise.all(holidays.map((h) => holidayDto(h))),
    absences: reqs.flatMap((r) => absencesOf(r, true, from, to)),
    requests: await Promise.all(allReqs.map((r) => toRequestDto(actor, r, ctx))),
    birthdayDate: user.birthday ? birthdayInYear(user.birthday, year) : null,
  };
}

/** Usuarios visibles para el actor según la configuración de visibilidad. */
async function visibleUserIds(actor: Actor): Promise<string[] | null> {
  const settings = await getSettings();
  if (settings.teamVisibility === 'company' || actor.role === 'admin') return null;
  const tree = await loadTree();
  // rama: desde el manager del actor hacia abajo
  const me = tree.get(actor.id!);
  const root = me?.managerId ? String(me.managerId) : actor.id!;
  return [root, ...descendantsOf(root, tree)];
}

export async function teamCalendar(
  actor: Actor,
  q: { month: string; scope: 'all' | 'branch' | 'manager'; managerId?: string },
): Promise<TeamCalendarDto> {
  const [y, m] = q.month.split('-').map(Number) as [number, number];
  const from = formatDate(y, m, 1);
  const to = formatDate(y, m, daysInMonth(y, m));
  const settings = await getSettings();
  const tree = await loadTree();
  let ids: string[] | null = await visibleUserIds(actor);
  if (q.scope === 'branch') {
    const me = tree.get(actor.id!);
    const root = me?.managerId ? String(me.managerId) : actor.id!;
    ids = intersect(ids, [root, ...descendantsOf(root, tree)]);
  } else if (q.scope === 'manager' && q.managerId) {
    ids = intersect(ids, [q.managerId, ...descendantsOf(q.managerId, tree)]);
  }
  const users = await User.find({
    status: { $ne: 'disabled' },
    ...(ids ? { _id: { $in: ids } } : {}),
  })
    .sort({ name: 1 })
    .lean();
  const userIds = users.map((u) => String(u._id));
  const reqs = await requestsInRange(userIds, from, to);
  const calendarIds = [...new Set(users.map((u) => String(u.holidayCalendarId)))];
  const hols = await Holiday.find({ date: { $gte: from, $lte: to }, calendarIds: { $in: calendarIds } }).lean();
  const holByDate = new Map<string, { name: string; scope: HolidayScope }>();
  for (const h of hols) holByDate.set(h.date, { name: h.name, scope: h.scope });
  const absences = reqs.flatMap((r) => absencesOf(r, false, from, to));
  const totals = eachDay(from, to).map((date) => ({
    date,
    count: new Set(absences.filter((a) => a.date === date).map((a) => a.userId)).size,
  }));
  return {
    month: q.month,
    users: users.map(userSummary),
    days: eachDay(from, to).map((date) => ({
      date,
      weekend: settings.weekendDays.includes(dayOfWeek(date)),
      holiday: holByDate.get(date) ?? null,
    })),
    absences,
    totals,
    threshold: settings.teamOutThreshold,
  };
}

function intersect(a: string[] | null, b: string[]): string[] {
  return a ? b.filter((x) => a.includes(x)) : b;
}

export function userSummary(u: {
  _id: unknown;
  name: string;
  avatarUrl?: string | null;
  role: string;
  status: string;
  managerId?: unknown;
}): UserSummary {
  return {
    id: String(u._id),
    name: u.name,
    avatarUrl: u.avatarUrl ?? null,
    role: u.role as UserSummary['role'],
    status: u.status as UserSummary['status'],
    managerId: u.managerId ? String(u.managerId) : null,
  };
}

/** Quién está fuera entre dos fechas (por defecto hoy y los próximos 6 días). */
export async function whoIsOut(actor: Actor, from?: ISODate, to?: ISODate): Promise<OutDto> {
  const f = from ?? clock.today();
  const t = to ?? addDays(f, 6);
  const ids = await visibleUserIds(actor);
  const reqs = await requestsInRange(ids, f, t);
  const users = new Map(
    (await User.find(ids ? { _id: { $in: ids } } : {}).select('name avatarUrl').lean()).map((u) => [
      String(u._id),
      u,
    ]),
  );
  return {
    from: f,
    to: t,
    absences: reqs
      .filter((r) => r.status !== 'PENDING')
      .flatMap((r) => absencesOf(r, false, f, t))
      .map((a) => ({ ...a, userName: users.get(a.userId)?.name ?? '', avatarUrl: users.get(a.userId)?.avatarUrl ?? null })),
  };
}

/**
 * Solape informativo con el equipo (SPEC-09): equipo = compañeros con el mismo manager, el manager y los reportes directos.
 */
export async function teamOverlap(
  user: { _id: unknown; managerId?: unknown },
  dates: ISODate[],
): Promise<Array<{ date: ISODate; count: number }>> {
  if (!dates.length) return [];
  const uid = String(user._id);
  const managerId = user.managerId ? String(user.managerId) : null;
  const team = await User.find({
    _id: { $ne: uid },
    status: 'active',
    $or: [
      ...(managerId ? [{ managerId }, { _id: managerId }] : []),
      { managerId: uid },
    ],
  })
    .select('_id')
    .lean();
  const ids = team.map((u) => String(u._id));
  if (!ids.length) return [];
  const sorted = [...dates].sort();
  const reqs = await requestsInRange(ids, sorted[0]!, sorted[sorted.length - 1]!);
  const set = new Set(dates);
  const byDate = new Map<string, Set<string>>();
  for (const a of reqs.flatMap((r) => absencesOf(r, false))) {
    if (!set.has(a.date)) continue;
    if (!byDate.has(a.date)) byDate.set(a.date, new Set());
    byDate.get(a.date)!.add(a.userId);
  }
  return [...byDate.entries()].map(([date, s]) => ({ date, count: s.size })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** ¿Está fuera hoy? (para el organigrama) */
export async function outTodaySet(): Promise<Set<string>> {
  const today = clock.today();
  const reqs = await requestsInRange(null, today, today);
  return new Set(reqs.filter((r) => r.status !== 'PENDING').flatMap((r) => absencesOf(r, false, today, today)).map((a) => a.userId));
}
