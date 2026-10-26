import type { ClientSession } from 'mongoose';
import { AuditLog } from '../models';
import type { Actor } from './actor';

/**
 * Eventos de auditoría (SPEC-11 punto 11 / SPEC-12). Se llaman desde los servicios de dominio.
 */
export const AUDIT_ACTIONS = [
  // solicitudes
  'REQUEST_CREATED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'REQUEST_REVOKED',
  'REQUEST_RETROACTIVE',
  'REQUEST_AUTO_APPROVED_NO_APPROVER',
  'REQUEST_ESCALATED',
  // saldo
  'BALANCE_ADJUSTED',
  'PRORATION_ADJUSTED',
  // usuarios
  'USER_INVITED',
  'INVITATION_RESENT',
  'INVITATION_REVOKED',
  'USER_ACTIVATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'USER_ANNUAL_DAYS_CHANGED',
  'USER_HIRE_DATE_CHANGED',
  'USER_BIRTHDAY_SET',
  'USER_BIRTHDAY_CHANGED',
  'USER_MANAGER_CHANGED',
  'USER_ROLE_CHANGED',
  'USER_CALENDAR_CHANGED',
  'USER_PASSWORD_RESET',
  // festivos
  'HOLIDAY_CREATED',
  'HOLIDAY_UPDATED',
  'HOLIDAY_DELETED',
  'HOLIDAYS_IMPORTED',
  'HOLIDAY_RECALC_APPLIED',
  // sistema
  'SETTINGS_CHANGED',
  'JOB_RUN_MANUAL',
  'YEAR_CLOSED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Lo que aparece en "Actividad sensible" (SPEC-11 punto 12) */
export const SENSITIVE_ACTIONS: AuditAction[] = [
  'REQUEST_REVOKED',
  'REQUEST_RETROACTIVE',
  'BALANCE_ADJUSTED',
  'REQUEST_AUTO_APPROVED_NO_APPROVER',
  'HOLIDAY_RECALC_APPLIED',
  'USER_BIRTHDAY_CHANGED',
];

export interface AuditTarget {
  type: 'user' | 'request' | 'holiday' | 'invitation' | 'settings' | 'ledger' | 'job' | 'year';
  id: string | null | { toString(): string };
}

function plain(v: unknown): unknown {
  if (v === undefined) return null;
  return JSON.parse(JSON.stringify(v));
}

export const audit = {
  async log(
    actor: Actor,
    action: AuditAction,
    target: AuditTarget,
    before: unknown,
    after: unknown,
    reason: string | null,
    session?: ClientSession,
  ): Promise<string> {
    const [doc] = await AuditLog.create(
      [
        {
          actorId: actor.id,
          action,
          targetType: target.type,
          targetId: target.id ? String(target.id) : null,
          before: plain(before),
          after: plain(after),
          reason,
          ip: actor.ip ?? null,
        },
      ],
      { session },
    );
    return String(doc!._id);
  },
};
