import { yearOf, type HolidayDraftItem, type HolidayScope } from '@ht/shared';
import { env } from '../../config/env';
import { Holiday, HolidayCalendar } from '../../models';
import { withTx } from '../../db/tx';
import { badRequest, unprocessable } from '../../lib/errors';
import type { Actor } from '../actor';
import { audit } from '../audit';
import { holidayImpact, mutateHoliday } from './mutations';
import { isYearClosedGlobally } from './dto';

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  counties: string[] | null;
  global?: boolean;
}

/**
 * Importación desde Nager.Date (SPEC-05): sin `counties` → nacional; con `ES-MD` → autonómico de Madrid;
 * el resto se ignora. Los locales (San Isidro, Almudena) los añade el admin a mano.
 */
export function mapNager(list: NagerHoliday[], regionCode = 'ES-MD'): HolidayDraftItem[] {
  const out: HolidayDraftItem[] = [];
  for (const h of list) {
    let scope: HolidayScope | null = null;
    if (!h.counties || h.counties.length === 0) scope = 'national';
    else if (h.counties.includes(regionCode)) scope = 'regional';
    if (!scope) continue;
    if (out.some((o) => o.date === h.date)) continue;
    out.push({ date: h.date, name: h.localName || h.name, scope });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function importPreview(year: number): Promise<HolidayDraftItem[]> {
  let res: Response;
  try {
    res = await fetch(`${env.nagerBaseUrl}/api/v3/PublicHolidays/${year}/ES`, { signal: AbortSignal.timeout(10000) });
  } catch {
    throw unprocessable('NAGER_UNAVAILABLE', 'No se ha podido conectar con Nager.Date. Inténtalo más tarde o añade los festivos a mano.');
  }
  if (!res.ok) throw unprocessable('NAGER_ERROR', `Nager.Date respondió con un error (${res.status}).`);
  return mapNager((await res.json()) as NagerHoliday[]);
}

/**
 * Confirma el borrador: crea los que faltan. Si un festivo nuevo afecta a solicitudes existentes,
 * pasa por el servicio de impacto (SPEC-11) en lugar de insertarse directamente.
 */
export async function importConfirm(
  actor: Actor,
  input: { year: number; calendarId?: string; holidays: HolidayDraftItem[] },
): Promise<{ created: number; skipped: number; withImpact: number }> {
  if (await isYearClosedGlobally(input.year)) throw unprocessable('YEAR_LOCKED', `El año ${input.year} está cerrado.`);
  if (input.holidays.some((h) => yearOf(h.date) !== input.year)) {
    throw badRequest('WRONG_YEAR', `Todos los festivos tienen que ser de ${input.year}.`);
  }
  const cal = input.calendarId
    ? await HolidayCalendar.findById(input.calendarId).lean()
    : ((await HolidayCalendar.findOne({ isDefault: true }).lean()) ?? (await HolidayCalendar.findOne({}).lean()));
  if (!cal) throw unprocessable('NO_CALENDAR', 'No hay calendario de festivos.');
  const calendarId = String(cal._id);
  let created = 0;
  let skipped = 0;
  let withImpact = 0;
  const plain: HolidayDraftItem[] = [];
  for (const h of input.holidays) {
    if (await Holiday.exists({ date: h.date, calendarIds: calendarId })) {
      skipped++;
      continue;
    }
    const impact = await holidayImpact({ op: 'create', date: h.date, scope: h.scope, calendarIds: [calendarId], name: h.name });
    if (impact.affected.length) {
      await mutateHoliday(
        actor,
        { op: 'create', date: h.date, scope: h.scope, calendarIds: [calendarId], name: h.name },
        { confirm: true, confirmText: 'CONFIRMAR', reason: `Importación de festivos ${input.year}` },
      );
      withImpact++;
      created++;
    } else plain.push(h);
  }
  if (plain.length) {
    await withTx(async ({ session }) => {
      await Holiday.insertMany(
        plain.map((h) => ({ ...h, calendarIds: [calendarId], year: input.year, source: 'import' })),
        { session },
      );
      await audit.log(actor, 'HOLIDAYS_IMPORTED', { type: 'holiday', id: null }, null, { year: input.year, calendarId, holidays: plain }, null, session);
    });
    created += plain.length;
  }
  return { created, skipped, withImpact };
}
