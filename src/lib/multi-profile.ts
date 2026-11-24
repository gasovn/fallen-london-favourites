import type { ReadTarget } from '@/types';
import {
  profileExists,
  isComplete,
  readSets,
  listProfileCharIds,
  keysForProfile,
  REGISTRY_KEY,
} from './profiles';
import { packTarget } from './toggle';
import { QUOTA_REFUSAL } from './quota';

export type DisableResult = { status: 'disabled' | 'no-survivor' | 'incomplete' | 'changed' };

export interface ProfileSummary {
  charId: string;
  name: string;
}

export async function enableMultiProfile(): Promise<void> {
  await browser.storage.local.set({ multi_toggle: true });
}

export function listProfilesWithNames(data: Record<string, unknown>): ProfileSummary[] {
  const names = (data[REGISTRY_KEY] as Record<string, string> | undefined) ?? {};

  return listProfileCharIds(data).map((charId) => ({ charId, name: names[charId] ?? charId }));
}

/**
 * Copy the chosen profile into the shared default, then delete every profile,
 * the chosen one included: a kept copy goes stale while the feature is off and
 * a later disable would write it over newer shared favourites. With no
 * profile chosen only the toggle goes off and the names are cleared.
 * Checks and pack read one snapshot with no await in between, so a concurrent
 * pull cannot hand them a partial set.
 */
export async function disableMultiProfile(
  survivorCharId: string | null,
  shownCharIds: readonly string[],
): Promise<DisableResult> {
  const snapshot = await browser.storage.local.get(null);
  const writes: Record<string, unknown> = { multi_toggle: false };

  if (survivorCharId !== null && !profileExists(snapshot, survivorCharId)) {
    return { status: 'no-survivor' };
  }

  const profiles = listProfileCharIds(snapshot);

  if (
    snapshot.multi_toggle !== true ||
    profiles.length !== shownCharIds.length ||
    profiles.some((id) => !shownCharIds.includes(id))
  ) {
    return { status: 'changed' };
  }

  if (survivorCharId !== null) {
    const survivor: ReadTarget = { kind: 'profile', charId: survivorCharId };

    if (!isComplete(snapshot, survivor)) {
      return { status: 'incomplete' };
    }

    Object.assign(writes, packTarget(readSets(snapshot, survivor), { kind: 'default' }));
  }

  const names = (snapshot[REGISTRY_KEY] as Record<string, string> | undefined) ?? {};

  if (Object.keys(names).length > 0) {
    writes[REGISTRY_KEY] = {};
  }

  await browser.storage.local.set(writes);

  if (survivorCharId !== null) {
    await browser.storage.local.remove(profiles.flatMap((id) => keysForProfile(snapshot, id)));
  }

  // A pull already running when the write above landed can put the old values,
  // and the profiles, back over it. `writes` still holds the change, so apply
  // it once more.
  const after = await browser.storage.local.get(null);
  const back = survivorCharId === null ? [] : profiles.flatMap((id) => keysForProfile(after, id));

  if (
    back.length > 0 ||
    Object.keys(writes).some((key) => JSON.stringify(after[key]) !== JSON.stringify(writes[key]))
  ) {
    await browser.storage.local.set(writes);

    if (back.length > 0) {
      await browser.storage.local.remove(back);
    }
  }

  // The new shared list has to be in sync before the chosen profile leaves it:
  // a background restarted before its mirror would pull the old list back with
  // no profile left to restore from. The other profiles go first, to make room.
  // Best effort beyond that: another device that still holds a profile can
  // bring it back.
  if (survivorCharId !== null) {
    await removeFromSync(profiles.filter((id) => id !== survivorCharId));

    try {
      await browser.storage.sync.set(writes);
      await removeFromSync([survivorCharId]);
    } catch (error) {
      // No room for these favourites twice, in the profile and in the shared
      // list: drop the profile first.
      if (QUOTA_REFUSAL.test(String(error))) {
        await removeFromSync([survivorCharId]);

        try {
          await browser.storage.sync.set(writes);
        } catch {
          // the mirror writes it once sync has room
        }
      }
    }
  }

  return { status: 'disabled' };
}

export async function deleteProfile(charId: string): Promise<void> {
  const snapshot = await browser.storage.local.get(null);
  const names = (snapshot[REGISTRY_KEY] as Record<string, string> | undefined) ?? {};

  if (charId in names) {
    const next = { ...names };

    delete next[charId];
    await browser.storage.local.set({ [REGISTRY_KEY]: next });
  }

  const keys = keysForProfile(snapshot, charId);

  if (keys.length > 0) {
    await browser.storage.local.remove(keys);
  }

  await removeFromSync([charId]);
}

// Keys are listed from sync itself: it can still hold chunks local has dropped.
async function removeFromSync(charIds: readonly string[]): Promise<void> {
  try {
    const inSync = await browser.storage.sync.get(null);
    const keys = charIds.flatMap((id) => keysForProfile(inSync, id));

    if (keys.length > 0) {
      await browser.storage.sync.remove(keys);
    }
  } catch {
    // best effort
  }
}
