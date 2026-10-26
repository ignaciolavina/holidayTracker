import { env } from './config/env';
import { connectDb } from './db/connect';
import { createApp } from './http/app';
import { logger } from './lib/logger';
import { catchUp, startScheduler } from './services/jobs/runner';
import { seedIfEmpty } from './scripts/seedData';
import path from 'node:path';
import { existsSync } from 'node:fs';

async function main() {
  process.env.TZ = process.env.TZ ?? 'Europe/Madrid';
  await connectDb();
  if (env.seedOnEmpty) await seedIfEmpty();
  // el build del front puede estar junto al server (Railway) o en ../client/dist (monorepo)
  const candidates = [path.resolve(process.cwd(), 'client/dist'), path.resolve(process.cwd(), '../client/dist')];
  const staticDir = candidates.find((p) => existsSync(p));
  const app = createApp({ staticDir });
  app.listen(env.port, () => logger.info(`holidayTracker escuchando en :${env.port}`));
  startScheduler();
  catchUp().catch((err) => logger.error('catch-up', err));
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
