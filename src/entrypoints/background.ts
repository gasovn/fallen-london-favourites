import { migrate } from '@/lib/migration';
import { setupSyncListener, syncToLocal } from '@/lib/sync';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    try {
      // Migrate sync storage first, then copy to local
      await migrate(browser.storage.sync);
      await syncToLocal();
    } catch {
      // If sync migration fails, fall back to migrating local only
      console.warn('Sync migration failed, migrating local storage');

      try {
        await migrate(browser.storage.local);
      } catch (e) {
        console.error('Local migration also failed:', e);
      }
    }
  });

  setupSyncListener();
});
