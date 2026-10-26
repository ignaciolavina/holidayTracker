import type { ClientSession } from 'mongoose';
import type { EngineHoliday, ISODate } from '@ht/shared';
import { Holiday } from '../../models';

/** Festivos del calendario de un usuario en un rango (para el motor de cómputo). */
export async function holidaysFor(
  calendarId: string,
  from: ISODate,
  to: ISODate,
  session?: ClientSession,
): Promise<Array<EngineHoliday & { id: string }>> {
  const docs = await Holiday.find({ calendarIds: calendarId, date: { $gte: from, $lte: to } })
    .session(session ?? null)
    .lean();
  return docs.map((h) => ({ id: String(h._id), date: h.date, scope: h.scope, name: h.name }));
}
