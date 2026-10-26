import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { inviteSchema, updateUserSchema, unitsToDays, type InvitationDto, type SettlementDto, type UserDetail } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { useHolidayCalendars, useSettings } from '@/lib/queries';
import { days, fmtDate, fmtDateTime } from '@/lib/format';
import { today } from '@/lib/today';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BirthdayInput } from '@/components/BirthdayInput';
import { DangerConfirmDialog } from '@/components/DangerConfirmDialog';
import { Loading } from '@/components/PageHeader';
import { ApiErrorBox, UserSelect, useAdminUsers, useInvitations } from './common';

const STATUS_LABEL = { active: 'Activo', invited: 'Invitado', disabled: 'De baja' } as const;
const INV_LABEL = { pending: 'Pendiente', used: 'Usada', revoked: 'Revocada', expired: 'Caducada' } as const;
const ROLE_LABEL = { admin: 'Administrador', user: 'Usuario' } as const;

export function UsersPage() {
  const users = useAdminUsers();
  const invs = useInvitations();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserDetail | null>(null);
  const [deactivating, setDeactivating] = useState<UserDetail | null>(null);
  const [settlement, setSettlement] = useState<SettlementDto | null>(null);
  const [revoking, setRevoking] = useState<InvitationDto | null>(null);
  const qc = useQueryClient();
  const nameOf = (id: string | null) => users.data?.find((u) => u.id === id)?.name ?? '—';

  const reactivate = useMutation({
    mutationFn: (u: UserDetail) => api.post(`/users/${u.id}/reactivate`),
    onSuccess: () => { toast.success('Usuario reactivado.'); void qc.invalidateQueries({ queryKey: ['users'] }); void qc.invalidateQueries({ queryKey: ['org'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: (i: InvitationDto) => api.post(`/invitations/${i.id}/resend`),
    onSuccess: () => { toast.success('Invitación reenviada.'); void qc.invalidateQueries({ queryKey: ['admin', 'invitations'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4" data-testid="users-page">
      <Tabs defaultValue="users">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="users" data-testid="tab-users">Usuarios</TabsTrigger>
            <TabsTrigger value="invitations" data-testid="tab-invitations">Invitaciones</TabsTrigger>
          </TabsList>
          <Button onClick={() => setInviteOpen(true)} data-testid="invite-open">Invitar persona</Button>
        </div>

        <TabsContent value="users">
          {users.isLoading && <Loading />}
          {users.isError && <Alert variant="destructive">No se han podido cargar los usuarios.</Alert>}
          {users.data && (
            <div className="rounded-md border">
              <Table data-testid="users-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead><TableHead>Rol</TableHead><TableHead>Estado</TableHead><TableHead>Manager</TableHead>
                    <TableHead>Alta</TableHead><TableHead>Días anuales</TableHead><TableHead>Cumpleaños</TableHead><TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data.map((u) => (
                    <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar name={u.name} url={u.avatarUrl} />
                          <div className="min-w-0"><p className="font-medium">{u.name}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div>
                        </div>
                      </TableCell>
                      <TableCell>{ROLE_LABEL[u.role]}</TableCell>
                      <TableCell><Badge variant={u.status === 'active' ? 'secondary' : u.status === 'disabled' ? 'destructive' : 'outline'}>{STATUS_LABEL[u.status]}</Badge>{u.leaveDate && <span className="ml-1 text-xs text-muted-foreground">hasta {fmtDate(u.leaveDate)}</span>}</TableCell>
                      <TableCell>{nameOf(u.managerId)}{u.directReportsCount > 0 && <span className="ml-1 text-xs text-muted-foreground">· {u.directReportsCount} reportes</span>}</TableCell>
                      <TableCell>{fmtDate(u.hireDate)}</TableCell>
                      <TableCell>{days(u.annualUnits)}</TableCell>
                      <TableCell>{u.birthday ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => setEditing(u)} data-testid={`user-edit-${u.id}`}>Editar</Button>
                          {u.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setDeactivating(u)} data-testid={`user-deactivate-${u.id}`}>Desactivar</Button>}
                          {u.status === 'disabled' && <Button size="sm" variant="ghost" disabled={reactivate.isPending} onClick={() => reactivate.mutate(u)} data-testid={`user-reactivate-${u.id}`}>Reactivar</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="invitations">
          {invs.isLoading && <Loading />}
          {invs.data && (
            <div className="rounded-md border">
              <Table data-testid="invitations-table">
                <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Nombre</TableHead><TableHead>Rol</TableHead><TableHead>Estado</TableHead><TableHead>Caduca</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader>
                <TableBody>
                  {invs.data.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No hay invitaciones.</TableCell></TableRow>}
                  {invs.data.map((i) => (
                    <TableRow key={i.id} data-testid={`invitation-row-${i.id}`}>
                      <TableCell>{i.email}</TableCell><TableCell>{i.name}</TableCell><TableCell>{ROLE_LABEL[i.role]}</TableCell>
                      <TableCell><Badge variant={i.status === 'pending' ? 'secondary' : 'outline'}>{INV_LABEL[i.status]}</Badge></TableCell>
                      <TableCell className="text-xs">{fmtDateTime(i.expiresAt)}</TableCell>
                      <TableCell>
                        {(i.status === 'pending' || i.status === 'expired') && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate(i)} data-testid={`invitation-resend-${i.id}`}>Reenviar</Button>
                            {i.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => setRevoking(i)} data-testid={`invitation-revoke-${i.id}`}>Revocar</Button>}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {inviteOpen && <InviteDialog users={users.data ?? []} onClose={() => setInviteOpen(false)} />}
      {editing && <EditUserDialog user={editing} users={users.data ?? []} onClose={() => setEditing(null)} />}
      {deactivating && (
        <DeactivateDialog user={deactivating} onClose={() => setDeactivating(null)} onSettled={(s) => setSettlement(s)} />
      )}
      {settlement && (
        <Dialog open onOpenChange={(o) => !o && setSettlement(null)}>
          <DialogContent data-testid="settlement-dialog">
            <DialogHeader><DialogTitle>Liquidación de vacaciones</DialogTitle><DialogDescription>Baja a fecha {fmtDate(settlement.leaveDate)} · año {settlement.year}</DialogDescription></DialogHeader>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted-foreground">Derecho proporcional</dt><dd>{days(settlement.entitlementUnits)} días</dd>
              <dt className="font-semibold">Saldo de liquidación</dt>
              <dd className={settlement.settlementUnits < 0 ? 'font-semibold text-destructive' : 'font-semibold'} data-testid="settlement-value">{days(settlement.settlementUnits)} días</dd>
            </dl>
            <Alert variant={settlement.settlementUnits < 0 ? 'warning' : 'info'}>
              {settlement.settlementUnits >= 0 ? `A favor de la persona: ${days(settlement.settlementUnits)} días pendientes de disfrutar o compensar.` : `En contra de la persona: ha disfrutado ${days(-settlement.settlementUnits)} días de más.`}
            </Alert>
            <DialogFooter><Button onClick={() => setSettlement(null)}>Cerrar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {revoking && (
        <RevokeInvitation inv={revoking} onClose={() => setRevoking(null)} />
      )}
    </div>
  );
}

function RevokeInvitation({ inv, onClose }: { inv: InvitationDto; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <DangerConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      testId="invitation-revoke"
      title={`Revocar invitación a ${inv.email}`}
      confirmWord="REVOCAR"
      requireReason={false}
      warning="El enlace de la invitación dejará de funcionar."
      onConfirm={async () => {
        await api.post(`/invitations/${inv.id}/revoke`);
        toast.success('Invitación revocada.');
        void qc.invalidateQueries({ queryKey: ['admin', 'invitations'] });
      }}
    />
  );
}

function InviteDialog({ users, onClose }: { users: UserDetail[]; onClose: () => void }) {
  const qc = useQueryClient();
  const settings = useSettings();
  const calendars = useHolidayCalendars();
  const admins = users.filter((u) => u.role === 'admin' && u.status === 'active');
  const [f, setF] = useState({ email: '', name: '', role: 'user', managerId: '', holidayCalendarId: '', hireDate: today(), annualDays: '', birthday: '' });
  const [err, setErr] = useState<unknown>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const defaultDays = settings.data ? unitsToDays(settings.data.defaultAnnualUnits) : 24;
  const defaultCal = calendars.data?.find((c) => c.isDefault)?.id ?? '';

  const invite = useMutation({
    mutationFn: (body: unknown) => api.post('/invitations', body),
    onSuccess: () => { toast.success('Invitación enviada.'); void qc.invalidateQueries({ queryKey: ['admin', 'invitations'] }); onClose(); },
    onError: (e) => setErr(e),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const parsed = inviteSchema.safeParse({
      email: f.email,
      name: f.name,
      role: f.role,
      managerId: f.managerId || null,
      holidayCalendarId: f.holidayCalendarId || defaultCal || undefined,
      hireDate: f.hireDate,
      annualDays: f.annualDays === '' ? defaultDays : Number(f.annualDays.replace(',', '.')),
      birthday: f.birthday && /^\d\d-\d\d$/.test(f.birthday) ? f.birthday : undefined,
    });
    if (!parsed.success) {
      const m: Record<string, string> = {};
      for (const i of parsed.error.issues) m[String(i.path[0])] ??= i.message;
      setFieldErr(m);
      return;
    }
    setFieldErr({});
    invite.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="invite-dialog">
        <DialogHeader><DialogTitle>Invitar persona</DialogTitle><DialogDescription>Recibirá un email para crear su contraseña.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3" data-testid="invite-form">
          <Field label="Email" htmlFor="inv-email" error={fieldErr.email}><Input id="inv-email" data-testid="invite-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Nombre" htmlFor="inv-name" error={fieldErr.name}><Input id="inv-name" data-testid="invite-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol" htmlFor="inv-role"><Select id="inv-role" data-testid="invite-role" value={f.role} onChange={(e) => set('role', e.target.value)}><option value="user">Usuario</option><option value="admin">Administrador</option></Select></Field>
            <Field label="Manager" htmlFor="inv-manager" hint="Solo administradores activos"><UserSelect id="inv-manager" testId="invite-manager" value={f.managerId} onChange={(v) => set('managerId', v)} users={admins} allowNone /></Field>
          </div>
          <Field label="Calendario de festivos" htmlFor="inv-cal">
            <Select id="inv-cal" data-testid="invite-calendar" value={f.holidayCalendarId || defaultCal} onChange={(e) => set('holidayCalendarId', e.target.value)}>
              {(calendars.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha de alta" htmlFor="inv-hire" error={fieldErr.hireDate}><Input id="inv-hire" data-testid="invite-hire" type="date" value={f.hireDate} onChange={(e) => set('hireDate', e.target.value)} /></Field>
            <Field label="Días anuales" htmlFor="inv-days" error={fieldErr.annualDays} hint={`Por defecto ${days(settings.data?.defaultAnnualUnits ?? 48)}`}><Input id="inv-days" data-testid="invite-days" inputMode="decimal" placeholder={String(defaultDays)} value={f.annualDays} onChange={(e) => set('annualDays', e.target.value)} /></Field>
          </div>
          <Field label="Cumpleaños (opcional)" error={fieldErr.birthday}><BirthdayInput value={f.birthday} onChange={(v) => set('birthday', v)} idPrefix="inv-bd" testId="invite-bd" /></Field>
          {err != null && <ApiErrorBox error={err} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={invite.isPending} data-testid="invite-submit">{invite.isPending ? 'Enviando…' : 'Enviar invitación'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, users, onClose }: { user: UserDetail; users: UserDetail[]; onClose: () => void }) {
  const qc = useQueryClient();
  const calendars = useHolidayCalendars();
  const admins = users.filter((u) => u.role === 'admin' && u.status === 'active' && u.id !== user.id);
  const initial = useMemo(
    () => ({ name: user.name, role: user.role, managerId: user.managerId ?? '', holidayCalendarId: user.holidayCalendarId, hireDate: user.hireDate, annualDays: String(unitsToDays(user.annualUnits)), annualDaysFrom: today(), birthday: user.birthday ?? '', reason: '' }),
    [user],
  );
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<unknown>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const changes = useMemo(() => {
    const c: Record<string, unknown> = {};
    if (f.name !== initial.name) c.name = f.name;
    if (f.role !== initial.role) c.role = f.role;
    if (f.managerId !== initial.managerId) c.managerId = f.managerId || null;
    if (f.holidayCalendarId !== initial.holidayCalendarId) c.holidayCalendarId = f.holidayCalendarId;
    if (f.hireDate !== initial.hireDate) c.hireDate = f.hireDate;
    if (f.annualDays !== initial.annualDays) { c.annualDays = Number(f.annualDays.replace(',', '.')); c.annualDaysFrom = f.annualDaysFrom; }
    if (f.birthday !== initial.birthday) c.birthday = /^\d\d-\d\d$/.test(f.birthday) ? f.birthday : null;
    return c;
  }, [f, initial]);
  const needsReason = ['annualDays', 'hireDate', 'birthday', 'managerId'].some((k) => k in changes);
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: (body: unknown) => api.patch(`/users/${user.id}`, body),
    onSuccess: () => {
      toast.success('Usuario actualizado.');
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['org'] });
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e) => setErr(e),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body = { ...changes, ...(f.reason.trim() ? { reason: f.reason.trim() } : {}) };
    const parsed = updateUserSchema.safeParse(body);
    const m: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) m[String(i.path[0])] ??= i.message;
    if (needsReason && f.reason.trim().length < 3) m.reason = 'El motivo es obligatorio para estos cambios';
    setFieldErr(m);
    if (Object.keys(m).length || !parsed.success) return;
    save.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="user-edit-dialog">
        <DialogHeader><DialogTitle>Editar a {user.name}</DialogTitle><DialogDescription>{user.email}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Nombre" htmlFor="ed-name" error={fieldErr.name}><Input id="ed-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol" htmlFor="ed-role"><Select id="ed-role" data-testid="edit-role" value={f.role} onChange={(e) => set('role', e.target.value)}><option value="user">Usuario</option><option value="admin">Administrador</option></Select></Field>
            <Field label="Manager" htmlFor="ed-manager"><UserSelect id="ed-manager" testId="edit-manager" value={f.managerId} onChange={(v) => set('managerId', v)} users={admins} allowNone /></Field>
          </div>
          <Field label="Calendario de festivos" htmlFor="ed-cal"><Select id="ed-cal" value={f.holidayCalendarId} onChange={(e) => set('holidayCalendarId', e.target.value)}>{(calendars.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha de alta" htmlFor="ed-hire" error={fieldErr.hireDate}><Input id="ed-hire" type="date" value={f.hireDate} onChange={(e) => set('hireDate', e.target.value)} /></Field>
            <Field label="Días anuales" htmlFor="ed-days" error={fieldErr.annualDays}><Input id="ed-days" data-testid="edit-days" inputMode="decimal" value={f.annualDays} onChange={(e) => set('annualDays', e.target.value)} /></Field>
          </div>
          {'annualDays' in changes && (
            <Field label="Nuevos días anuales desde" htmlFor="ed-from" error={fieldErr.annualDaysFrom}><Input id="ed-from" type="date" value={f.annualDaysFrom} onChange={(e) => set('annualDaysFrom', e.target.value)} /></Field>
          )}
          <Field label="Cumpleaños" error={fieldErr.birthday}><BirthdayInput value={f.birthday} onChange={(v) => set('birthday', v)} idPrefix="ed-bd" testId="edit-bd" /></Field>
          {needsReason && (
            <Field label="Motivo del cambio (obligatorio)" htmlFor="ed-reason" error={fieldErr.reason}><Textarea id="ed-reason" data-testid="edit-reason" value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={1000} /></Field>
          )}
          {err != null && <ApiErrorBox error={err} />}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!dirty || save.isPending} data-testid="edit-submit">Guardar cambios</Button>
          </DialogFooter>
        </form>
        <p className="text-xs text-muted-foreground">¿Cambiar de manager a varias personas? Hazlo desde el <Link to="/admin/org" className="underline">organigrama</Link>.</p>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({ user, onClose, onSettled }: { user: UserDetail; onClose: () => void; onSettled: (s: SettlementDto) => void }) {
  const qc = useQueryClient();
  const [leaveDate, setLeaveDate] = useState(today());
  const [err, setErr] = useState<unknown>(null);
  return (
    <DangerConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      testId="deactivate"
      title={`Dar de baja a ${user.name}`}
      confirmWord="DESACTIVAR"
      confirmLabel="Dar de baja"
      warning={user.directReportsCount > 0 ? `${user.name} tiene ${user.directReportsCount} reportes directos: reasígnalos antes en el organigrama.` : 'La persona dejará de poder acceder. Sus solicitudes futuras se cancelarán y se calculará la liquidación.'}
      onConfirm={async ({ reason }) => {
        setErr(null);
        try {
          const s = await api.post<SettlementDto>(`/users/${user.id}/deactivate`, { leaveDate, reason });
          toast.success('Usuario dado de baja.');
          void qc.invalidateQueries({ queryKey: ['users'] });
          void qc.invalidateQueries({ queryKey: ['org'] });
          void qc.invalidateQueries({ queryKey: ['admin'] });
          onSettled(s);
        } catch (e) {
          setErr(e);
          throw e;
        }
      }}
    >
      <Field label="Último día (fecha de baja)" htmlFor="deact-date"><Input id="deact-date" data-testid="deactivate-date" type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} /></Field>
      {err != null && <ApiErrorBox error={err} />}
    </DangerConfirmDialog>
  );
}
