import { migrate } from './migration';

const SYNC_PERIOD = 1000 * 3; // 3 seconds — safe for both syncing and service worker lifetime

let syncTimeout: ReturnType<typeof setTimeout> | undefined;
let syncTS = 0;

async function syncToLocal(): Promise<void> {
  try {
    await migrate(browser.storage.sync);

    const data = await browser.storage.sync.get(null);

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
    const data = await browser.storage.local.get(null);

    await browser.storage.sync.set(data);
  } catch (error) {
    console.error('Error syncing to sync storage:', error);
  }
}

export function setupSyncListener(): void {
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') {
      // Changes to local values, commit to sync
      if (Date.now() - syncTS > SYNC_PERIOD) {
        localToSync();
      } else {
        if (syncTimeout) {
          clearTimeout(syncTimeout);
        }

        syncTimeout = setTimeout(localToSync, SYNC_PERIOD - (Date.now() - syncTS));
      }
    } else {
      // Changes coming from sync, commit to local
      syncToLocal();
    }
  });
}

export { syncToLocal };
