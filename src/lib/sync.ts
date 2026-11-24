import { migrate } from './migration';
import { findOrphanedChunks, findZombieKeys } from './cleanup';
import { syncPayload, setDeviceFlag, SYNC_FULL_FLAG, DEV_PREFIX } from './flags';
import { projectArea, exceedsCaps, QUOTA_REFUSAL } from './quota';
import { PROFILE_PREFIX, listProfileCharIds, findProfileOrphans } from './profiles';

const SYNC_PERIOD = 1000 * 3; // 3 seconds — safe for both syncing and service worker lifetime

let syncTimeout: ReturnType<typeof setTimeout> | undefined;
let syncTS = 0;

// Pulls are deferred while local holds un-mirrored changes: a whole-snapshot
// pull (including the echo of our own sync.remove) would overwrite them.
let localGen = 0;
let mirroredGen = 0;
let pullPending = false;

// What the last pull wrote; the next local change event is checked against it.
let pulled: Record<string, unknown> | undefined;

const MAX_MIRROR_RETRIES = 3;

let mirrorRetries = 0;

// The last mirror was refused for size; a change from sync may have made room.
let waitingForRoom = false;

function localIsDirty(): boolean {
  return localGen > mirroredGen;
}

async function syncToLocal(): Promise<void> {
  try {
    await migrate(browser.storage.sync);

    // Device flags do not belong in sync; an older build may have put them there.
    const data = syncPayload(await browser.storage.sync.get(null));

    if (localIsDirty()) {
      pullPending = true;

      return;
    }

    pulled = data;
    await browser.storage.local.set(data);
  } catch (error) {
    console.error('Error syncing from sync to local:', error);
  }
}

async function localToSync(): Promise<void> {
  syncTS = Date.now();

  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = undefined;
  }

  try {
    const gen = localGen;
    const localData = await browser.storage.local.get(null);
    const payload = syncPayload(localData);

    // sync.set never removes a key, so sync holds the keys of every device and
    // can be over a cap while this device is under.
    const syncBefore = await browser.storage.sync.get(null);

    if (exceedsCaps(projectArea({ ...syncBefore, ...payload }))) {
      waitingForRoom = true;
      await setDeviceFlag(SYNC_FULL_FLAG, true);

      return;
    }

    await browser.storage.sync.set(payload);

    // A profile deleted locally while this write was in flight has just been
    // put back into sync. A chunk whose registry is still in local is kept: the
    // registry just written still names it, and the next mirror's cleanup
    // removes it. Flat keys are left to the cleanup below, which removes only
    // chunks no registry names, known legacy keys and device flags.
    if (localGen !== gen) {
      const localNow = await browser.storage.local.get(null);
      const deleted = Object.keys(payload).filter(
        (key) =>
          key.startsWith(PROFILE_PREFIX) &&
          !(key in localNow) &&
          !(key.replace(/_\d+$/, '_keys') in localNow),
      );

      if (deleted.length > 0) {
        await browser.storage.sync.remove(deleted);
      }
    }

    if (gen > mirroredGen) {
      mirroredGen = gen;
    }

    mirrorRetries = 0;
    waitingForRoom = false;
    await setDeviceFlag(SYNC_FULL_FLAG, false);

    // Cleanup stale keys in sync — best effort
    try {
      const syncData = await browser.storage.sync.get(null);
      const staleKeys = [
        ...findOrphanedChunks(syncData),
        ...findZombieKeys(syncData),
        ...listProfileCharIds(syncData).flatMap((charId) => findProfileOrphans(syncData, charId)),
        ...Object.keys(syncData).filter((key) => key.startsWith(DEV_PREFIX)),
      ];

      if (staleKeys.length > 0) {
        await browser.storage.sync.remove(staleKeys);
      }
    } catch {
      // Sync cleanup failed — non-critical
    }

    if (pullPending && !localIsDirty()) {
      pullPending = false;
      await syncToLocal();
    }
  } catch (error) {
    console.error('Error syncing to sync storage:', error);

    // Firefox can refuse a write the estimate allows, so the browser's own size
    // refusal means the same as the check above.
    if (QUOTA_REFUSAL.test(String(error))) {
      waitingForRoom = true;

      try {
        await setDeviceFlag(SYNC_FULL_FLAG, true);
      } catch {
        // best effort
      }
    }

    // Bounded retry so a deferred pull is not stuck until the next local edit.
    if (!syncTimeout && mirrorRetries < MAX_MIRROR_RETRIES) {
      mirrorRetries++;
      syncTimeout = setTimeout(localToSync, SYNC_PERIOD);
    }
  }
}

export function setupSyncListener(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    // Device flags are never mirrored; a flag write must not start a mirror
    // whose success would clear the flag it has just raised.
    // Firefox reports every written key, changed or not. An event without a
    // real change is neither a local edit nor news from another device.
    const changed = Object.keys(changes).filter(
      (key) =>
        !key.startsWith(DEV_PREFIX) &&
        JSON.stringify(changes[key].oldValue) !== JSON.stringify(changes[key].newValue),
    );

    if (changed.length === 0) {
      return;
    }

    if (area === 'local') {
      // The pull's own write is not a local edit: counting it would hold back
      // the next change from sync and then overwrite it with this one.
      const applied = pulled;

      pulled = undefined;

      if (
        applied &&
        changed.every(
          (key) =>
            key in applied &&
            JSON.stringify(changes[key].newValue) === JSON.stringify(applied[key]),
        )
      ) {
        return;
      }

      localGen++;

      // Changes to local values, commit to sync
      if (Date.now() - syncTS > SYNC_PERIOD) {
        localToSync();
      } else {
        if (syncTimeout) {
          clearTimeout(syncTimeout);
        }

        syncTimeout = setTimeout(localToSync, SYNC_PERIOD - (Date.now() - syncTS));
      }
    } else if (localIsDirty()) {
      pullPending = true;

      if (waitingForRoom && !syncTimeout) {
        syncTimeout = setTimeout(localToSync, SYNC_PERIOD);
      }
    } else {
      // Changes coming from sync, commit to local
      syncToLocal();
    }
  });
}

export { syncToLocal, localToSync };
