import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { env } from '../config/env';
import { loadActor } from './middleware/session';
import { csrf } from './middleware/csrf';
import { errorHandler, notFoundApi } from './middleware/errors';
import { route } from './route';
import { authRoutes, invitationPublicRoutes, meRoutes } from './routes/auth';
import { invitationRoutes, orgRoutes, userRoutes } from './routes/users';
import { approvalRoutes, requestRoutes } from './routes/requests';
import { balanceRoutes, ledgerRoutes } from './routes/balances';
import { calendarRoutes } from './routes/calendar';
import {
  adminRoutes,
  auditRoutes,
  holidayItemRoutes,
  holidayRoutes,
  jobRoutes,
  notificationRoutes,
  settingsRoutes,
} from './routes/admin';

export function createApp(opts: { staticDir?: string } = {}): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'img-src': ["'self'", 'data:', 'https:'] },
      },
    }),
  );
  // CORS cerrado: en producción el front se sirve desde el mismo origen
  app.use(cors({ origin: env.corsOrigin ? [env.corsOrigin] : false, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const health = express.Router();
  route(health, '/api/health', 'get', '/', 'public', async () => ({
    ok: mongoose.connection.readyState === 1,
    db: mongoose.connection.readyState === 1 ? 'up' : 'down',
  }));
  app.use('/api/health', health);

  app.use('/api', loadActor, csrf);
  app.use('/api/auth', authRoutes());
  app.use('/api/invitations', invitationPublicRoutes());
  app.use('/api/invitations', invitationRoutes());
  app.use('/api/me', meRoutes());
  app.use('/api/users', userRoutes());
  app.use('/api/org', orgRoutes());
  app.use('/api/requests', requestRoutes());
  app.use('/api/approvals', approvalRoutes());
  app.use('/api/balances', balanceRoutes());
  app.use('/api/ledger', ledgerRoutes());
  app.use('/api/calendar', calendarRoutes());
  app.use('/api/holiday-calendars', holidayRoutes());
  app.use('/api/holidays', holidayItemRoutes());
  app.use('/api/notifications', notificationRoutes());
  app.use('/api/audit', auditRoutes());
  app.use('/api/settings', settingsRoutes());
  app.use('/api/jobs', jobRoutes());
  app.use('/api/admin', adminRoutes());
  app.use('/api', notFoundApi);

  // build estático del front (un único servicio en Railway)
  const staticDir = opts.staticDir ?? path.resolve(process.cwd(), '../client/dist');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
