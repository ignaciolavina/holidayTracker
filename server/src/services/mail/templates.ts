import { env } from '../../config/env';

/** Plantillas de email en español: tono cercano, diseño simple y consistente (SPEC-13). */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

export function layout(opts: {
  subject: string;
  greeting: string;
  paragraphs: string[];
  cta?: { label: string; path: string };
  footnote?: string;
}): MailContent {
  const url = opts.cta ? `${env.appUrl}${opts.cta.path}` : null;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#2563eb;color:#fff;padding:16px 24px;font-weight:600;font-size:16px">🌴 holidayTracker</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 16px;font-size:16px">${esc(opts.greeting)}</p>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join('\n')}
${url ? `<p style="margin:24px 0"><a href="${esc(url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${esc(opts.cta!.label)}</a></p>` : ''}
${opts.footnote ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${esc(opts.footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:12px 24px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">Recibes este correo porque formas parte del equipo en holidayTracker.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [opts.greeting, '', ...opts.paragraphs, ...(url ? ['', `${opts.cta!.label}: ${url}`] : []), ...(opts.footnote ? ['', opts.footnote] : [])].join('\n');
  return { subject: opts.subject, html, text };
}
