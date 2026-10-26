import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotSchema } from '@ht/shared';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { AuthShell } from './AuthShell';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = forgotSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Email inválido');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot', parsed.data);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Recuperar contraseña" description="Te enviaremos un enlace para elegir una nueva.">
      {sent ? (
        <div className="space-y-4">
          <Alert variant="info" data-testid="forgot-sent">
            Si el email existe, recibirás un enlace para restablecer la contraseña. Caduca en 1 hora.
          </Alert>
          <Link to="/login" className="text-sm text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="forgot-form" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email" />
          </Field>
          <Button type="submit" className="w-full" disabled={busy} data-testid="forgot-submit">
            Enviar enlace
          </Button>
          <Link to="/login" className="block text-center text-sm text-primary hover:underline">
            Volver
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
