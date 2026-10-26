import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { changePasswordSchema, isValidMonthDay, updateProfileSchema, type Me } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MONTH_NAMES, cap, days } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/PageHeader';
import { BirthdayInput } from '@/components/BirthdayInput';


function birthdayText(mmdd: string) {
  const [m, d] = mmdd.split('-');
  return `${Number(d)} de ${MONTH_NAMES[Number(m) - 1]}`;
}

function ProfileForm({ me }: { me: Me }) {
  const { setUser } = useAuth();
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatarUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = updateProfileSchema.safeParse({ name, avatarUrl: avatar.trim() ? avatar.trim() : null });
    if (!parsed.success) return setError(parsed.error.issues[0]?.path[0] === 'avatarUrl' ? 'La URL del avatar no es válida.' : 'El nombre debe tener al menos 2 caracteres.');
    setBusy(true);
    setError(null);
    try {
      setUser(await api.patch<Me>('/me', parsed.data));
      toast.success('Perfil actualizado.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos personales</CardTitle>
        <CardDescription>{me.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" data-testid="profile-form" noValidate>
          {error && <Alert variant="destructive" data-testid="profile-error">{error}</Alert>}
          <div className="flex items-center gap-3">
            <Avatar name={name || me.name} url={avatar || null} className="h-14 w-14 text-lg" />
            <p className="text-xs text-muted-foreground">Vista previa del avatar</p>
          </div>
          <Field label="Nombre" htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
          </Field>
          <Field label="Avatar (URL)" htmlFor="avatar" hint="Enlace a una imagen. Déjalo vacío para usar tus iniciales.">
            <Input id="avatar" type="url" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" data-testid="profile-avatar" />
          </Field>
          <Button type="submit" disabled={busy} data-testid="profile-save">Guardar</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Datos no válidos');
    if (next !== again) return setError('Las contraseñas nuevas no coinciden.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/password', parsed.data);
      toast.success('Contraseña cambiada. Se han cerrado tus otras sesiones.');
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contraseña</CardTitle>
        <CardDescription>Mínimo 10 caracteres. Al cambiarla se cierran las demás sesiones.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" data-testid="password-form" noValidate>
          {error && <Alert variant="destructive" data-testid="password-error">{error}</Alert>}
          <Field label="Contraseña actual" htmlFor="cur">
            <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="password-current" />
          </Field>
          <Field label="Nueva contraseña" htmlFor="new">
            <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="password-new" />
          </Field>
          <Field label="Repite la nueva contraseña" htmlFor="again">
            <Input id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} data-testid="password-again" />
          </Field>
          <Button type="submit" disabled={busy} data-testid="password-save">Cambiar contraseña</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BirthdayCard({ me }: { me: Me }) {
  const { setUser, refetch } = useAuth();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidMonthDay(value)) return setError('Elige mes y día.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/birthday', { birthday: value });
      toast.success('Cumpleaños guardado.');
      const fresh = await api.get<Me>('/auth/me').catch(() => null);
      if (fresh) setUser(fresh);
      else await refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>🎂 Cumpleaños</CardTitle>
        <CardDescription>Da derecho a un día libre al año.</CardDescription>
      </CardHeader>
      <CardContent>
        {me.birthdayLocked ? (
          <div className="space-y-2" data-testid="birthday-locked">
            <p className="text-sm">
              Tu cumpleaños es el <strong>{me.birthday ? birthdayText(me.birthday) : '—'}</strong>.
            </p>
            <Alert variant="info">Ya está fijado: solo un administrador puede cambiarlo.</Alert>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" data-testid="birthday-form" noValidate>
            <Alert variant="warning">Solo puedes fijarlo una vez. Después únicamente lo podrá cambiar un administrador.</Alert>
            {error && <Alert variant="destructive" data-testid="birthday-error">{error}</Alert>}
            <Field label="Fecha de cumpleaños">
              <BirthdayInput value={value} onChange={setValue} />
            </Field>
            <Button type="submit" disabled={busy || !isValidMonthDay(value)} data-testid="birthday-save">Guardar cumpleaños</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div>
      <PageHeader title="Mi perfil" description={`${cap(user.role === 'admin' ? 'administrador' : 'usuario')} · ${days(user.annualUnits)} días al año`} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileForm key={user.id} me={user} />
        <div className="space-y-5">
          <BirthdayCard me={user} />
          <PasswordForm />
        </div>
      </div>
    </div>
  );
}
