import { describe, it, expect } from 'vitest';
import { migrate, detectVersion } from '@/lib/migration';
import { unpackSet } from '@/lib/storage';
import { createMockStorage, stubBrowserGlobal } from './helpers/mock-storage';
import storageV0 from './fixtures/storage-v0.json';
import storageV1 from './fixtures/storage-v1.json';
import storageV2 from './fixtures/storage-v2.json';
import storageLegacy from './fixtures/storage-legacy.json';
import storageV2Real from './fixtures/storage-v2-real.json';

stubBrowserGlobal();

describe('snapshot: v0 fixture migration', () => {
  it('migrates v0 -> v3 preserving all branch IDs', async () => {
    const storage = createMockStorage(storageV0 as Record<string, unknown>);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    expect(result.storage_schema).toBe(3);

    // branch_faves from v0 "branch_faves" array should be packed
    const branchFaves = unpackSet(result, 'branch_faves');

    expect(branchFaves).toEqual(new Set([10245, 20310, 30412, 40587, 50691]));

    // Options preserved
    expect(result.branch_reorder_mode).toBe('branch_reorder_active');

    // block_action was never stored — runtime getOption() provides default
    expect(result.block_action).toBeUndefined();

    // Empty card sets created (from card_protects_keys/card_discards_keys = [])
    expect(result.card_faves_keys).toEqual([]);
    expect(result.card_avoids_keys).toEqual([]);
  });
});

describe('snapshot: v1 fixture migration', () => {
  it('migrates v1 -> v3 preserving all data and renaming card keys', async () => {
    const storage = createMockStorage(storageV1 as Record<string, unknown>);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    expect(result.storage_schema).toBe(3);

    // All arrays migrated to packed sets
    const branchFaves = unpackSet(result, 'branch_faves');

    expect(branchFaves).toEqual(new Set([10245, 20310, 30412, 40587, 50691]));

    const storyletFaves = unpackSet(result, 'storylet_faves');

    expect(storyletFaves).toEqual(new Set([60123, 70456, 80789]));

    // Card keys renamed: protects -> faves, discards -> avoids
    const cardFaves = unpackSet(result, 'card_faves');

    expect(cardFaves).toEqual(new Set([90101, 90202, 90303, 90404, 90505]));

    const cardAvoids = unpackSet(result, 'card_avoids');

    expect(cardAvoids).toEqual(new Set([91601, 91702, 91803]));

    // Old card keys cleaned up
    expect(result.card_protects_keys).toBeUndefined();
    expect(result.card_discards_keys).toBeUndefined();

    // Options preserved
    expect(result.branch_reorder_mode).toBe('branch_reorder_all');
    expect(result.switch_mode).toBe('modifier_click');
  });
});

describe('snapshot: v2 fixture migration', () => {
  it('migrates v2 -> v3 with all transformations', async () => {
    const storage = createMockStorage(storageV2 as Record<string, unknown>);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    expect(result.storage_schema).toBe(3);

    // block_action: string "true" -> boolean true
    expect(result.block_action).toBe(true);
    expect(typeof result.block_action).toBe('boolean');

    // Branch data unchanged
    const branchFaves = unpackSet(result, 'branch_faves');

    expect(branchFaves).toEqual(new Set([10245, 20310, 30412, 40587, 50691]));
    expect(branchFaves.size).toBe(5);

    const branchAvoids = unpackSet(result, 'branch_avoids');

    expect(branchAvoids).toEqual(new Set([11111, 22222, 33333]));
    expect(branchAvoids.size).toBe(3);

    // Storylet data unchanged
    const storyletFaves = unpackSet(result, 'storylet_faves');

    expect(storyletFaves).toEqual(new Set([60123, 70456, 80789]));

    const storyletAvoids = unpackSet(result, 'storylet_avoids');

    expect(storyletAvoids).toEqual(new Set([61001, 62002]));

    // Card keys renamed, all IDs preserved
    const cardFaves = unpackSet(result, 'card_faves');

    expect(cardFaves).toEqual(new Set([90101, 90202, 90303, 90404, 90505]));
    expect(cardFaves.size).toBe(5);

    const cardAvoids = unpackSet(result, 'card_avoids');

    expect(cardAvoids).toEqual(new Set([91601, 91702, 91803]));
    expect(cardAvoids.size).toBe(3);

    // Old card keys fully removed
    expect(result.card_protects_keys).toBeUndefined();
    expect(result.card_protects_0).toBeUndefined();
    expect(result.card_discards_keys).toBeUndefined();
    expect(result.card_discards_0).toBeUndefined();

    // Options preserved
    expect(result.branch_reorder_mode).toBe('branch_reorder_all');
    expect(result.switch_mode).toBe('modifier_click');
  });

  it('preserves exact item count through migration (no data loss)', async () => {
    const storage = createMockStorage(storageV2 as Record<string, unknown>);

    // Count items before migration
    const beforeProtects = unpackSet(storageV2 as Record<string, unknown>, 'card_protects');
    const beforeDiscards = unpackSet(storageV2 as Record<string, unknown>, 'card_discards');
    const beforeBranchFaves = unpackSet(storageV2 as Record<string, unknown>, 'branch_faves');
    const beforeBranchAvoids = unpackSet(storageV2 as Record<string, unknown>, 'branch_avoids');

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    // Count items after migration — must match exactly
    const afterCardFaves = unpackSet(result, 'card_faves');
    const afterCardAvoids = unpackSet(result, 'card_avoids');
    const afterBranchFaves = unpackSet(result, 'branch_faves');
    const afterBranchAvoids = unpackSet(result, 'branch_avoids');

    expect(afterCardFaves.size).toBe(beforeProtects.size);
    expect(afterCardAvoids.size).toBe(beforeDiscards.size);
    expect(afterBranchFaves.size).toBe(beforeBranchFaves.size);
    expect(afterBranchAvoids.size).toBe(beforeBranchAvoids.size);

    // Every original ID is present
    for (const id of beforeProtects) {
      expect(afterCardFaves.has(id)).toBe(true);
    }

    for (const id of beforeDiscards) {
      expect(afterCardAvoids.has(id)).toBe(true);
    }

    for (const id of beforeBranchFaves) {
      expect(afterBranchFaves.has(id)).toBe(true);
    }

    for (const id of beforeBranchAvoids) {
      expect(afterBranchAvoids.has(id)).toBe(true);
    }
  });
});

