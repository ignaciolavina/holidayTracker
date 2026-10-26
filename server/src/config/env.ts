/** Variables de entorno (ver .env.example). */

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes'].includes(v.toLowerCase());
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test' || !!process.env.VITEST;

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio en producción');
}

export const env = {
  nodeEnv,
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: process.env.MONGODB_URI ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me-0123456789abcdef',
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  mailTransport: (process.env.MAIL_TRANSPORT ?? 'console') as 'console' | 'smtp' | 'resend',
  mailFrom: process.env.MAIL_FROM ?? 'holidayTracker <no-reply@holidaytracker.local>',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    secure: bool(process.env.SMTP_SECURE, false),
  },
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  cronEnabled: bool(process.env.CRON_ENABLED, !isTest),
  rateLimitEnabled: bool(process.env.RATE_LIMIT_ENABLED, !isTest),
  nagerBaseUrl: process.env.NAGER_BASE_URL ?? 'https://date.nager.at',
  seedOnEmpty: bool(process.env.SEED_ON_EMPTY, !isProd),
  bcryptCost: isTest ? 4 : 12,
  mailDir: process.env.MAIL_DIR ?? 'tmp/mails',
};
