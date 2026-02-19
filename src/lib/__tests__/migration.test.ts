import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrate, migrateData, detectVersion } from '../migration';
import { unpackSet } from '../storage';
import { STORAGE_SCHEMA_VERSION } from '@/types';
import { createMockStorage, stubBrowserGlobal } from '../../../tests/helpers/mock-storage';

stubBrowserGlobal();

describe('detectVersion', () => {
  it('returns explicit storage_schema when present', () => {
    expect(detectVersion({ storage_schema: 0 })).toBe(0);
    expect(detectVersion({ storage_schema: 2 })).toBe(2);
    expect(detectVersion({ storage_schema: 3 })).toBe(3);
    expect(detectVersion({ storage_schema: 4 })).toBe(4);
    expect(detectVersion({ storage_schema: 99 })).toBe(99);
  });

  it('detects v1 by branch_fave_array presence', () => {
    expect(detectVersion({ branch_fave_array: [1, 2, 3] })).toBe(1);
  });

  it('detects v0 by branch_faves being an array', () => {
    expect(detectVersion({ branch_faves: [1, 2, 3] })).toBe(0);
  });

  it('detects v2 (legacy master) by packed set keys', () => {
    expect(detectVersion({ branch_faves_keys: ['branch_faves_0'] })).toBe(2);
    expect(detectVersion({ card_faves_keys: [] })).toBe(2);
  });

  it('returns current version for empty data (fresh install)', () => {
    expect(detectVersion({})).toBe(STORAGE_SCHEMA_VERSION);
  });
});

describe('migrateData', () => {
  it('migrates v2 raw dump to v4 in memory', () => {
    const input: Record<string, unknown> = {
      storage_schema: 2,
      block_action: 'true',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101, 202],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_protects_keys: ['card_protects_0'],
      card_protects_0: [701, 702],
      card_discards_keys: ['card_discards_0'],
      card_discards_0: [801],
    };

    const result = migrateData(input);

    expect(result.storage_schema).toBe(STORAGE_SCHEMA_VERSION);
    expect(result.click_protection).toBe('shift');
    expect(result.block_action).toBeUndefined();

    const branchFaves = unpackSet(result, 'branch_faves');

    expect(branchFaves).toEqual(new Set([101, 202]));

    const cardFaves = unpackSet(result, 'card_faves');

    expect(cardFaves).toEqual(new Set([701, 702]));

    const cardAvoids = unpackSet(result, 'card_avoids');

    expect(cardAvoids).toEqual(new Set([801]));

    expect(result.card_protects_keys).toBeUndefined();
    expect(result.card_discards_keys).toBeUndefined();
  });

  it('returns data unchanged when already at current version', () => {
    const input: Record<string, unknown> = {
      storage_schema: 4,
      click_protection: 'shift',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101],
      card_faves_keys: [],
      card_avoids_keys: [],
    };

    const result = migrateData(input);

    expect(result).toEqual(input);
  });

  it('migrates v0 data through full chain', () => {
    const input: Record<string, unknown> = {
      storage_schema: 0,
      branch_faves: [101, 202, 303],
    };

    const result = migrateData(input);

    expect(result.storage_schema).toBe(STORAGE_SCHEMA_VERSION);

    const branchFaves = unpackSet(result, 'branch_faves');

    expect(branchFaves).toEqual(new Set([101, 202, 303]));
  });

  it('does not mutate the input object', () => {
    const input: Record<string, unknown> = {
      storage_schema: 2,
      block_action: 'true',
      branch_faves_keys: [],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_protects_keys: [],
      card_discards_keys: [],
    };
    const copy = JSON.parse(JSON.stringify(input));

    migrateData(input);

    expect(input).toEqual(copy);
  });
});

