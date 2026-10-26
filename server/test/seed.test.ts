import { describe, expect, it } from 'vitest';
import { Holiday, LedgerEntry, User, VacationRequest } from '../src/models';
import { runSeed } from '../src/scripts/seedData';
import { useDb } from './helpers';

useDb('seed');

describe('seed de desarrollo (SPEC-20)', () => {
  it('crea usuarios, festivos, solicitudes en todos los estados, arrastres, deuda y un cumpleaños', async () => {
    await runSeed();

    expect(await User.countDocuments({ status: 'active' })).toBe(9);
    expect(await Holiday.countDocuments({ year: 2026 })).toBeGreaterThan(0);
    expect(await Holiday.countDocuments({ year: 2027 })).toBeGreaterThan(0);

    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED']) {
      expect(await VacationRequest.exists({ status })).toBeTruthy();
    }
    expect(await LedgerEntry.exists({ type: 'CARRYOVER_IN' })).toBeTruthy();
    expect(await LedgerEntry.exists({ type: 'NEGATIVE_CARRYOVER' })).toBeTruthy();
    expect(await VacationRequest.exists({ kind: 'BIRTHDAY' })).toBeTruthy();
  }, 120_000);
});
