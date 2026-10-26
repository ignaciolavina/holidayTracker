import { Router } from 'express';
import { adjustmentSchema, yearOf } from '@ht/shared';
import { actorOf, idParam, parse, route, yearParam } from '../route';
import { getBalance } from '../../services/balance/state';
import { adjustBalance, balancesCsv, listBalances, listLedger } from '../../services/balance/admin';
import { clock } from '../../lib/clock';

export function balanceRoutes(): Router {
  const r = Router();
  const base = '/api/balances';
  const thisYear = () => yearOf(clock.today());
  route(r, base, 'get', '/me', 'auth', async (req) => getBalance(actorOf(req).id!, yearParam(req.query.year, thisYear())));
  route(r, base, 'get', '/export.csv', 'admin', async (req, res) => {
    const year = yearParam(req.query.year, thisYear());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="saldos-${year}.csv"`);
    res.send(balancesCsv(await listBalances(year)));
  });
  route(r, base, 'get', '/', 'admin', async (req) => listBalances(yearParam(req.query.year, thisYear())));
  route(r, base, 'get', '/:userId', 'admin', async (req) =>
    getBalance(idParam(req, 'userId'), yearParam(req.query.year, thisYear())),
  );
  route(r, base, 'post', '/:userId/adjust', 'admin', async (req) =>
    adjustBalance(actorOf(req), idParam(req, 'userId'), parse(adjustmentSchema, req.body)),
  );
  return r;
}

export function ledgerRoutes(): Router {
  const r = Router();
  const base = '/api/ledger';
  const y = (v: unknown) => (v === undefined ? undefined : yearParam(v, yearOf(clock.today())));
  route(r, base, 'get', '/me', 'auth', async (req) => listLedger(actorOf(req).id!, y(req.query.year)));
  route(r, base, 'get', '/:userId', 'admin', async (req) => listLedger(idParam(req, 'userId'), y(req.query.year)));
  return r;
}
