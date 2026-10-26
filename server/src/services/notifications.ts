import type { ClientSession } from 'mongoose';
import { Notification, User } from '../models';
import { enqueueMail, kickMailQueue } from './mail/queue';
import { layout } from './mail/templates';

/** Notificaciones in-app + email (SPEC-13). */

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  link?: string | null;
  payload?: Record<string, unknown>;
  /** si se indica, también se manda email */
  email?: { subject: string; paragraphs: string[]; cta?: { label: string; path: string }; footnote?: string };
  inApp?: boolean;
  dedupeKey?: string;
}

export async function notify(
  userIds: Array<string | { toString(): string }>,
  input: NotifyInput,
  opts: { session?: ClientSession; after?: (cb: () => void) => void } = {},
): Promise<void> {
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return;
  const users = await User.find({ _id: { $in: ids }, status: { $ne: 'disabled' } })
    .select('email name')
    .session(opts.session ?? null)
    .lean();
  for (const u of users) {
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${u._id}` : undefined;
    if (input.inApp !== false) {
      try {
        await Notification.create(
          [
            {
              userId: u._id,
              type: input.type,
              title: input.title,
              body: input.body,
              link: input.link ?? null,
              payload: input.payload ?? {},
              dedupeKey,
            },
          ],
          { session: opts.session },
        );
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    if (input.email) {
      const firstName = u.name.split(' ')[0] ?? u.name;
      await enqueueMail(
        u.email,
        layout({
          subject: input.email.subject,
          greeting: `¡Hola, ${firstName}!`,
          paragraphs: input.email.paragraphs,
          cta: input.email.cta,
          footnote: input.email.footnote,
        }),
        { session: opts.session, dedupeKey: dedupeKey ? `mail:${dedupeKey}` : undefined },
      );
    }
  }
  if (input.email) {
    if (opts.after) opts.after(kickMailQueue);
    else kickMailQueue();
  }
}
