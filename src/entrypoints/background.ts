import { migrate } from '@/lib/migration';
import { setupSyncListener, syncToLocal } from '@/lib/sync';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      // Fresh install — restore data from sync (e.g. from another device)
      try {
        await migrate(browser.storage.sync);
        await syncToLocal();
      } catch {
        // Sync not available — nothing to restore
      }
    }

    // Always migrate local storage (handles both install and update)
    try {
      await migrate(browser.storage.local);
    } catch (e) {
      console.error('Local migration failed:', e);
    }
  });

  setupSyncListener();
});
