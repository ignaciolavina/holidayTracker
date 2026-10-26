import { Router } from 'express';
import { teamCalendarQuery, yearOf, isValidDate } from '@ht/shared';
import { actorOf, idParam, parse, route, yearParam } from '../route';
import { teamCalendar, userCalendar, whoIsOut } from '../../services/calendar';
import { clock } from '../../lib/clock';

export function calendarRoutes(): Router {
  const r = Router();
  const base = '/api/calendar';
  const thisYear = () => yearOf(clock.today());
  route(r, base, 'get', '/me', 'auth', async (req) =>
    userCalendar(actorOf(req), actorOf(req).id!, yearParam(req.query.year, thisYear())),
  );
  route(r, base, 'get', '/user/:userId', 'admin', async (req) =>
    userCalendar(actorOf(req), idParam(req, 'userId'), yearParam(req.query.year, thisYear())),
  );
  route(r, base, 'get', '/team', 'auth', async (req) => teamCalendar(actorOf(req), parse(teamCalendarQuery, req.query)));
  route(r, base, 'get', '/out', 'auth', async (req) => {
    const from = isValidDate(req.query.from) ? req.query.from : undefined;
    const to = isValidDate(req.query.to) ? req.query.to : undefined;
    return whoIsOut(actorOf(req), from, to);
  });
  return r;
}
