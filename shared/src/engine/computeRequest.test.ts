import { describe, expect, it } from 'vitest';
import { computeRequest, splitByYear, describeComputation, EngineError } from './computeRequest';
import type { EngineHoliday } from './computeRequest';

const H = (date: string, scope: EngineHoliday['scope'] = 'national', name = 'Festivo'): EngineHoliday => ({
  date,
  scope,
  name,
});

describe('computeRequest (SPEC-06)', () => {
  it('cuenta una semana laborable completa como 10 unidades', () => {
    const r = computeRequest({ startDate: '2026-03-09', endDate: '2026-03-13', holidays: [] });
    expect(r.totalUnits).toBe(10);
    expect(r.calendarDays).toBe(5);
    expect(r.weekendCount).toBe(0);
    expect(r.holidayCount).toBe(0);
    expect(r.days.map((d) => d.units)).toEqual([2, 2, 2, 2, 2]);
  });

  it('los fines de semana valen 0 con reason weekend', () => {
    const r = computeRequest({ startDate: '2026-03-06', endDate: '2026-03-09', holidays: [] });
    expect(r.days).toEqual([
      { date: '2026-03-06', units: 2 },
      { date: '2026-03-07', units: 0, reason: 'weekend' },
      { date: '2026-03-08', units: 0, reason: 'weekend' },
      { date: '2026-03-09', units: 2 },
    ]);
    expect(r.totalUnits).toBe(4);
    expect(r.weekendCount).toBe(2);
  });

  it('festivos de cada nivel valen 0 con su reason', () => {
    const r = computeRequest({
      startDate: '2026-05-01',
      endDate: '2026-05-15',
      holidays: [H('2026-05-01', 'national'), H('2026-05-04', 'regional'), H('2026-05-15', 'local')],
    });
    const byDate = Object.fromEntries(r.days.map((d) => [d.date, d]));
    expect(byDate['2026-05-01']).toEqual({ date: '2026-05-01', units: 0, reason: 'holiday-national' });
    expect(byDate['2026-05-04']).toEqual({ date: '2026-05-04', units: 0, reason: 'holiday-regional' });
    expect(byDate['2026-05-15']).toEqual({ date: '2026-05-15', units: 0, reason: 'holiday-local' });
    // 15 días naturales: 4 de fin de semana, 3 festivos → 8 laborables
    expect(r.calendarDays).toBe(15);
    expect(r.weekendCount).toBe(4);
    expect(r.holidayCount).toBe(3);
    expect(r.totalUnits).toBe(16);
  });

  it('un festivo en fin de semana cuenta como fin de semana, no como festivo', () => {
    const r = computeRequest({ startDate: '2026-08-14', endDate: '2026-08-17', holidays: [H('2026-08-15')] });
    expect(r.days[1]).toEqual({ date: '2026-08-15', units: 0, reason: 'weekend' });
    expect(r.holidayCount).toBe(0);
    expect(r.weekendCount).toBe(2);
  });

  it('festivos duplicados (mismo día en dos niveles) priorizan el de mayor ámbito', () => {
    const r = computeRequest({
      startDate: '2026-11-09',
      endDate: '2026-11-10',
      holidays: [H('2026-11-09', 'local'), H('2026-11-09', 'regional')],
    });
    expect(r.days[0]!.reason).toBe('holiday-regional');
    expect(r.holidayCount).toBe(1);
  });

  it('medio día de un solo día computa 1 unidad', () => {
    const r = computeRequest({
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      halfDay: { date: '2026-03-10', period: 'AM' },
      holidays: [],
    });
    expect(r.totalUnits).toBe(1);
    expect(r.days[0]).toEqual({ date: '2026-03-10', units: 1, period: 'AM' });
  });

  it('medio día al final de un rango', () => {
    const r = computeRequest({
      startDate: '2026-03-09',
      endDate: '2026-03-11',
      halfDay: { date: '2026-03-11', period: 'PM' },
      holidays: [],
    });
    expect(r.totalUnits).toBe(5);
  });

  it('medio día al inicio de un rango', () => {
    const r = computeRequest({
      startDate: '2026-03-09',
      endDate: '2026-03-11',
      halfDay: { date: '2026-03-09', period: 'PM' },
      holidays: [],
    });
    expect(r.totalUnits).toBe(5);
  });

  it('medio día en mitad de un rango → error', () => {
    expect(() =>
      computeRequest({
        startDate: '2026-03-09',
        endDate: '2026-03-11',
        halfDay: { date: '2026-03-10', period: 'AM' },
        holidays: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'HALF_DAY_NOT_AT_EDGE' }));
  });

  it('medio día en festivo → error', () => {
    expect(() =>
      computeRequest({
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        halfDay: { date: '2026-05-01', period: 'AM' },
        holidays: [H('2026-05-01')],
      }),
    ).toThrowError(expect.objectContaining({ code: 'HALF_DAY_NOT_COMPUTABLE' }));
  });

  it('medio día en fin de semana → error', () => {
    expect(() =>
      computeRequest({
        startDate: '2026-03-06',
        endDate: '2026-03-07',
        halfDay: { date: '2026-03-07', period: 'AM' },
        holidays: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'HALF_DAY_NOT_COMPUTABLE' }));
  });

  it('medio día fuera del rango → error', () => {
    expect(() =>
      computeRequest({
        startDate: '2026-03-09',
        endDate: '2026-03-10',
        halfDay: { date: '2026-03-12', period: 'AM' },
        holidays: [],
      }),
    ).toThrowError(expect.objectContaining({ code: 'HALF_DAY_OUT_OF_RANGE' }));
  });

  it('rango invertido → error', () => {
    expect(() => computeRequest({ startDate: '2026-03-10', endDate: '2026-03-09', holidays: [] })).toThrowError(
      expect.objectContaining({ code: 'INVERTED_RANGE' }),
    );
  });

  it('fecha mal formada → error', () => {
    expect(() => computeRequest({ startDate: '2026-3-10', endDate: '2026-03-12', holidays: [] })).toThrowError(
      EngineError,
    );
    expect(() => computeRequest({ startDate: '2026-02-30', endDate: '2026-03-02', holidays: [] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE' }),
    );
  });

  it('un solo día en fin de semana → error de "no computa nada"', () => {
    expect(() => computeRequest({ startDate: '2026-03-07', endDate: '2026-03-07', holidays: [] })).toThrowError(
      expect.objectContaining({ code: 'NOTHING_TO_COMPUTE' }),
    );
  });

  it('un rango de solo festivo + fin de semana → error de "no computa nada"', () => {
    expect(() =>
      computeRequest({ startDate: '2026-05-01', endDate: '2026-05-03', holidays: [H('2026-05-01')] }),
    ).toThrowError(expect.objectContaining({ code: 'NOTHING_TO_COMPUTE' }));
  });

  it('años bisiestos: incluye el 29 de febrero', () => {
    const r = computeRequest({ startDate: '2028-02-28', endDate: '2028-03-01', holidays: [] });
    expect(r.days.map((d) => d.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(r.totalUnits).toBe(6);
  });

  it('año no bisiesto: del 28 de febrero salta al 1 de marzo', () => {
    const r = computeRequest({ startDate: '2027-02-26', endDate: '2027-03-01', holidays: [] });
    expect(r.days.map((d) => d.date)).toEqual(['2027-02-26', '2027-02-27', '2027-02-28', '2027-03-01']);
  });

  it('cambios de hora de marzo y octubre no afectan', () => {
    // En 2026 el cambio de hora es el 29-03 y el 25-10
    const march = computeRequest({ startDate: '2026-03-27', endDate: '2026-03-31', holidays: [] });
    expect(march.days.map((d) => d.date)).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]);
    expect(march.totalUnits).toBe(6);
    const oct = computeRequest({ startDate: '2026-10-23', endDate: '2026-10-27', holidays: [] });
    expect(oct.days.map((d) => d.date)).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(oct.totalUnits).toBe(6);
  });

  it('modo lenient (recalcular existentes): no falla si todo pasa a festivo', () => {
    const r = computeRequest({
      startDate: '2026-05-01',
      endDate: '2026-05-01',
      halfDay: { date: '2026-05-01', period: 'AM' },
      holidays: [H('2026-05-01')],
      lenient: true,
    });
    expect(r.totalUnits).toBe(0);
    expect(r.days[0]).toEqual({ date: '2026-05-01', units: 0, reason: 'holiday-national' });
  });

  it('weekendDays configurable', () => {
    const r = computeRequest({ startDate: '2026-03-06', endDate: '2026-03-07', holidays: [], weekendDays: [5] });
    expect(r.days[0]!.units).toBe(0);
    expect(r.days[1]!.units).toBe(2);
  });
});

describe('splitByYear (SPEC-06)', () => {
  it('parte una solicitud que cruza de año', () => {
    const r = computeRequest({
      startDate: '2026-12-28',
      endDate: '2027-01-08',
      holidays: [H('2027-01-01'), H('2027-01-06'), H('2026-12-25')],
    });
    const split = splitByYear(r);
    // 2026: 28,29,30,31 → 4 laborables = 8
    // 2027: 1 (festivo), 2-3 finde, 4,5 laborables, 6 festivo, 7,8 laborables → 4 laborables = 8
    expect(split).toEqual([
      { year: 2026, units: 8 },
      { year: 2027, units: 8 },
    ]);
    expect(r.totalUnits).toBe(16);
  });

  it('una solicitud de un solo año devuelve una sola parte', () => {
    const r = computeRequest({ startDate: '2026-03-09', endDate: '2026-03-10', holidays: [] });
    expect(splitByYear(r)).toEqual([{ year: 2026, units: 4 }]);
  });
});

describe('describeComputation (SPEC-06)', () => {
  it('genera el texto de desglose', () => {
    const r = computeRequest({
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      holidays: [H('2026-05-01'), H('2026-05-04', 'regional')],
    });
    // 10 naturales; finde: 2,3,9,10 → 4; festivos 1,4 → 2; laborables 4
    expect(describeComputation(r)).toBe('10 días naturales → 4 laborables (2 festivos, 4 fines de semana)');
  });

  it('usa singular y medios días', () => {
    const r = computeRequest({
      startDate: '2026-03-10',
      endDate: '2026-03-10',
      halfDay: { date: '2026-03-10', period: 'PM' },
      holidays: [],
    });
    expect(describeComputation(r)).toBe('1 día natural → 0,5 laborables');
  });
});
