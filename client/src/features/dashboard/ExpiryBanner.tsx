import { diffDays, type BalanceDto } from '@ht/shared';
import { Alert } from '@/components/ui/alert';
import { days, fmtDate } from '@/lib/format';
import { today } from '@/lib/today';

/** Banner de caducidad de arrastrados (SPEC-07): del 1 de enero a la caducidad; naranja <30 d, rojo <7 d. */
export function ExpiryBanner({ balance }: { balance: BalanceDto }) {
  const now = today();
  const carry = balance.available.carryover;
  const expires = balance.carryoverExpiresOn;
  if (carry <= 0 || now < `${balance.year}-01-01` || now > expires) return null;
  const left = diffDays(now, expires);
  const variant = left < 7 ? 'destructive' : left < 30 ? 'warning' : 'info';
  return (
    <Alert variant={variant} title={left === 0 ? 'Los arrastrados caducan hoy' : `Quedan ${left} ${left === 1 ? 'día' : 'días'} para que caduquen tus arrastrados`} data-testid="expiry-banner" data-level={variant}>
      Tienes {days(carry)} {carry === 2 ? 'día' : 'días'} de {balance.year - 1} que caducan el {fmtDate(expires)}. Si no los disfrutas antes de esa fecha, se perderán.
    </Alert>
  );
}
