import { describe, expect, it } from 'vitest';
import { activeDaysInYear, entitlementUnits, prorate } from './proration';
import { allocateDays } from './allocation';
import { birthdayEligible, birthdayWindow, validateBirthdayDate } from './birthday';
import { checkNegativeLimit } from './limits';

describe('prorrata (SPEC-07)', () => {
  it('alta el 1 de enero → año completo', () => {
    expect(activeDaysInYear(2026, '2026-01-01')).toBe(365);
    expect(entitlementUnits(2026, { hireDate: '2026-01-01', annualHistory: [{ from: '2026-01-01', units: 48 }] })).toBe(
      48,
    );
  });

  it('alta el 15 de junio → 200 días activos, redondeado al medio día más cercano', () => {
    expect(activeDaysInYear(2026, '2026-06-15')).toBe(200);
    // 48 × 200 / 365 = 26,30 → 26 unidades (13 días)
    expect(entitlementUnits(2026, { hireDate: '2026-06-15', annualHistory: [{ from: '2026-06-15', units: 48 }] })).toBe(
      26,
    );
  });

  it('alta el 31 de diciembre → 1 día activo → 0 unidades', () => {
    expect(activeDaysInYear(2026, '2026-12-31')).toBe(1);
    expect(entitlementUnits(2026, { hireDate: '2026-12-31', annualHistory: [{ from: '2026-12-31', units: 48 }] })).toBe(
      0,
    );
  });

  it('alta anterior al año → año completo; baja en el año → prorrata', () => {
    expect(activeDaysInYear(2026, '2020-03-01')).toBe(365);
    // baja el 30-06-2026: 181 días → 48×181/365 = 23,80 → 24
    expect(
      entitlementUnits(2026, {
        hireDate: '2020-03-01',
        leaveDate: '2026-06-30',
        annualHistory: [{ from: '2020-03-01', units: 48 }],
      }),
    ).toBe(24);
  });

  it('año bisiesto usa 366 días', () => {
    expect(activeDaysInYear(2028, '2028-01-01')).toBe(366);
    // alta el 01-07-2028: 184 días → 48×184/366 = 24,13 → 24
    expect(entitlementUnits(2028, { hireDate: '2028-07-01', annualHistory: [{ from: '2028-07-01', units: 48 }] })).toBe(
      24,
    );
  });

  it('fuera del periodo activo → 0', () => {
    expect(activeDaysInYear(2025, '2026-01-01')).toBe(0);
    expect(activeDaysInYear(2027, '2020-01-01', '2026-12-31')).toBe(0);
  });

  it('cambio de días anuales a mitad de año → prorrata por tramos', () => {
    // 48 hasta el 30-06 (181 días), 52 desde el 01-07 (184 días)
    // (48×181 + 52×184) / 365 = (8688 + 9568)/365 = 50,02 → 50
    expect(
      entitlementUnits(2026, {
        hireDate: '2020-01-01',
        annualHistory: [
          { from: '2020-01-01', units: 48 },
          { from: '2026-07-01', units: 52 },
        ],
      }),
    ).toBe(50);
  });

  it('prorate redondea al medio día más cercano', () => {
    expect(prorate(48, 365, 365)).toBe(48);
    expect(prorate(48, 4, 365)).toBe(1); // 0,526 → 1
    expect(prorate(48, 3, 365)).toBe(0); // 0,39 → 0
  });
});

describe('asignación por bolsas (SPEC-07)', () => {
  const days = (dates: string[], units: 0 | 1 | 2 = 2) => dates.map((date) => ({ date, units }));

  it('días ≤ caducidad salen primero de CARRYOVER y luego de CURRENT', () => {
    const r = allocateDays({
      kind: 'VACATION',
      days: days(['2027-02-25', '2027-02-26', '2027-03-01']),
      carryover: { 2027: { availableUnits: 3, expiresOn: '2027-02-28' } },
    });
    expect(r.perDay).toEqual([
      { date: '2027-02-25', year: 2027, bucket: 'CARRYOVER', units: 2 },
      { date: '2027-02-26', year: 2027, bucket: 'CARRYOVER', units: 1 },
      { date: '2027-02-26', year: 2027, bucket: 'CURRENT', units: 1 },
      { date: '2027-03-01', year: 2027, bucket: 'CURRENT', units: 2 },
    ]);
    expect(r.totals).toEqual([
      { year: 2027, bucket: 'CARRYOVER', units: 3 },
      { year: 2027, bucket: 'CURRENT', units: 3 },
    ]);
  });

  it('días posteriores a febrero siempre van a CURRENT aunque haya arrastrados', () => {
    const r = allocateDays({
      kind: 'VACATION',
      days: days(['2027-03-02']),
      carryover: { 2027: { availableUnits: 10, expiresOn: '2027-02-28' } },
    });
    expect(r.totals).toEqual([{ year: 2027, bucket: 'CURRENT', units: 2 }]);
    expect(r.usesCurrentWhileCarryoverAvailable).toBe(true);
  });

  it('sin arrastrados todo va a CURRENT y omite días de 0', () => {
    const r = allocateDays({
      kind: 'VACATION',
      days: [
        { date: '2026-03-06', units: 2 },
        { date: '2026-03-07', units: 0 },
      ],
      carryover: {},
    });
    expect(r.perDay).toEqual([{ date: '2026-03-06', year: 2026, bucket: 'CURRENT', units: 2 }]);
  });

  it('solicitudes que cruzan de año cargan cada día a su año', () => {
    const r = allocateDays({
      kind: 'VACATION',
      days: days(['2026-12-31', '2027-01-04']),
      carryover: { 2027: { availableUnits: 2, expiresOn: '2027-02-28' } },
    });
    expect(r.totals).toEqual([
      { year: 2026, bucket: 'CURRENT', units: 2 },
      { year: 2027, bucket: 'CARRYOVER', units: 2 },
    ]);
  });

  it('cumpleaños va siempre a BIRTHDAY', () => {
    const r = allocateDays({ kind: 'BIRTHDAY', days: days(['2026-06-10']), carryover: {} });
    expect(r.totals).toEqual([{ year: 2026, bucket: 'BIRTHDAY', units: 2 }]);
  });
});

