/** Los saldos se guardan como enteros de medios días: 1 día = 2 unidades. */

export const UNITS_PER_DAY = 2;

export function daysToUnits(days: number): number {
  const units = days * UNITS_PER_DAY;
  if (!Number.isInteger(units)) throw new Error('Los días deben ser múltiplos de 0,5');
  return units;
}

export function unitsToDays(units: number): number {
  return units / UNITS_PER_DAY;
}

/** "1,5" · "-3" · "0,5" */
export function formatUnits(units: number): string {
  const days = unitsToDays(units);
  return Number.isInteger(days) ? String(days) : days.toFixed(1).replace('.', ',');
}

/** "1 día" · "2,5 días" */
export function formatUnitsWithLabel(units: number): string {
  return `${formatUnits(units)} ${Math.abs(units) === UNITS_PER_DAY ? 'día' : 'días'}`;
}