describe('migrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('v0 -> v4', () => {
    it('migrates v0 data through full chain', async () => {
      const storage = createMockStorage({
        storage_schema: 0,
        branch_faves: [101, 202, 303],
        branch_reorder_mode: 'branch_reorder_active',
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('off');
      expect(result.block_action).toBeUndefined();

      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves).toEqual(new Set([101, 202, 303]));

      expect(result.card_faves_keys).toEqual([]);
      expect(result.card_avoids_keys).toEqual([]);
    });

    it('handles v0 with no branch_faves key (fresh install)', async () => {
      const storage = createMockStorage({
        storage_schema: 0,
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('off');
      expect(result.block_action).toBeUndefined();

      // No data to migrate — all sets should be empty
      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves.size).toBe(0);
      expect(result.card_faves_keys).toEqual([]);
      expect(result.card_avoids_keys).toEqual([]);
    });
  });

  describe('v1 -> v4', () => {
    it('migrates v1 arrays to v4 packed sets with renamed card keys', async () => {
      const storage = createMockStorage({
        storage_schema: 1,
        branch_fave_array: [101, 202],
        storylet_fave_array: [501],
        card_protect_array: [701, 702],
        card_discard_array: [801],
        block_action: 'true',
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('shift');
      expect(result.block_action).toBeUndefined();

      // Branch and storylet data migrated
      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves).toEqual(new Set([101, 202]));

      const storyletFaves = unpackSet(result, 'storylet_faves');

      expect(storyletFaves).toEqual(new Set([501]));

      // Card keys renamed: protects -> faves, discards -> avoids
      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701, 702]));

      const cardAvoids = unpackSet(result, 'card_avoids');

      expect(cardAvoids).toEqual(new Set([801]));

      // Old card keys removed
      expect(result.card_protects_keys).toBeUndefined();
      expect(result.card_discards_keys).toBeUndefined();
    });

    it('handles v1 without block_action (not stored, default applied at read time)', async () => {
      const storage = createMockStorage({
        storage_schema: 1,
        branch_fave_array: [101],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('off');
      expect(result.block_action).toBeUndefined();

      // Branch data still migrates correctly
      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves).toEqual(new Set([101]));
    });
  });

  describe('v2 -> v4', () => {
    it('converts block_action "true" to click_protection "shift"', async () => {
      const storage = createMockStorage({
        storage_schema: 2,
        block_action: 'true',
        branch_faves_keys: [],
        branch_avoids_keys: [],
        storylet_faves_keys: [],
        storylet_avoids_keys: [],
        card_protects_keys: [],
        card_discards_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('shift');
      expect(result.block_action).toBeUndefined();
    });

    it('converts block_action "false" to click_protection "off"', async () => {
      const storage = createMockStorage({
        storage_schema: 2,
        block_action: 'false',
        branch_faves_keys: [],
        branch_avoids_keys: [],
        storylet_faves_keys: [],
        storylet_avoids_keys: [],
        card_protects_keys: [],
        card_discards_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.click_protection).toBe('off');
      expect(result.block_action).toBeUndefined();
    });

    it('renames card_protects to card_faves', async () => {
      const storage = createMockStorage({
        storage_schema: 2,
        block_action: 'false',
        branch_faves_keys: [],
        branch_avoids_keys: [],
        storylet_faves_keys: [],
        storylet_avoids_keys: [],
        card_protects_keys: ['card_protects_0'],
        card_protects_0: [701, 702, 703],
        card_discards_keys: ['card_discards_0'],
        card_discards_0: [801],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      // New keys exist
      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701, 702, 703]));

      const cardAvoids = unpackSet(result, 'card_avoids');

      expect(cardAvoids).toEqual(new Set([801]));

      // Old keys removed
      expect(result.card_protects_keys).toBeUndefined();
      expect(result.card_protects_0).toBeUndefined();
      expect(result.card_discards_keys).toBeUndefined();
      expect(result.card_discards_0).toBeUndefined();
    });

    it('merges card_protects into existing card_faves', async () => {
      const storage = createMockStorage({
        storage_schema: 2,
        block_action: 'false',
        branch_faves_keys: [],
        card_protects_keys: ['card_protects_0'],
        card_protects_0: [701, 702],
        card_faves_keys: ['card_faves_0'],
        card_faves_0: [703, 704],
        card_discards_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      // Merged: existing card_faves + orphaned card_protects
      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701, 702, 703, 704]));

      // Old keys removed
      expect(result.card_protects_keys).toBeUndefined();
      expect(result.card_protects_0).toBeUndefined();
    });

    it('preserves branch and storylet data unchanged', async () => {
      const storage = createMockStorage({
        storage_schema: 2,
        block_action: 'false',
        branch_faves_keys: ['branch_faves_0'],
        branch_faves_0: [101, 202],
        branch_avoids_keys: ['branch_avoids_0'],
        branch_avoids_0: [301],
        storylet_faves_keys: ['storylet_faves_0'],
        storylet_faves_0: [501, 502],
        storylet_avoids_keys: [],
        card_protects_keys: [],
        card_discards_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves).toEqual(new Set([101, 202]));

      const branchAvoids = unpackSet(result, 'branch_avoids');

      expect(branchAvoids).toEqual(new Set([301]));

      const storyletFaves = unpackSet(result, 'storylet_faves');

      expect(storyletFaves).toEqual(new Set([501, 502]));
    });

    it('handles empty card keys gracefully', async () => {
      const storage = createMockStorage({
        storage_schema: 2,
        block_action: 'false',
        branch_faves_keys: [],
        branch_avoids_keys: [],
        storylet_faves_keys: [],
        storylet_avoids_keys: [],
        card_protects_keys: [],
        card_discards_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.card_faves_keys).toEqual([]);
      expect(result.card_avoids_keys).toEqual([]);
    });
  });

  describe('v3 -> v4', () => {
    it('converts block_action true to click_protection "shift"', async () => {
      const storage = createMockStorage({
        storage_schema: 3,
        block_action: true,
        branch_faves_keys: ['branch_faves_0'],
        branch_faves_0: [101],
        card_faves_keys: [],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('shift');
      expect(result.block_action).toBeUndefined();
    });

    it('converts block_action false to click_protection "off"', async () => {
      const storage = createMockStorage({
        storage_schema: 3,
        block_action: false,
        branch_faves_keys: [],
        card_faves_keys: [],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('off');
      expect(result.block_action).toBeUndefined();
    });

    it('defaults to "off" when block_action is absent', async () => {
      const storage = createMockStorage({
        storage_schema: 3,
        branch_faves_keys: [],
        card_faves_keys: [],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('off');
      expect(result.block_action).toBeUndefined();
    });

    it('preserves all other data', async () => {
      const storage = createMockStorage({
        storage_schema: 3,
        block_action: true,
        branch_reorder_mode: 'branch_reorder_all',
        switch_mode: 'modifier_click',
        branch_faves_keys: ['branch_faves_0'],
        branch_faves_0: [101, 202],
        card_faves_keys: ['card_faves_0'],
        card_faves_0: [701],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.branch_reorder_mode).toBe('branch_reorder_all');
      expect(result.switch_mode).toBe('modifier_click');

      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves).toEqual(new Set([101, 202]));

      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701]));
    });
  });

  describe('legacy master format (no storage_schema)', () => {
    it('detects and migrates legacy data with card_faves/card_avoids', async () => {
      const storage = createMockStorage({
        block_action: 'true',
        branch_faves_keys: ['branch_faves_0'],
        branch_faves_0: [101, 202],
        card_faves_keys: ['card_faves_0'],
        card_faves_0: [701, 702],
        card_avoids_keys: ['card_avoids_0'],
        card_avoids_0: [801],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);
      expect(result.click_protection).toBe('shift');
      expect(result.block_action).toBeUndefined();

      // Card data preserved (not overwritten)
      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701, 702]));

      const cardAvoids = unpackSet(result, 'card_avoids');

      expect(cardAvoids).toEqual(new Set([801]));

      // Branch data preserved
      const branchFaves = unpackSet(result, 'branch_faves');

      expect(branchFaves).toEqual(new Set([101, 202]));
    });

    it('merges orphaned card_protects into existing card_faves', async () => {
      const storage = createMockStorage({
        block_action: 'false',
        branch_faves_keys: [],
        card_protects_keys: ['card_protects_0'],
        card_protects_0: [701, 702],
        card_faves_keys: ['card_faves_0'],
        card_faves_0: [703, 704],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);

      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701, 702, 703, 704]));

      expect(result.card_protects_keys).toBeUndefined();
      expect(result.card_protects_0).toBeUndefined();
    });

    it('renames orphaned card_protects when no card_faves exist', async () => {
      const storage = createMockStorage({
        block_action: 'true',
        branch_faves_keys: [],
        card_protects_keys: ['card_protects_0'],
        card_protects_0: [701, 702],
        card_discards_keys: ['card_discards_0'],
        card_discards_0: [801],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result.storage_schema).toBe(4);

      const cardFaves = unpackSet(result, 'card_faves');

      expect(cardFaves).toEqual(new Set([701, 702]));

      const cardAvoids = unpackSet(result, 'card_avoids');

      expect(cardAvoids).toEqual(new Set([801]));

      expect(result.card_protects_keys).toBeUndefined();
      expect(result.card_discards_keys).toBeUndefined();
    });
  });

  describe('fresh install (empty storage)', () => {
    it('is a no-op', async () => {
      const storage = createMockStorage({});

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      // Empty storage detected as current version — nothing written
      expect(result).toEqual({});
    });
  });

  describe('v4 -> v4 (no-op)', () => {
    it('does not modify already-migrated data', async () => {
      const originalData = {
        storage_schema: 4,
        click_protection: 'shift',
        branch_faves_keys: ['branch_faves_0'],
        branch_faves_0: [101],
        card_faves_keys: ['card_faves_0'],
        card_faves_0: [701],
        card_avoids_keys: [],
      };
      const storage = createMockStorage(originalData);

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const result = storage._getData();

      expect(result).toEqual(originalData);
    });
  });

  describe('idempotency', () => {
    it('running migrate twice produces the same result', async () => {
      const storage = createMockStorage({
        storage_schema: 1,
        branch_fave_array: [101, 202],
        card_protect_array: [701],
        block_action: 'true',
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const afterFirst = { ...storage._getData() };

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const afterSecond = storage._getData();

      expect(afterSecond).toEqual(afterFirst);
    });

    it('running migrate twice on legacy data produces the same result', async () => {
      const storage = createMockStorage({
        block_action: 'true',
        branch_faves_keys: ['branch_faves_0'],
        branch_faves_0: [101],
        card_faves_keys: ['card_faves_0'],
        card_faves_0: [701],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const afterFirst = { ...storage._getData() };

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const afterSecond = storage._getData();

      expect(afterSecond).toEqual(afterFirst);
    });

    it('running migrate twice on v3 data produces the same result', async () => {
      const storage = createMockStorage({
        storage_schema: 3,
        block_action: true,
        branch_faves_keys: [],
        card_faves_keys: [],
        card_avoids_keys: [],
      });

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const afterFirst = { ...storage._getData() };

      await migrate(storage as unknown as Browser.storage.StorageArea);

      const afterSecond = storage._getData();

      expect(afterSecond).toEqual(afterFirst);
    });
  });

  describe('unknown version', () => {
    it('logs error and does not throw', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const storage = createMockStorage({ storage_schema: 99 });

      await expect(
        migrate(storage as unknown as Browser.storage.StorageArea),
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown data storage schema'),
      );
      consoleSpy.mockRestore();
    });
  });
});
