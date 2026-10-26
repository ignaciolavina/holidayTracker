import cron from 'node-cron';
import { formatDate, yearOf, type JobRunDto } from '@ht/shared';
import { Holiday, JobLock, JobRun, User, VacationRequest } from '../../models';
import { clock } from '../../lib/clock';
import { randomToken } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { notFound } from '../../lib/errors';
import { withTx } from '../../db/tx';
import { env } from '../../config/env';
import type { Actor } from '../actor';
import { audit } from '../audit';
import { notify } from '../notifications';
import { getSettings } from '../settings';
import { escalateInTx, pendingForAdmin } from '../requests';
import { processMailQueue } from '../mail/queue';
import { loadTree, activeAdmins } from '../tree';
import { closeYear, expireCarryover, carryoverReminders } from './yearEnd';
import { invalidateClosedCache } from '../holidays/dto';

/**
 * Tareas programadas (SPEC-14): idempotentes, con lock distribuido en Mongo (varias réplicas),
 * registro de cada ejecución, ejecución manual y recuperación al arrancar (catch-up).
 */

export const JOB_NAMES = [
  'year-close',
  'carryover-expiry',
  'expiry-reminders',
  'escalation',
  'pending-digest',
  'holidays-check',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

const OWNER = randomToken(8);
const LOCK_MS = 15 * 60 * 1000;

async function acquireLock(name: string): Promise<boolean> {
  const now = clock.now();
  try {
    const r = await JobLock.findOneAndUpdate(
      { _id: name, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { owner: OWNER, lockedUntil: new Date(now.getTime() + LOCK_MS) } },
      { upsert: true, new: true },
    );
    return r?.owner === OWNER;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // otra réplica lo tiene
    throw err;
  }
}

async function releaseLock(name: string): Promise<void> {
  await JobLock.updateOne({ _id: name, owner: OWNER }, { $set: { lockedUntil: null } });
}

/** Clave lógica de una ejecución: los jobs de periodo (cierre, caducidad) solo se completan una vez. */
function periodKey(name: JobName, year?: number): string {
  const today = clock.today();
  switch (name) {
    case 'year-close':
      return `year-close:${year ?? yearOf(today) - 1}`;
    case 'carryover-expiry':
      return `carryover-expiry:${year ?? yearOf(today)}`;
    case 'holidays-check':
      return `holidays-check:${today}`;
    case 'pending-digest':
      return `pending-digest:${today}`;
    case 'expiry-reminders':
      return `expiry-reminders:${today}`;
    default:
      return `${name}:${clock.now().toISOString()}`;
  }
}

async function execute(name: JobName, year?: number): Promise<unknown> {
  const today = clock.today();
  switch (name) {
    case 'year-close': {
      const r = await closeYear(year ?? yearOf(today) - 1);
      invalidateClosedCache();
      return r;
    }
    case 'carryover-expiry':
      return expireCarryover(year ?? yearOf(today));
    case 'expiry-reminders':
      return carryoverReminders();
    case 'escalation':
      return escalatePending();
    case 'pending-digest':
      return pendingDigest();
    case 'holidays-check':
      return holidaysCheck();
  }
}

export interface RunOptions {
  trigger: 'cron' | 'manual' | 'catchup';
  year?: number;
  actor?: Actor;
}

/**
 * Ejecuta un job con lock y registro. Si es un job de periodo ya completado, no hace nada
 * (y aunque se ejecutara, todos los movimientos son idempotentes).
 */
export async function runJob(name: JobName, opts: RunOptions): Promise<JobRunDto | null> {
  const key = periodKey(name, opts.year);
  const done = await JobRun.findOne({ key, status: 'done' }).lean();
  if (done && (name === 'year-close' || name === 'carryover-expiry')) return toDto(done);
  if (!(await acquireLock(name))) {
    logger.info(`job ${name}: bloqueado por otra réplica`);
    return null;
  }
  try {
    const run = await JobRun.findOneAndUpdate(
      { key },
      { $set: { job: name, status: 'running', trigger: opts.trigger, startedAt: clock.now(), finishedAt: null, error: null } },
      { upsert: true, new: true },
    );
    if (opts.actor) {
      await audit.log(opts.actor, 'JOB_RUN_MANUAL', { type: 'job', id: null }, null, { job: name, key }, null);
    }
    try {
      const result = await execute(name, opts.year);
      run.status = 'done';
      run.result = result as never;
      run.finishedAt = clock.now();
      await run.save();
      if (name === 'year-close') {
        await audit.log({ id: null, role: 'system' }, 'YEAR_CLOSED', { type: 'year', id: null }, null, result, null);
      }
      logger.info(`job ${name} (${key}) ok`);
    } catch (err) {
      run.status = 'failed';
      run.error = (err as Error).message;
      run.finishedAt = clock.now();
      await run.save();
      logger.error(`job ${name} (${key}) falló`, err);
    }
    return toDto(run.toObject());
  } finally {
    await releaseLock(name);
  }
}

function toDto(r: {
  _id: unknown;
  job: string;
  key: string;
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt?: Date | null;
  result?: unknown;
  error?: string | null;
}): JobRunDto {
  return {
    id: String(r._id),
    job: r.job,
    key: r.key,
    status: r.status as JobRunDto['status'],
    trigger: r.trigger as JobRunDto['trigger'],
    startedAt: new Date(r.startedAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    result: r.result ?? null,
    error: r.error ?? null,
  };
}

export async function listJobRuns(): Promise<JobRunDto[]> {
  const runs = await JobRun.find({}).sort({ startedAt: -1 }).limit(200).lean();
  return runs.map(toDto);
}

export async function runJobManually(actor: Actor, name: string): Promise<JobRunDto | null> {
  if (!JOB_NAMES.includes(name as JobName)) throw notFound('Job desconocido.');
  return runJob(name as JobName, { trigger: 'manual', actor });
}

// ───────── jobs de recordatorio ─────────

/** Escalado: pendientes con más de N horas o que ya han empezado (urgentes). */
async function escalatePending(): Promise<{ escalated: number }> {
  const settings = await getSettings();
  const cutoff = new Date(clock.now().getTime() - settings.escalationHours * 3600 * 1000);
  const today = clock.today();
  const list = await VacationRequest.find({
    status: 'PENDING',
    escalatedAt: null,
    $or: [{ createdAt: { $lte: cutoff } }, { startDate: { $lte: today } }],
  })
    .select('_id createdAt startDate')
    .lean();
  let escalated = 0;
  for (const r of list) {
    const why = r.startDate <= today ? 'URGENT' : 'OVERDUE';
    const ok = await withTx((ctx) => escalateInTx(ctx, String(r._id), why));
    if (ok) escalated++;
  }
  // marca urgentes las ya escaladas que han llegado a su fecha
  await VacationRequest.updateMany(
    { status: 'PENDING', urgentAt: null, startDate: { $lte: today } },
    { $set: { urgentAt: clock.now() } },
  );
  return { escalated };
}

/** Resumen diario a las 9:00 para cada aprobador con pendientes de más de 48 h. */
async function pendingDigest(): Promise<{ sent: number }> {
  const settings = await getSettings();
  const tree = await loadTree();
  const cutoff = clock.now().getTime() - settings.escalationHours * 3600 * 1000;
  let sent = 0;
  for (const adminId of activeAdmins(tree)) {
    const { toApprove } = await pendingForAdmin({ id: adminId, role: 'admin' });
    const old = toApprove.filter((r) => new Date(r.createdAt).getTime() <= cutoff);
    if (!old.length) continue;
    await notify([adminId], {
      type: 'PENDING_DIGEST',
      title: `Tienes ${old.length} ${old.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'} de hace más de ${settings.escalationHours} h`,
      body: old.map((r) => `${r.userName}: ${r.startDate} → ${r.endDate}`).join(' · '),
      link: '/admin',
      inApp: false,
      dedupeKey: `digest:${clock.today()}`,
      email: {
        subject: `Solicitudes pendientes (${old.length})`,
        paragraphs: ['Estas solicitudes llevan tiempo esperando una decisión:', ...old.map((r) => `• ${r.userName}: del ${r.startDate} al ${r.endDate}`)],
        cta: { label: 'Revisar pendientes', path: '/admin' },
      },
    });
    sent++;
  }
  return { sent };
}

/** A partir del 1 de octubre, avisa a los admins si faltan los festivos del año siguiente. */
export async function holidaysMissingForNextYear(): Promise<{ year: number; missing: boolean }> {
  const today = clock.today();
  const next = yearOf(today) + 1;
  const missing = today >= formatDate(yearOf(today), 10, 1) && !(await Holiday.exists({ year: next }));
  return { year: next, missing };
}

async function holidaysCheck(): Promise<{ year: number; missing: boolean }> {
  const status = await holidaysMissingForNextYear();
  if (status.missing) {
    const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').lean();
    await notify(
      admins.map((a) => a._id),
      {
        type: 'HOLIDAYS_MISSING',
        title: `Faltan los festivos de ${status.year}`,
        body: `Importa los festivos de ${status.year} y añade los locales de Madrid.`,
        link: '/admin/holidays',
        dedupeKey: `holidays-missing:${status.year}`,
        email: {
          subject: `Faltan los festivos de ${status.year}`,
          paragraphs: [`Todavía no hay festivos cargados para ${status.year}. Sin ellos, las solicitudes de ese año contarán los festivos como laborables.`],
          cta: { label: 'Importar festivos', path: '/admin/holidays' },
        },
      },
    );
  }
  return status;
}

// ───────── planificador ─────────

const tasks: cron.ScheduledTask[] = [];

export function startScheduler(): void {
  if (!env.cronEnabled) return;
  const tz = { timezone: 'Europe/Madrid' };
  const safe = (name: JobName) => () => {
    runJob(name, { trigger: 'cron' }).catch((err) => logger.error(`job ${name}`, err));
  };
  tasks.push(cron.schedule('10 0 1 1 *', safe('year-close'), tz));
  tasks.push(cron.schedule('10 0 1 3 *', safe('carryover-expiry'), tz));
  tasks.push(cron.schedule('0 9 * * *', safe('expiry-reminders'), tz));
  tasks.push(cron.schedule('5 * * * *', safe('escalation'), tz));
  tasks.push(cron.schedule('0 9 * * *', safe('pending-digest'), tz));
  tasks.push(cron.schedule('0 9 1 10 *', safe('holidays-check'), tz));
  tasks.push(
    cron.schedule('* * * * *', () => {
      processMailQueue().catch((err) => logger.warn('mail queue', err));
    }),
  );
}

export function stopScheduler(): void {
  for (const t of tasks.splice(0)) t.stop();
}

/**
 * Catch-up al arrancar: si el servidor estaba caído a la hora programada, se recupera lo que no se ejecutó.
 */
export async function catchUp(): Promise<string[]> {
  const ran: string[] = [];
  const today = clock.today();
  const year = yearOf(today);
  if (await User.exists({ status: 'active' })) {
    // cierre del año anterior (y de cualquier año anterior pendiente con actividad)
    const oldest = await JobRun.findOne({ job: 'year-close', status: 'done' }).sort({ key: -1 }).lean();
    const lastClosed = oldest ? Number(oldest.key.split(':')[1]) : null;
    const firstHire = await User.findOne({ status: { $ne: 'invited' } }).sort({ hireDate: 1 }).lean();
    const from = lastClosed !== null ? lastClosed + 1 : Math.max(yearOf(firstHire?.hireDate ?? today), year - 1);
    for (let y = from; y <= year - 1; y++) {
      const r = await runJob('year-close', { trigger: 'catchup', year: y });
      if (r) ran.push(r.key);
    }
    if (today >= formatDate(year, 3, 1)) {
      const r = await runJob('carryover-expiry', { trigger: 'catchup', year });
      if (r) ran.push(r.key);
    }
    for (const name of ['escalation', 'expiry-reminders', 'holidays-check'] as const) {
      const r = await runJob(name, { trigger: 'catchup' });
      if (r) ran.push(r.key);
    }
  }
  return ran;
}