describe('límite negativo (SPEC-07)', () => {
  it('−5 días se permite (con aviso), −5,5 se bloquea', () => {
    expect(checkNegativeLimit({ availableUnits: 0, requestUnits: 10, negativeLimitUnits: 10 })).toEqual({
      ok: true,
      resultingUnits: -10,
      negative: true,
    });
    expect(checkNegativeLimit({ availableUnits: 0, requestUnits: 11, negativeLimitUnits: 10 })).toEqual({
      ok: false,
      resultingUnits: -11,
      negative: true,
    });
    expect(checkNegativeLimit({ availableUnits: 20, requestUnits: 10, negativeLimitUnits: 10 })).toEqual({
      ok: true,
      resultingUnits: 10,
      negative: false,
    });
  });
});

describe('cumpleaños (SPEC-08)', () => {
  const computable = (date: string) => !['2026-06-13', '2026-06-14', '2026-06-20', '2026-06-21'].includes(date);

  it('elegible si el alta es anterior o igual al cumpleaños de ese año', () => {
    expect(birthdayEligible(2026, '06-10', '2026-06-10')).toBe(true);
    expect(birthdayEligible(2026, '06-10', '2026-06-11')).toBe(false);
    expect(birthdayEligible(2026, '06-10', '2020-01-01')).toBe(true);
    expect(birthdayEligible(2026, '06-10', '2020-01-01', '2026-06-09')).toBe(false);
    expect(birthdayEligible(2025, '06-10', '2026-01-01')).toBe(false);
  });

  it('29-02 se trata como 28-02 en años no bisiestos', () => {
    expect(birthdayWindow(2027, '02-29', { mode: 'sameMonth', days: 0 }, () => true).birthday).toBe('2027-02-28');
    expect(birthdayWindow(2028, '02-29', { mode: 'sameMonth', days: 0 }, () => true).birthday).toBe('2028-02-29');
  });

  it('si cae en laborable, el día es el propio cumpleaños', () => {
    const w = birthdayWindow(2026, '06-10', { mode: 'sameMonth', days: 0 }, computable);
    expect(w).toEqual({ birthday: '2026-06-10', movable: false, from: '2026-06-10', to: '2026-06-10' });
    expect(validateBirthdayDate('2026-06-10', w, computable)).toBeNull();
    expect(validateBirthdayDate('2026-06-11', w, computable)).toBe('BIRTHDAY_MUST_BE_EXACT');
  });

  it('si cae en fin de semana se puede mover a un laborable del mismo mes', () => {
    const w = birthdayWindow(2026, '06-13', { mode: 'sameMonth', days: 0 }, computable);
    expect(w).toEqual({ birthday: '2026-06-13', movable: true, from: '2026-06-01', to: '2026-06-30' });
    expect(validateBirthdayDate('2026-06-15', w, computable)).toBeNull();
    expect(validateBirthdayDate('2026-07-01', w, computable)).toBe('BIRTHDAY_OUT_OF_WINDOW');
    expect(validateBirthdayDate('2026-06-14', w, computable)).toBe('BIRTHDAY_NOT_COMPUTABLE');
  });

  it('ventana ±N días y todo el año', () => {
    expect(birthdayWindow(2026, '06-13', { mode: 'plusMinusDays', days: 5 }, computable)).toMatchObject({
      from: '2026-06-08',
      to: '2026-06-18',
    });
    expect(birthdayWindow(2026, '06-13', { mode: 'year', days: 0 }, computable)).toMatchObject({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    // ±N no se sale del año
    expect(birthdayWindow(2026, '12-27', { mode: 'plusMinusDays', days: 10 }, () => false)).toMatchObject({
      from: '2026-12-17',
      to: '2026-12-31',
    });
  });
});
