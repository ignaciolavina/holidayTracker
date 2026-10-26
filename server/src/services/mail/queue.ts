import type { ClientSession } from 'mongoose';
import { MailItem } from '../../models';
import { clock } from '../../lib/clock';
import { logger } from '../../lib/logger';
import { sendMail } from './transport';
import type { MailContent } from './templates';

const MAX_ATTEMPTS = 6;

/** Encola un email. Si el envío falla no se rompe la operación: hay reintentos con backoff. */
export async function enqueueMail(
  to: string,
  content: MailContent,
  opts: { session?: ClientSession; dedupeKey?: string } = {},
): Promise<void> {
  try {
    await MailItem.create(
      [{ to, ...content, nextAttemptAt: clock.now(), dedupeKey: opts.dedupeKey }],
      { session: opts.session },
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return; // ya encolado
    throw err;
  }
}

let running = false;

export async function processMailQueue(limit = 50): Promise<{ sent: number; failed: number }> {
  if (running) return { sent: 0, failed: 0 };
  running = true;
  let sent = 0;
  let failed = 0;
  try {
    const items = await MailItem.find({ status: 'pending', nextAttemptAt: { $lte: clock.now() } })
      .sort({ nextAttemptAt: 1 })
      .limit(limit);
    for (const item of items) {
      try {
        await sendMail({ id: String(item._id), to: item.to, subject: item.subject, html: item.html, text: item.text });
        item.status = 'sent';
        item.sentAt = clock.now();
        sent++;
      } catch (err) {
        item.attempts += 1;
        item.lastError = (err as Error).message;
        if (item.attempts >= MAX_ATTEMPTS) {
          item.status = 'failed';
          failed++;
        } else {
          item.nextAttemptAt = new Date(clock.now().getTime() + 2 ** item.attempts * 60_000);
        }
        logger.warn('Fallo enviando email', item.to, item.lastError);
      }
      await item.save();
    }
  } finally {
    running = false;
  }
  return { sent, failed };
}

/** Dispara el envío tras confirmar la transacción sin bloquear la respuesta. */
export function kickMailQueue(): void {
  setImmediate(() => {
    processMailQueue().catch((err) => logger.warn('Cola de email', err));
  });
}
