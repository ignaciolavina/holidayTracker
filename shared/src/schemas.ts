import { z } from 'zod';
import { isValidDate, isValidMonthDay } from './dates';
import {
  APPROVAL_POLICIES,
  BIRTHDAY_WINDOW_MODES,
  BUCKETS,
  HALF_DAY_PERIODS,
  HOLIDAY_SCOPES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  ROLES,
  TEAM_VISIBILITY,
} from './types';

/** Schemas Zod de entrada de la API (compartidos para validar también en el front). */

export const zDate = z.string().refine(isValidDate, 'Fecha inválida (AAAA-MM-DD)');
export const zMonthDay = z.string().refine(isValidMonthDay, 'Cumpleaños inválido (MM-DD)');
export const zObjectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Identificador inválido');
export const zEmail = z.string().trim().toLowerCase().email('Email inválido').max(200);
export const zPassword = z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(200);
export const zReason = z.string().trim().min(3, 'El motivo es obligatorio').max(1000);
/** días en múltiplos de 0,5 */
export const zDays = z
  .number()
  .refine((n) => Number.isInteger(n * 2), 'Los días deben ser múltiplos de 0,5')
  .refine((n) => Math.abs(n) <= 366, 'Valor fuera de rango');

export const loginSchema = z.object({ email: zEmail, password: z.string().min(1).max(200) });
export const forgotSchema = z.object({ email: zEmail });
export const resetSchema = z.object({ token: z.string().min(10).max(200), password: zPassword });
export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(200),
  password: zPassword,
  birthday: zMonthDay.optional(),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: zPassword });
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});
export const setBirthdaySchema = z.object({ birthday: zMonthDay });

export const inviteSchema = z.object({
  email: zEmail,
  name: z.string().trim().min(2).max(100),
  role: z.enum(ROLES),
  managerId: zObjectId.nullable(),
  holidayCalendarId: zObjectId.optional(),
  hireDate: zDate,
  annualDays: zDays.refine((n) => n >= 0, 'Valor fuera de rango').optional(),
  birthday: zMonthDay.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(ROLES).optional(),
  managerId: zObjectId.nullable().optional(),
  holidayCalendarId: zObjectId.optional(),
  hireDate: zDate.optional(),
  annualDays: zDays.refine((n) => n >= 0, 'Valor fuera de rango').optional(),
  /** desde qué fecha aplican los nuevos días anuales (por defecto hoy) */
  annualDaysFrom: zDate.optional(),
  birthday: zMonthDay.nullable().optional(),
  reason: zReason.optional(),
});

export const deactivateSchema = z.object({ leaveDate: zDate, reason: zReason.optional() });

export const halfDaySchema = z.object({ date: zDate, period: z.enum(HALF_DAY_PERIODS) });

export const requestInputSchema = z.object({
  kind: z.enum(REQUEST_KINDS).default('VACATION'),
  startDate: zDate,
  endDate: zDate,
  halfDay: halfDaySchema.nullable().optional(),
  comment: z.string().trim().max(500).optional(),
  replacesRequestId: zObjectId.optional(),
});

export const previewSchema = requestInputSchema.extend({ userId: zObjectId.optional() });

export const retroactiveSchema = requestInputSchema.omit({ replacesRequestId: true }).extend({
  userId: zObjectId,
  reason: zReason,
  confirmText: z.literal('REGISTRAR', { errorMap: () => ({ message: 'Escribe REGISTRAR para confirmar' }) }),
});

export const rejectSchema = z.object({ reason: zReason });
export const approveSchema = z.object({ acknowledgeStarted: z.boolean().optional() });
export const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const revokeSchema = z.object({
  fromDate: zDate.optional(),
  reason: zReason,
  confirmText: z.literal('ANULAR', { errorMap: () => ({ message: 'Escribe ANULAR para confirmar' }) }),
});
export const revokePreviewSchema = z.object({ fromDate: zDate.optional() });

export const requestListQuery = z.object({
  userId: zObjectId.optional(),
  status: z.enum(REQUEST_STATUSES).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const adjustmentSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  bucket: z.enum(BUCKETS),
  days: zDays.refine((n) => n !== 0, 'El ajuste no puede ser 0'),
  reason: zReason,
});

export const holidayInputSchema = z.object({
  date: zDate,
  name: z.string().trim().min(2).max(100),
  scope: z.enum(HOLIDAY_SCOPES),
  calendarIds: z.array(zObjectId).min(1).optional(),
});

export const holidayMutationSchema = holidayInputSchema.extend({
  /** hay que confirmar si afecta a solicitudes aprobadas */
  confirm: z.boolean().optional(),
  confirmText: z.string().optional(),
  reason: z.string().trim().max(1000).optional(),
});

export const holidayDeleteSchema = z.object({
  confirm: z.boolean().optional(),
  confirmText: z.string().optional(),
  reason: z.string().trim().max(1000).optional(),
});

export const holidayImpactSchema = z.object({
  op: z.enum(['create', 'update', 'delete']),
  id: zObjectId.optional(),
  date: zDate.optional(),
  scope: z.enum(HOLIDAY_SCOPES).optional(),
  calendarIds: z.array(zObjectId).optional(),
});

export const importPreviewSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export const importConfirmSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  calendarId: zObjectId.optional(),
  holidays: z.array(z.object({ date: zDate, name: z.string().trim().min(1).max(100), scope: z.enum(HOLIDAY_SCOPES) })),
});

export const settingsPatchSchema = z
  .object({
    defaultAnnualUnits: z.number().int().min(0).max(732),
    birthdayEnabled: z.boolean(),
    birthdayWindow: z.object({ mode: z.enum(BIRTHDAY_WINDOW_MODES), days: z.number().int().min(0).max(183) }),
    negativeLimitUnits: z.number().int().min(0).max(732),
    carryoverCapUnits: z.number().int().min(0).max(732),
    approvalPolicy: z.enum(APPROVAL_POLICIES),
    escalationHours: z.number().int().min(1).max(24 * 30),
    teamVisibility: z.enum(TEAM_VISIBILITY),
    teamOutThreshold: z.number().int().min(1).max(1000),
    weekendDays: z.array(z.number().int().min(0).max(6)).max(6),
    futureYearsAllowed: z.number().int().min(0).max(3),
  })
  .partial()
  .extend({ reason: z.string().trim().max(1000).optional() });

export const teamCalendarQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  scope: z.enum(['all', 'branch', 'manager']).default('all'),
  managerId: zObjectId.optional(),
});

export const auditQuery = z.object({
  actorId: zObjectId.optional(),
  targetId: zObjectId.optional(),
  action: z.string().max(60).optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  sensitive: z.enum(['1', '0']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export type RequestInputParsed = z.infer<typeof requestInputSchema>;
