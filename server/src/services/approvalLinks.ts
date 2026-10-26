import { clock } from '../lib/clock';
import { hmac, safeEqual } from '../lib/crypto';
import { forbidden } from '../lib/errors';

/**
 * Enlaces firmados del email de aprobación (SPEC-10). Llevan a la app; nunca aprueban por sí solos:
 * la aprobación se confirma dentro de la app con sesión iniciada.
 */
const TTL_MS = 14 * 24 * 3600 * 1000;

export function approvalLinkToken(requestId: string, approverId: string): string {
  const exp = clock.now().getTime() + TTL_MS;
  const payload = `${requestId}.${approverId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmac(payload)}`;
}

export function approvalLinkPath(requestId: string, approverId: string): string {
  return `/approvals/${requestId}?t=${approvalLinkToken(requestId, approverId)}`;
}

export function verifyApprovalLink(token: string, actorId: string): string {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) throw forbidden('INVALID_LINK', 'El enlace no es válido.');
  const payload = Buffer.from(b64, 'base64url').toString();
  if (!safeEqual(hmac(payload), sig)) throw forbidden('INVALID_LINK', 'El enlace no es válido.');
  const [requestId, approverId, exp] = payload.split('.');
  if (!requestId || Number(exp) < clock.now().getTime()) throw forbidden('LINK_EXPIRED', 'El enlace ha caducado.');
  if (approverId !== actorId) throw forbidden('INVALID_LINK', 'Este enlace es para otra persona.');
  return requestId;
}
