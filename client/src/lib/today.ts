import { todayMadrid, type ISODate } from '@ht/shared';

/** Único punto del front donde se obtiene "hoy" (Europe/Madrid). */
export function today(): ISODate {
  return todayMadrid(new Date());
}
