export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const HOLIDAY_SCOPES = ['national', 'regional', 'local'] as const;
export type HolidayScope = (typeof HOLIDAY_SCOPES)[number];

export const REQUEST_KINDS = ['VACATION', 'BIRTHDAY'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const HALF_DAY_PERIODS = ['AM', 'PM'] as const;
export type HalfDayPeriod = (typeof HALF_DAY_PERIODS)[number];

export const BUCKETS = ['CURRENT', 'CARRYOVER', 'BIRTHDAY'] as const;
export type Bucket = (typeof BUCKETS)[number];

export const LEDGER_TYPES = [
  'ANNUAL_ALLOWANCE',
  'BIRTHDAY_ALLOWANCE',
  'CARRYOVER_IN',
  'CARRYOVER_EXPIRY',
  'BIRTHDAY_EXPIRY',
  'NEGATIVE_CARRYOVER',
  'CONSUMPTION',
  'REFUND',
  'REALLOCATION',
  'HOLIDAY_RECALC',
  'ADJUSTMENT',
  'PRORATION_ADJUSTMENT',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const BIRTHDAY_WINDOW_MODES = ['sameMonth', 'plusMinusDays', 'year'] as const;
export type BirthdayWindowMode = (typeof BIRTHDAY_WINDOW_MODES)[number];

export const APPROVAL_POLICIES = ['any_admin', 'chain'] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const TEAM_VISIBILITY = ['company', 'branch'] as const;
export type TeamVisibility = (typeof TEAM_VISIBILITY)[number];

/** Configuración global (sección 0 y 8). Unidades en medios días. */
export interface Settings {
  defaultAnnualUnits: number; // 48
  birthdayEnabled: boolean;
  birthdayWindow: { mode: BirthdayWindowMode; days: number };
  negativeLimitUnits: number; // 10 (= 5 días)
  carryoverCapUnits: number; // 0 = sin tope
  approvalPolicy: ApprovalPolicy;
  escalationHours: number; // 48
  teamVisibility: TeamVisibility;
  teamOutThreshold: number; // personas fuera para resaltar
  weekendDays: number[]; // [6, 0]
  futureYearsAllowed: number; // 1 → hasta el 31-12 del año siguiente
}

export const DEFAULT_SETTINGS: Settings = {
  defaultAnnualUnits: 48,
  birthdayEnabled: true,
  birthdayWindow: { mode: 'sameMonth', days: 15 },
  negativeLimitUnits: 10,
  carryoverCapUnits: 0,
  approvalPolicy: 'any_admin',
  escalationHours: 48,
  teamVisibility: 'company',
  teamOutThreshold: 3,
  weekendDays: [6, 0],
  futureYearsAllowed: 1,
};