describe('snapshot: legacy fixture migration', () => {
  it('migrates legacy -> v3 preserving all data', async () => {
    const storage = createMockStorage(storageLegacy as Record<string, unknown>);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    expect(result.storage_schema).toBe(3);

    // block_action converted from string to boolean
    expect(result.block_action).toBe(true);
    expect(typeof result.block_action).toBe('boolean');

    // All set data preserved
    const branchFaves = unpackSet(result, 'branch_faves');

    expect(branchFaves).toEqual(new Set([10245, 20310, 30412, 40587, 50691]));
    expect(branchFaves.size).toBe(5);

    const branchAvoids = unpackSet(result, 'branch_avoids');

    expect(branchAvoids).toEqual(new Set([11111, 22222]));
    expect(branchAvoids.size).toBe(2);

    const storyletFaves = unpackSet(result, 'storylet_faves');

    expect(storyletFaves).toEqual(new Set([60123, 70456, 80789]));
    expect(storyletFaves.size).toBe(3);

    const cardFaves = unpackSet(result, 'card_faves');

    expect(cardFaves).toEqual(new Set([90101, 90202, 90303]));
    expect(cardFaves.size).toBe(3);

    const cardAvoids = unpackSet(result, 'card_avoids');

    expect(cardAvoids).toEqual(new Set([91601, 91702]));
    expect(cardAvoids.size).toBe(2);

    // Options preserved
    expect(result.branch_reorder_mode).toBe('branch_reorder_all');
    expect(result.switch_mode).toBe('modifier_click');
  });

  it('preserves exact item count through migration (no data loss)', async () => {
    const legacyData = storageLegacy as Record<string, unknown>;
    const storage = createMockStorage(legacyData);

    // Count items before migration
    const beforeBranchFaves = unpackSet(legacyData, 'branch_faves');
    const beforeBranchAvoids = unpackSet(legacyData, 'branch_avoids');
    const beforeStoryletFaves = unpackSet(legacyData, 'storylet_faves');
    const beforeCardFaves = unpackSet(legacyData, 'card_faves');
    const beforeCardAvoids = unpackSet(legacyData, 'card_avoids');

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    // Count after
    const afterBranchFaves = unpackSet(result, 'branch_faves');
    const afterBranchAvoids = unpackSet(result, 'branch_avoids');
    const afterStoryletFaves = unpackSet(result, 'storylet_faves');
    const afterCardFaves = unpackSet(result, 'card_faves');
    const afterCardAvoids = unpackSet(result, 'card_avoids');

    expect(afterBranchFaves.size).toBe(beforeBranchFaves.size);
    expect(afterBranchAvoids.size).toBe(beforeBranchAvoids.size);
    expect(afterStoryletFaves.size).toBe(beforeStoryletFaves.size);
    expect(afterCardFaves.size).toBe(beforeCardFaves.size);
    expect(afterCardAvoids.size).toBe(beforeCardAvoids.size);

    // Every original ID is present
    for (const id of beforeBranchFaves) {
      expect(afterBranchFaves.has(id)).toBe(true);
    }

    for (const id of beforeCardFaves) {
      expect(afterCardFaves.has(id)).toBe(true);
    }

    for (const id of beforeCardAvoids) {
      expect(afterCardAvoids.has(id)).toBe(true);
    }
  });

  it('migration is idempotent', async () => {
    const storage = createMockStorage(storageLegacy as Record<string, unknown>);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const afterFirst = { ...storage._getData() };

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const afterSecond = storage._getData();

    expect(afterSecond).toEqual(afterFirst);
  });
});

