/**
 * Contrato HTTP entre server y client. Todas las cantidades de saldo van en UNIDADES (medios días).
 * Fechas de calendario: `YYYY-MM-DD`. Instantes: ISO 8601 (string).
 */
import type { ComputedDay } from './engine/computeRequest';
import type {
  Bucket,
  HalfDayPeriod,
  HolidayScope,
  LedgerType,
  RequestKind,
  RequestStatus,
  Role,
  Settings,
  UserStatus,
} from './types';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ───────── Usuarios ─────────

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  avatarUrl: string | null;
  managerId: string | null;
  holidayCalendarId: string;
  hireDate: string;
  leaveDate: string | null;
  birthday: string | null; // MM-DD
  birthdayLocked: boolean;
  annualUnits: number;
}

/** Lo que cualquier usuario ve de los demás (sin saldos) */
export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  managerId: string | null;
}

/** Vista de admin */
export interface UserDetail extends Me {
  createdAt: string;
  directReportsCount: number;
}

export interface InvitationDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'pending' | 'used' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export interface InvitationInfo {
  email: string;
  name: string;
  needsBirthday: boolean;
}

export interface SettlementDto {
  userId: string;
  year: number;
  leaveDate: string;
  entitlementUnits: number;
  /** positivo = días a favor del empleado; negativo = en contra */
  settlementUnits: number;
}

export interface OrgNode {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  status: UserStatus;
  managerId: string | null;
  outToday: boolean;
  /** Solo para admins */
  availableUnits?: number;
  /** Aprobador asignado (informativo): el manager directo */
  assignedApproverId: string | null;
  /** A quién se avisa si la solicitud se queda pendiente */
  escalationIds: string[];
  directReports: number;
}

// ───────── Festivos ─────────

export interface HolidayCalendarDto {
  id: string;
  name: string;
  regionCode: string;
  localityName: string;
  isDefault: boolean;
}

export interface HolidayDto {
  id: string;
  date: string;
  name: string;
  scope: HolidayScope;
  calendarIds: string[];
  source: 'import' | 'manual';
  year: number;
  /** año cerrado: solo lectura */
  locked: boolean;
}

export interface HolidayDraftItem {
  date: string;
  name: string;
  scope: HolidayScope;
}

export interface HolidayImpactItem {
  requestId: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  status: RequestStatus;
  /** + = se devuelven unidades al usuario; − = se le cargan */
  deltaUnits: number;
  touchesEnjoyed: boolean;
}

export interface HolidayImpact {
  affected: HolidayImpactItem[];
  totalDeltaUnits: number;
  touchesEnjoyed: boolean;
}

// ───────── Solicitudes ─────────

export interface RequestDayAllocation {
  date: string;
  year: number;
  bucket: Bucket;
  units: number;
}

export interface VacationRequestDto {
  id: string;
  userId: string;
  userName: string;
  kind: RequestKind;
  startDate: string;
  endDate: string;
  halfDay: { date: string; period: HalfDayPeriod } | null;
  status: RequestStatus;
  units: number;
  /** cómputo día a día */
  days: ComputedDay[];
  /** bolsa asignada (solo si APPROVED/REVOKED; si PENDING es la previsión) */
  allocation: RequestDayAllocation[];
  comment: string | null;
  approverId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  replacesRequestId: string | null;
  revokedFromDate: string | null;
  urgent: boolean;
  escalatedAt: string | null;
  retroactive: boolean;
  createdAt: string;
  /** acciones que el usuario actual puede hacer */
  can: { cancel: boolean; modify: boolean; approve: boolean; reject: boolean; revoke: boolean };
}

export interface RequestInput {
  kind: RequestKind;
  startDate: string;
  endDate: string;
  halfDay?: { date: string; period: HalfDayPeriod } | null;
  comment?: string;
  replacesRequestId?: string;
}

export interface PreviewMessage {
  code: string;
  message: string;
}

export interface RequestPreview {
  /** null si el cómputo falla (ver errors) */
  computation: {
    days: ComputedDay[];
    totalUnits: number;
    calendarDays: number;
    weekendCount: number;
    holidayCount: number;
    summary: string;
  } | null;
  allocation: Array<{ year: number; bucket: Bucket; units: number }>;
  /** saldo disponible (ya descontado lo reservado) antes y después, por año */
  balanceByYear: Array<{ year: number; availableBeforeUnits: number; availableAfterUnits: number }>;
  negativeLimitUnits: number;
  /** avisos que no bloquean (negativo, arrastrados, solape con equipo…) */
  warnings: PreviewMessage[];
  /** errores que bloquean el envío */
  errors: PreviewMessage[];
  teamOverlap: Array<{ date: string; count: number }>;
}

// ───────── Saldos ─────────

export interface BalanceDto {
  userId: string;
  year: number;
  /** saldo del ledger por bolsa */
  ledger: { current: number; carryover: number; birthday: number };
  /** reservado por solicitudes pendientes */
  reserved: { current: number; carryover: number; birthday: number };
  /** ledger − reservado */
  available: { current: number; carryover: number; birthday: number; total: number };
  enjoyedUnits: number;
  plannedUnits: number;
  pendingUnits: number;
  entitlementUnits: number;
  carryoverExpiresOn: string;
  negativeLimitUnits: number;
  yearClosed: boolean;
  birthday: {
    date: string | null;
    status: 'unset' | 'not-eligible' | 'available' | 'requested' | 'approved' | 'enjoyed' | 'expired' | 'disabled';
    requestId: string | null;
    window: { from: string; to: string; movable: boolean } | null;
  };
}

export interface BalanceRow extends BalanceDto {
  userName: string;
  status: UserStatus;
}

export interface LedgerEntryDto {
  id: string;
  year: number;
  bucket: Bucket;
  type: LedgerType;
  units: number;
  requestId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

// ───────── Calendario ─────────

export interface CalendarAbsence {
  requestId: string;
  userId: string;
  date: string;
  units: number;
  period: HalfDayPeriod | null;
  status: 'PENDING' | 'APPROVED';
  kind: RequestKind;
  /** solo en la vista propia o de admin */
  bucket?: Bucket;
}

export interface UserCalendarDto {
  userId: string;
  year: number;
  holidays: HolidayDto[];
  absences: CalendarAbsence[];
  requests: VacationRequestDto[];
  birthdayDate: string | null;
}

export interface TeamCalendarDto {
  month: string; // YYYY-MM
  users: UserSummary[];
  days: Array<{ date: string; weekend: boolean; holiday: { name: string; scope: HolidayScope } | null }>;
  absences: CalendarAbsence[];
  totals: Array<{ date: string; count: number }>;
  threshold: number;
}

export interface OutDto {
  from: string;
  to: string;
  absences: Array<CalendarAbsence & { userName: string; avatarUrl: string | null }>;
}

// ───────── Notificaciones, auditoría, jobs ─────────

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
  sensitive: boolean;
}

export interface JobRunDto {
  id: string;
  job: string;
  key: string;
  status: 'running' | 'done' | 'failed';
  trigger: 'cron' | 'manual' | 'catchup';
  startedAt: string;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
}

export interface AdminOverviewDto {
  toApprove: VacationRequestDto[];
  /** pendientes visibles que no me toca aprobar (p. ej. las mías o, con política "chain", fuera de mi cadena) */
  otherPending: VacationRequestDto[];
  escalated: VacationRequestDto[];
  outToday: OutDto['absences'];
  alerts: Array<{ code: string; level: 'info' | 'warning' | 'danger'; message: string; link?: string }>;
  recentSensitive: AuditLogDto[];
}

export type SettingsDto = Settings;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
