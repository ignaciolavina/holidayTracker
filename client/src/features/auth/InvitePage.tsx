import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isValidMonthDay, zPassword, type InvitationInfo, type Me } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { BirthdayInput } from '@/components/BirthdayInput';
import { Loading } from '@/components/PageHeader';
import { AuthShell } from './AuthShell';

export default function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const info = useQuery({
    queryKey: ['invitation', token],
    enabled: !!token,
    retry: false,
    queryFn: () => api.get<InvitationInfo>(`/invitations/token/${encodeURIComponent(token)}`),
  });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [birthday, setBirthday] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = zPassword.safeParse(password);
    if (!p.success) return setError(p.error.issues[0]?.message ?? 'Contraseña no válida');
    if (password !== again) return setError('Las contraseñas no coinciden.');
    if (info.data?.needsBirthday && !isValidMonthDay(birthday)) return setError('Indica tu cumpleaños (mes y día).');
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ user: Me }>('/invitations/accept', {
        token,
        password,
        ...(info.data?.needsBirthday ? { birthday } : {}),
      });
      setUser(res.user);
      toast.success(`¡Bienvenido/a, ${res.user.name}!`);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Aceptar invitación" description="Crea tu contraseña para empezar a usar holidayTracker.">
      {!token || info.isError ? (
        <Alert variant="destructive" data-testid="invite-invalid">
          {info.error instanceof Error ? info.error.message : 'El enlace de invitación no es válido o ha caducado.'}{' '}
          <Link to="/login" className="underline">Ir al inicio de sesión</Link>
        </Alert>
      ) : info.isLoading || !info.data ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="invite-form" noValidate>
          <p className="text-sm">
            Hola, <strong>{info.data.name}</strong> ({info.data.email}).
          </p>
          {error && <Alert variant="destructive" data-testid="invite-error">{error}</Alert>}
          <Field label="Contraseña" htmlFor="password" hint="Mínimo 10 caracteres.">
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="invite-password" />
          </Field>
          <Field label="Repite la contraseña" htmlFor="again">
            <Input id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} data-testid="invite-password-again" />
          </Field>
          {info.data.needsBirthday && (
            <Field label="Tu cumpleaños" hint="Solo un administrador podrá cambiarlo después.">
              <BirthdayInput value={birthday} onChange={setBirthday} idPrefix="invite-birthday" testId="invite-birthday" />
            </Field>
          )}
          <Button type="submit" className="w-full" disabled={busy} data-testid="invite-submit">
            Crear cuenta y entrar
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
