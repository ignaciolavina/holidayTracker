import { todayMadrid, type ISODate } from '@ht/shared';

/**
 * Reloj inyectable. Única fuente de "ahora" y "hoy" en el servidor.
 * Los tests y los jobs simulados fijan el instante con `clock.set()`.
 */
let fixed: Date | null = null;

export const clock = {
  now(): Date {
    return fixed ? new Date(fixed.getTime()) : new Date();
  },
  today(): ISODate {
    return todayMadrid(clock.now());
  },
  set(at: Date | string): void {
    fixed = typeof at === 'string' ? new Date(at) : at;
  },
  reset(): void {
    fixed = null;
  },
};
