import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { zPassword } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { AuthShell } from './AuthShell';

export default function ResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = zPassword.safeParse(password);
    if (!p.success) return setError(p.error.issues[0]?.message ?? 'Contraseña no válida');
    if (password !== again) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset', { token, password });
      toast.success('Contraseña actualizada. Ya puedes iniciar sesión.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Nueva contraseña" description="Elige una contraseña de al menos 10 caracteres.">
      {!token ? (
        <Alert variant="destructive">
          El enlace no es válido. <Link to="/forgot" className="underline">Solicita uno nuevo</Link>.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="reset-form" noValidate>
          {error && <Alert variant="destructive" data-testid="reset-error">{error}</Alert>}
          <Field label="Nueva contraseña" htmlFor="password">
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="reset-password" />
          </Field>
          <Field label="Repite la contraseña" htmlFor="again">
            <Input id="again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} data-testid="reset-password-again" />
          </Field>
          <Button type="submit" className="w-full" disabled={busy} data-testid="reset-submit">
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
