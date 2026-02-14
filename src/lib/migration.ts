import { STORAGE_SCHEMA_VERSION } from '@/types';
import { packSet, unpackSet } from './storage';

/**
 * Detect the actual storage schema version from raw data.
 * The old extension (master branch) never writes storage_schema,
 * so we must detect the version from data shape.
 */
export function detectVersion(raw: Record<string, unknown>): number {
  // Explicit version marker — trust it
  if (typeof raw.storage_schema === 'number') {
    return raw.storage_schema;
  }

  // v1: has branch_fave_array (array-based storage with renamed key)
  if ('branch_fave_array' in raw) {
    return 1;
  }

  // v0: has branch_faves as a plain array (before renaming to branch_fave_array)
  if (Array.isArray(raw.branch_faves)) {
    return 0;
  }

  // v2 (legacy master): has packed set keys but no storage_schema
  if (Object.keys(raw).some((k) => k.endsWith('_keys'))) {
    return 2;
  }

  // Fresh install — no data at all
  return STORAGE_SCHEMA_VERSION;
}

export async function migrate(storage: Browser.storage.StorageArea): Promise<void> {
  const data = (await storage.get(null)) as Record<string, unknown>;
  const version = detectVersion(data);

  if (version === STORAGE_SCHEMA_VERSION) {
    return;
  }

  switch (version) {
    case 0: {
      // v0 -> v1: Rename saved array in storage
      const updates: Record<string, unknown> = { storage_schema: 1 };

      if (data.branch_faves) {
        updates.branch_fave_array = data.branch_faves;
      }

      await storage.set(updates);

      return migrate(storage);
    }

    case 1: {
      // v1 -> v2: Migrate from saved arrays to packed sets
      const branchFaves = new Set<number>((data.branch_fave_array as number[]) || []);
      const storyletFaves = new Set<number>((data.storylet_fave_array as number[]) || []);
      const cardProtects = new Set<number>((data.card_protect_array as number[]) || []);
      const cardDiscards = new Set<number>((data.card_discard_array as number[]) || []);

      const updates: Record<string, unknown> = {};

      Object.assign(updates, packSet(branchFaves, 'branch_faves'));
      Object.assign(updates, packSet(storyletFaves, 'storylet_faves'));
      Object.assign(updates, packSet(cardProtects, 'card_protects'));
      Object.assign(updates, packSet(cardDiscards, 'card_discards'));
      updates.storage_schema = 2;
      await storage.set(updates);

      return migrate(storage);
    }

    case 2: {
      // v2 -> v3: Convert block_action to boolean, rename card keys
      const updates: Record<string, unknown> = {};
      const keysToRemove: string[] = [];

      // Convert block_action from string "true"/"false" to boolean
      if (typeof data.block_action === 'string') {
        updates.block_action = data.block_action === 'true';
      }

      // Handle card_protects -> card_faves rename/merge
      if ('card_protects_keys' in data) {
        const protectKeys = (data.card_protects_keys as string[]) || [];

        if (protectKeys.length > 0) {
          const cardProtects = unpackSet(data, 'card_protects');
          const existingFaves = unpackSet(data, 'card_faves');
          const merged = new Set([...existingFaves, ...cardProtects]);

          Object.assign(updates, packSet(merged, 'card_faves'));
          keysToRemove.push('card_protects_keys', ...protectKeys);
        } else {
          // card_protects_keys exists but is empty — initialize card_faves if needed
          if (!('card_faves_keys' in data)) {
            updates.card_faves_keys = [];
          }

          keysToRemove.push('card_protects_keys');
        }
      }
      // If card_protects_keys doesn't exist, don't touch card_faves

      // Handle card_discards -> card_avoids rename/merge
      if ('card_discards_keys' in data) {
        const discardKeys = (data.card_discards_keys as string[]) || [];

        if (discardKeys.length > 0) {
          const cardDiscards = unpackSet(data, 'card_discards');
          const existingAvoids = unpackSet(data, 'card_avoids');
          const merged = new Set([...existingAvoids, ...cardDiscards]);

          Object.assign(updates, packSet(merged, 'card_avoids'));
          keysToRemove.push('card_discards_keys', ...discardKeys);
        } else {
          // card_discards_keys exists but is empty — initialize card_avoids if needed
          if (!('card_avoids_keys' in data)) {
            updates.card_avoids_keys = [];
          }

          keysToRemove.push('card_discards_keys');
        }
      }
      // If card_discards_keys doesn't exist, don't touch card_avoids

      updates.storage_schema = STORAGE_SCHEMA_VERSION;
      await storage.set(updates);

      if (keysToRemove.length > 0) {
        await storage.remove(keysToRemove);
      }

      return migrate(storage);
    }

    default:
      // Unknown version (probably synced from newer extension)
      console.error(
        `Unknown data storage schema (got ${version}, expected ${STORAGE_SCHEMA_VERSION})`,
      );

      if (browser.runtime.requestUpdateCheck) {
        try {
          await browser.runtime.requestUpdateCheck();
        } catch {
          // Ignore — Firefox may not support this
        }
      }

      return;
  }
}
