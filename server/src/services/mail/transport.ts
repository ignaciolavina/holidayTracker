import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { clock } from '../../lib/clock';

export interface OutgoingMail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Transportes: `console` (desarrollo: log + server/tmp/mails), `smtp` (Nodemailer) o `resend` (API HTTP). */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  switch (env.mailTransport) {
    case 'smtp': {
      const transporter = nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      });
      await transporter.sendMail({ from: env.mailFrom, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
      return;
    }
    case 'resend': {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.mailFrom, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
      return;
    }
    default: {
      if (env.isTest) return;
      const dir = path.resolve(process.cwd(), env.mailDir);
      await mkdir(dir, { recursive: true });
      const stamp = clock.now().toISOString().replace(/[:.]/g, '-');
      const safeTo = mail.to.replace(/[^a-z0-9@._-]/gi, '_');
      await writeFile(path.join(dir, `${stamp}-${safeTo}-${mail.id}.html`), mail.html);
      logger.info(`📧 [console] a ${mail.to}: ${mail.subject}`);
    }
  }
}
