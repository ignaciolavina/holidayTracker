import mongoose, { Schema, type InferSchemaType, type HydratedDocument, type Types } from 'mongoose';
import {
  BUCKETS,
  HALF_DAY_PERIODS,
  HOLIDAY_SCOPES,
  LEDGER_TYPES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  ROLES,
  USER_STATUSES,
} from '@ht/shared';

import { clock } from '../lib/clock';

const { ObjectId } = Schema.Types;
// los timestamps usan el reloj inyectable (tests y jobs simulados)
const currentTime = () => clock.now();
const opts = { timestamps: { createdAt: true, updatedAt: true, currentTime }, versionKey: false } as const;

/** Bloquea modificaciones y borrados: colecciones de solo inserción (ledger, auditoría). */
function appendOnly(schema: Schema, label: string) {
  const ops = [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ] as const;
  for (const op of ops) {
    schema.pre(op, function () {
      throw new Error(`${label} solo admite inserciones`);
    });
  }
  schema.pre('save', function () {
    if (!this.isNew) throw new Error(`${label} solo admite inserciones`);
  });
}

// ───────── users ─────────
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, default: null },
    role: { type: String, enum: ROLES, required: true, default: 'user' },
    managerId: { type: ObjectId, ref: 'User', default: null, index: true },
    holidayCalendarId: { type: ObjectId, ref: 'HolidayCalendar', required: true },
    hireDate: { type: String, required: true },
    leaveDate: { type: String, default: null },
    birthday: { type: String, default: null },
    birthdayLocked: { type: Boolean, default: false },
    annualUnits: { type: Number, required: true },
    annualHistory: { type: [{ _id: false, from: String, units: Number }], default: [] },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'invited' },
    tokenVersion: { type: Number, default: 0 },
    avatarUrl: { type: String, default: null },
  },
  opts,
);
export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = mongoose.model('User', userSchema);

// ───────── invitations ─────────
const invitationSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    name: { type: String, required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: ObjectId, ref: 'User', required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  opts,
);
export const Invitation = mongoose.model('Invitation', invitationSchema);

// ───────── sessions (refresh rotativo) ─────────
const sessionSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, index: true },
    family: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
  },
  opts,
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = mongoose.model('Session', sessionSchema);

// ───────── password resets ─────────
const passwordResetSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  opts,
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);

// ───────── holidays ─────────
const holidayCalendarSchema = new Schema(
  {
    name: { type: String, required: true },
    regionCode: { type: String, default: 'ES-MD' },
    localityName: { type: String, default: 'Madrid' },
    isDefault: { type: Boolean, default: false },
  },
  opts,
);
export const HolidayCalendar = mongoose.model('HolidayCalendar', holidayCalendarSchema);

const holidaySchema = new Schema(
  {
    date: { type: String, required: true },
    name: { type: String, required: true },
    scope: { type: String, enum: HOLIDAY_SCOPES, required: true },
    calendarIds: { type: [ObjectId], ref: 'HolidayCalendar', default: [] },
    source: { type: String, enum: ['import', 'manual'], default: 'manual' },
    year: { type: Number, required: true, index: true },
  },
  opts,
);
holidaySchema.index({ date: 1, calendarIds: 1 });
export type HolidayDoc = HydratedDocument<InferSchemaType<typeof holidaySchema>>;
export const Holiday = mongoose.model('Holiday', holidaySchema);

// ───────── vacation requests ─────────
const daySchema = new Schema(
  { date: String, units: Number, reason: String, period: String },
  { _id: false },
);
const allocSchema = new Schema({ date: String, year: Number, bucket: String, units: Number }, { _id: false });

const requestSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: REQUEST_KINDS, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    halfDay: {
      type: new Schema({ date: String, period: { type: String, enum: HALF_DAY_PERIODS } }, { _id: false }),
      default: null,
    },
    status: { type: String, enum: REQUEST_STATUSES, required: true, default: 'PENDING' },
    units: { type: Number, required: true },
    breakdown: {
      days: { type: [daySchema], default: [] },
      allocation: { type: [allocSchema], default: [] },
    },
    comment: { type: String, default: null },
    approverId: { type: ObjectId, ref: 'User', default: null },
    decidedBy: { type: ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    replacesRequestId: { type: ObjectId, ref: 'VacationRequest', default: null },
    cancelReason: { type: String, default: null },
    revokedFromDate: { type: String, default: null },
    revokeReason: { type: String, default: null },
    urgentAt: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
    retroactive: { type: Boolean, default: false },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  opts,
);
requestSchema.index({ userId: 1, startDate: 1 });
requestSchema.index({ status: 1, approverId: 1 });
requestSchema.index({ status: 1, startDate: 1 });
export type RequestDoc = HydratedDocument<InferSchemaType<typeof requestSchema>>;
export const VacationRequest = mongoose.model('VacationRequest', requestSchema);

// ───────── ledger (solo inserciones) ─────────
const ledgerSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    bucket: { type: String, enum: BUCKETS, required: true },
    type: { type: String, enum: LEDGER_TYPES, required: true },
    units: { type: Number, required: true, validate: Number.isInteger },
    requestId: { type: ObjectId, ref: 'VacationRequest', default: null, index: true },
    reason: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false, currentTime }, versionKey: false },
);
ledgerSchema.index({ userId: 1, year: 1, bucket: 1 });
appendOnly(ledgerSchema, 'El ledger');
export const LedgerEntry = mongoose.model('LedgerEntry', ledgerSchema);

// ───────── userYears ─────────
const userYearSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    opened: { type: Boolean, default: false },
    closed: { type: Boolean, default: false },
    closedAt: { type: Date, default: null },
    carryoverExpiresOn: { type: String, required: true },
    version: { type: Number, default: 0 },
  },
  opts,
);
userYearSchema.index({ userId: 1, year: 1 }, { unique: true });
export const UserYear = mongoose.model('UserYear', userYearSchema);

// ───────── notifications ─────────
const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
    dedupeKey: { type: String, default: undefined },
    readAt: { type: Date, default: null },
  },
  opts,
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
export const Notification = mongoose.model('Notification', notificationSchema);

// ───────── mail queue ─────────
const mailSchema = new Schema(
  {
    to: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
    dedupeKey: { type: String, default: undefined },
  },
  opts,
);
mailSchema.index({ status: 1, nextAttemptAt: 1 });
mailSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
export const MailItem = mongoose.model('MailItem', mailSchema, 'mailQueue');

// ───────── audit (solo inserciones) ─────────
const auditSchema = new Schema(
  {
    actorId: { type: ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false, currentTime }, versionKey: false },
);
auditSchema.index({ targetId: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ actorId: 1, createdAt: -1 });
appendOnly(auditSchema, 'La auditoría');
export const AuditLog = mongoose.model('AuditLog', auditSchema, 'auditLogs');

// ───────── settings ─────────
const settingsSchema = new Schema(
  { _id: { type: String, default: 'global' }, values: { type: Schema.Types.Mixed, default: {} } },
  { timestamps: { currentTime }, versionKey: false },
);
export const SettingsModel = mongoose.model('Settings', settingsSchema, 'settings');

// ───────── jobs ─────────
const jobRunSchema = new Schema(
  {
    job: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    status: { type: String, enum: ['running', 'done', 'failed'], required: true },
    trigger: { type: String, enum: ['cron', 'manual', 'catchup'], required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { versionKey: false },
);
export const JobRun = mongoose.model('JobRun', jobRunSchema, 'jobRuns');

const jobLockSchema = new Schema(
  { _id: String, owner: String, lockedUntil: Date },
  { versionKey: false },
);
export const JobLock = mongoose.model('JobLock', jobLockSchema, 'jobLocks');

export type Id = Types.ObjectId | string;
