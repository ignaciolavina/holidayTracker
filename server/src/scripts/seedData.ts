import { HolidayCalendar, User } from '../models';
import { logger } from '../lib/logger';

/** Seed mínimo provisional (el seed completo de SPEC-20 lo sustituye). */
export async function seedIfEmpty(): Promise<boolean> {
  if (await User.exists({})) return false;
  if (!(await HolidayCalendar.exists({}))) {
    await HolidayCalendar.create({ name: 'Madrid capital', regionCode: 'ES-MD', localityName: 'Madrid', isDefault: true });
  }
  logger.info('seed: pendiente');
  return true;
}
