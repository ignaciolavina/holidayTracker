import type { HolidayDto } from '@ht/shared';
import { JobRun } from '../../models';

/** Un año está cerrado (globalmente) cuando el cierre anual de ese año ha terminado. */
export async function isYearClosedGlobally(year: number): Promise<boolean> {
  return !!(await JobRun.exists({ key: `year-close:${year}`, status: 'done' }));
}

const cache = new Map<number, { at: number; closed: boolean }>();

async function closedCached(year: number): Promise<boolean> {
  const hit = cache.get(year);
  if (hit && performance.now() - hit.at < 5000) return hit.closed;
  const closed = await isYearClosedGlobally(year);
  cache.set(year, { at: performance.now(), closed });
  return closed;
}

export function invalidateClosedCache(): void {
  cache.clear();
}

export async function holidayDto(h: {
  _id: unknown;
  date: string;
  name: string;
  scope: HolidayDto['scope'];
  calendarIds?: unknown[];
  source?: string | null;
  year: number;
}): Promise<HolidayDto> {
  return {
    id: String(h._id),
    date: h.date,
    name: h.name,
    scope: h.scope,
    calendarIds: (h.calendarIds ?? []).map(String),
    source: (h.source as HolidayDto['source']) ?? 'manual',
    year: h.year,
    locked: await closedCached(h.year),
  };
}
