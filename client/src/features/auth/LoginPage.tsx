import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { loginSchema } from '@ht/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { AuthShell } from './AuthShell';

function safeFrom(from: string | null): string {
  return from && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/';
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = safeFrom(params.get('from'));

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos no válidos');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(parsed.data.email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Iniciar sesión" description="Accede con tu cuenta de la empresa.">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form" noValidate>
        {error && (
          <Alert variant="destructive" data-testid="login-error">
            {error}
          </Alert>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
        </Field>
        <Button type="submit" className="w-full" disabled={busy} data-testid="login-submit">
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot" className="text-primary underline-offset-4 hover:underline" data-testid="login-forgot">
            He olvidado mi contraseña
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
