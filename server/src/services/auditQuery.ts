import type { AuditLogDto, Paginated } from '@ht/shared';
import { AuditLog, Holiday, User } from '../models';
import { SENSITIVE_ACTIONS } from './audit';
import { csvCell } from './balance/admin';

export interface AuditFilter {
  actorId?: string;
  targetId?: string;
  action?: string;
  from?: string;
  to?: string;
  sensitive?: '1' | '0';
  page: number;
  pageSize: number;
}

function toQuery(f: AuditFilter) {
  const q: Record<string, unknown> = {};
  if (f.actorId) q.actorId = f.actorId;
  if (f.targetId) q.targetId = f.targetId;
  if (f.action) q.action = f.action;
  if (f.sensitive === '1') q.action = f.action && SENSITIVE_ACTIONS.includes(f.action as never) ? f.action : { $in: SENSITIVE_ACTIONS };
  if (f.from || f.to) {
    // las fechas del filtro son de calendario en Madrid; margen de ±1 día en UTC es suficiente para un filtro
    q.createdAt = {
      ...(f.from ? { $gte: new Date(`${f.from}T00:00:00+01:00`) } : {}),
      ...(f.to ? { $lte: new Date(`${f.to}T23:59:59+01:00`) } : {}),
    };
  }
  return q;
}

export async function queryAudit(f: AuditFilter): Promise<Paginated<AuditLogDto>> {
  const q = toQuery(f);
  const [total, docs] = await Promise.all([
    AuditLog.countDocuments(q),
    AuditLog.find(q).sort({ createdAt: -1, _id: -1 }).skip((f.page - 1) * f.pageSize).limit(f.pageSize).lean(),
  ]);
  return { items: await toDtos(docs), total, page: f.page, pageSize: f.pageSize };
}

async function toDtos(docs: Array<Record<string, unknown>>): Promise<AuditLogDto[]> {
  const ids = new Set<string>();
  for (const d of docs) {
    if (d.actorId) ids.add(String(d.actorId));
    if (d.targetId && d.targetType === 'user') ids.add(String(d.targetId));
  }
  const names = new Map((await User.find({ _id: { $in: [...ids] } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const holIds = docs.filter((d) => d.targetType === 'holiday' && d.targetId).map((d) => String(d.targetId));
  const hols = new Map((await Holiday.find({ _id: { $in: holIds } }).select('name date').lean()).map((h) => [String(h._id), `${h.name} (${h.date})`]));
  return docs.map((d) => ({
    id: String(d._id),
    actorId: d.actorId ? String(d.actorId) : null,
    actorName: d.actorId ? (names.get(String(d.actorId)) ?? null) : 'Sistema',
    action: String(d.action),
    targetType: String(d.targetType),
    targetId: d.targetId ? String(d.targetId) : null,
    targetName: d.targetId ? (names.get(String(d.targetId)) ?? hols.get(String(d.targetId)) ?? null) : null,
    before: d.before ?? null,
    after: d.after ?? null,
    reason: (d.reason as string | null) ?? null,
    ip: (d.ip as string | null) ?? null,
    createdAt: (d.createdAt as Date).toISOString(),
    sensitive: SENSITIVE_ACTIONS.includes(d.action as never),
  }));
}

export async function auditCsv(f: AuditFilter): Promise<string> {
  const docs = await AuditLog.find(toQuery(f)).sort({ createdAt: -1 }).limit(20000).lean();
  const rows = await toDtos(docs);
  const header = ['Fecha', 'Actor', 'Acción', 'Tipo', 'Objetivo', 'Motivo', 'Antes', 'Después', 'IP'];
  const lines = rows.map((r) =>
    [r.createdAt, r.actorName, r.action, r.targetType, r.targetName ?? r.targetId, r.reason, JSON.stringify(r.before), JSON.stringify(r.after), r.ip]
      .map(csvCell)
      .join(';'),
  );
  return '﻿' + [header.join(';'), ...lines].join('\n');
}
