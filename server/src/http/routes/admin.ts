import { Router } from 'express';
import {
  auditQuery,
  holidayDeleteSchema,
  holidayImpactSchema,
  holidayMutationSchema,
  importConfirmSchema,
  importPreviewSchema,
  settingsPatchSchema,
  yearOf,
  type AdminOverviewDto,
} from '@ht/shared';
import { z } from 'zod';
import { actorOf, idParam, parse, route, yearParam } from '../route';
import { Holiday, HolidayCalendar, Notification } from '../../models';
import { clock } from '../../lib/clock';
import { getSettings, updateSettings } from '../../services/settings';
import { holidayDto } from '../../services/holidays/dto';
import { holidayImpact, mutateHoliday } from '../../services/holidays/mutations';
import { importConfirm, importPreview } from '../../services/holidays/importer';
import { auditCsv, queryAudit } from '../../services/auditQuery';
import { holidaysMissingForNextYear, listJobRuns, runJobManually } from '../../services/jobs/runner';
import { pendingForAdmin } from '../../services/requests';
import { whoIsOut } from '../../services/calendar';
import { notFound } from '../../lib/errors';

export function holidayRoutes(): Router {
  const r = Router();
  route(r, '/api/holiday-calendars', 'get', '/', 'auth', async () => {
    const list = await HolidayCalendar.find({}).sort({ isDefault: -1, name: 1 }).lean();
    return list.map((c) => ({ id: String(c._id), name: c.name, regionCode: c.regionCode, localityName: c.localityName, isDefault: c.isDefault }));
  });
  return r;
}

export function holidayItemRoutes(): Router {
  const r = Router();
  const base = '/api/holidays';
  route(r, base, 'get', '/', 'auth', async (req) => {
    const year = yearParam(req.query.year, yearOf(clock.today()));
    const calendarId = typeof req.query.calendarId === 'string' && /^[a-f0-9]{24}$/i.test(req.query.calendarId) ? req.query.calendarId : null;
    const list = await Holiday.find({ year, ...(calendarId ? { calendarIds: calendarId } : {}) }).sort({ date: 1 }).lean();
    return Promise.all(list.map((h) => holidayDto(h)));
  });
  route(r, base, 'get', '/status', 'admin', async () => {
    const s = await holidaysMissingForNextYear();
    return { year: s.year, nextYearMissing: s.missing };
  });
  route(r, base, 'post', '/import/preview', 'admin', async (req) => importPreview(parse(importPreviewSchema, req.body).year));
  route(r, base, 'post', '/import/confirm', 'admin', async (req) => importConfirm(actorOf(req), parse(importConfirmSchema, req.body)));
  route(r, base, 'post', '/impact', 'admin', async (req) => holidayImpact(parse(holidayImpactSchema, req.body)));
  route(r, base, 'post', '/', 'admin', async (req, res) => {
    const { confirm, confirmText, reason, ...h } = parse(holidayMutationSchema, req.body);
    const out = await mutateHoliday(actorOf(req), { op: 'create', ...h }, { confirm, confirmText, reason });
    res.status(201);
    return out;
  });
  route(r, base, 'patch', '/:id', 'admin', async (req) => {
    const { confirm, confirmText, reason, ...h } = parse(holidayMutationSchema.partial(), req.body);
    return mutateHoliday(actorOf(req), { op: 'update', id: idParam(req), ...h }, { confirm, confirmText, reason });
  });
  route(r, base, 'delete', '/:id', 'admin', async (req) => {
    const opts = parse(holidayDeleteSchema, req.body);
    return mutateHoliday(actorOf(req), { op: 'delete', id: idParam(req) }, opts);
  });
  return r;
}

export function notificationRoutes(): Router {
  const r = Router();
  const base = '/api/notifications';
  route(r, base, 'get', '/', 'auth', async (req) => {
    const userId = actorOf(req).id;
    const [items, unread] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(100).lean(),
      Notification.countDocuments({ userId, readAt: null }),
    ]);
    return {
      unread,
      items: items.map((n) => ({
        id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: (n.createdAt as Date).toISOString(),
      })),
    };
  });
  route(r, base, 'post', '/read-all', 'auth', async (req) => {
    await Notification.updateMany({ userId: actorOf(req).id, readAt: null }, { $set: { readAt: clock.now() } });
    return undefined;
  });
  route(r, base, 'post', '/:id/read', 'auth', async (req) => {
    const upd = await Notification.updateOne({ _id: idParam(req), userId: actorOf(req).id }, { $set: { readAt: clock.now() } });
    if (!upd.matchedCount) throw notFound('Notificación no encontrada.');
    return undefined;
  });
  return r;
}

export function auditRoutes(): Router {
  const r = Router();
  const base = '/api/audit';
  route(r, base, 'get', '/export.csv', 'admin', async (req, res) => {
    const f = parse(auditQuery, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
    res.send(await auditCsv(f));
  });
  route(r, base, 'get', '/', 'admin', async (req) => queryAudit(parse(auditQuery, req.query)));
  return r;
}

export function settingsRoutes(): Router {
  const r = Router();
  const base = '/api/settings';
  route(r, base, 'get', '/', 'auth', async () => getSettings());
  route(r, base, 'patch', '/', 'admin', async (req) => {
    const { reason, ...patch } = parse(settingsPatchSchema, req.body);
    return updateSettings(actorOf(req), patch, reason);
  });
  return r;
}

export function jobRoutes(): Router {
  const r = Router();
  const base = '/api/jobs';
  route(r, base, 'get', '/', 'admin', async () => listJobRuns());
  route(r, base, 'post', '/:name/run', 'admin', async (req) => {
    parse(z.object({}).passthrough(), req.body);
    const run = await runJobManually(actorOf(req), String(req.params.name));
    return run ?? { status: 'locked', message: 'El job ya se está ejecutando en otra instancia.' };
  });
  return r;
}

export function adminRoutes(): Router {
  const r = Router();
  route(r, '/api/admin', 'get', '/overview', 'admin', async (req): Promise<AdminOverviewDto> => {
    const actor = actorOf(req);
    const pending = await pendingForAdmin(actor);
    const today = clock.today();
    const out = await whoIsOut(actor, today, today);
    const holidays = await holidaysMissingForNextYear();
    const { items: recentSensitive } = await queryAudit({ sensitive: '1', page: 1, pageSize: 10 });
    const alerts: AdminOverviewDto['alerts'] = [];
    if (holidays.missing) {
      alerts.push({ code: 'HOLIDAYS_MISSING', level: 'warning', message: `Faltan los festivos de ${holidays.year}.`, link: '/admin/holidays' });
    }
    const autos = recentSensitive.filter((a) => a.action === 'REQUEST_AUTO_APPROVED_NO_APPROVER');
    if (autos.length) {
      alerts.push({ code: 'AUTO_APPROVALS', level: 'info', message: `Hay ${autos.length} autoaprobaciones recientes por falta de aprobador.`, link: '/admin/audit' });
    }
    if (pending.escalated.length) {
      alerts.push({ code: 'ESCALATED', level: 'danger', message: `${pending.escalated.length} solicitudes escaladas o urgentes.` });
    }
    return { ...pending, outToday: out.absences, alerts, recentSensitive };
  });
  return r;
}
