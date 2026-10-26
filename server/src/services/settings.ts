import { DEFAULT_SETTINGS, type Settings } from '@ht/shared';
import type { ClientSession } from 'mongoose';
import { SettingsModel } from '../models';
import { audit } from './audit';
import type { Actor } from './actor';
import { withTx } from '../db/tx';

export async function getSettings(session?: ClientSession): Promise<Settings> {
  const doc = await SettingsModel.findById('global').session(session ?? null).lean();
  const values = (doc?.values ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...values,
    birthdayWindow: { ...DEFAULT_SETTINGS.birthdayWindow, ...(values.birthdayWindow ?? {}) },
  };
}

export async function updateSettings(actor: Actor, patch: Partial<Settings>, reason?: string): Promise<Settings> {
  return withTx(async ({ session }) => {
    const before = await getSettings(session);
    const after: Settings = {
      ...before,
      ...patch,
      birthdayWindow: { ...before.birthdayWindow, ...(patch.birthdayWindow ?? {}) },
    };
    await SettingsModel.updateOne({ _id: 'global' }, { $set: { values: after } }, { upsert: true, session });
    await audit.log(actor, 'SETTINGS_CHANGED', { type: 'settings', id: null }, before, after, reason ?? null, session);
    return after;
  });
}
