import { env } from '../config/env';

export const logger = {
  info: (...args: unknown[]) => {
    if (!env.isTest) console.log('[ht]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (!env.isTest) console.warn('[ht]', ...args);
  },
  error: (...args: unknown[]) => console.error('[ht]', ...args),
};