// Real v2 data exported from production extension (master branch)
// Key differences from synthetic fixtures:
// - No storage_schema (never written by old code unless migration runs)
// - card_faves_*/card_avoids_* (content script always wrote these, not card_protects_*)
// - No branch_reorder_mode/switch_mode (defaults, never persisted)
// - IDs sorted lexicographically by old .sort() without comparator
describe('snapshot: real v2 data from browser', () => {
  const realData = storageV2Real as Record<string, unknown>;

  it('is detected as v2 by detectVersion despite missing storage_schema', () => {
    expect(realData.storage_schema).toBeUndefined();
    expect(detectVersion(realData)).toBe(2);
    expect(typeof realData.block_action).toBe('string');
  });

  it('migrates to v3 without errors', async () => {
    const storage = createMockStorage(realData);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    expect(result.storage_schema).toBe(3);
    expect(result.block_action).toBe(true);
    expect(typeof result.block_action).toBe('boolean');
  });

  it('preserves all data through migration', async () => {
    const storage = createMockStorage(realData);

    // Count before — real data already uses card_faves/card_avoids
    const beforeBranchFaves = unpackSet(realData, 'branch_faves');
    const beforeBranchAvoids = unpackSet(realData, 'branch_avoids');
    const beforeStoryletFaves = unpackSet(realData, 'storylet_faves');
    const beforeStoryletAvoids = unpackSet(realData, 'storylet_avoids');
    const beforeCardFaves = unpackSet(realData, 'card_faves');
    const beforeCardAvoids = unpackSet(realData, 'card_avoids');

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    // Count after
    const afterBranchFaves = unpackSet(result, 'branch_faves');
    const afterBranchAvoids = unpackSet(result, 'branch_avoids');
    const afterStoryletFaves = unpackSet(result, 'storylet_faves');
    const afterStoryletAvoids = unpackSet(result, 'storylet_avoids');
    const afterCardFaves = unpackSet(result, 'card_faves');
    const afterCardAvoids = unpackSet(result, 'card_avoids');

    // All set sizes preserved exactly
    expect(afterBranchFaves.size).toBe(beforeBranchFaves.size);
    expect(afterBranchAvoids.size).toBe(beforeBranchAvoids.size);
    expect(afterStoryletFaves.size).toBe(beforeStoryletFaves.size);
    expect(afterStoryletAvoids.size).toBe(beforeStoryletAvoids.size);
    expect(afterCardFaves.size).toBe(beforeCardFaves.size);
    expect(afterCardAvoids.size).toBe(beforeCardAvoids.size);

    // Verify exact counts from real data
    expect(afterBranchFaves.size).toBe(141);
    expect(afterBranchAvoids.size).toBe(42);
    expect(afterStoryletFaves.size).toBe(31);
    expect(afterStoryletAvoids.size).toBe(1);
    expect(afterCardFaves.size).toBe(7);
    expect(afterCardAvoids.size).toBe(8);

    // Every original ID survives migration
    for (const id of beforeBranchFaves) {
      expect(afterBranchFaves.has(id)).toBe(true);
    }

    for (const id of beforeBranchAvoids) {
      expect(afterBranchAvoids.has(id)).toBe(true);
    }

    for (const id of beforeStoryletFaves) {
      expect(afterStoryletFaves.has(id)).toBe(true);
    }

    for (const id of beforeCardFaves) {
      expect(afterCardFaves.has(id)).toBe(true);
    }

    for (const id of beforeCardAvoids) {
      expect(afterCardAvoids.has(id)).toBe(true);
    }

    // No orphaned card_protects/card_discards keys
    expect(result.card_protects_keys).toBeUndefined();
    expect(result.card_discards_keys).toBeUndefined();
  });

  it('does not invent missing options', async () => {
    const storage = createMockStorage(realData);

    await migrate(storage as unknown as Browser.storage.StorageArea);

    const result = storage._getData();

    // Real data has no branch_reorder_mode/switch_mode — migration should not create them
    // These will come from defaults at runtime via getOption()
    expect(result.branch_reorder_mode).toBeUndefined();
    expect(result.switch_mode).toBeUndefined();
  });
});
