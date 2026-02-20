import { describe, it, expect } from 'vitest';
import { findOrphanedChunks, findZombieKeys, cleanupStorage } from '../cleanup';
import { createMockStorage } from '../../../tests/helpers/mock-storage';

describe('findOrphanedChunks', () => {
  it('returns empty array when no orphans exist', () => {
    const data = {
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [100, 200],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_faves_keys: [],
      card_avoids_keys: [],
    };

    expect(findOrphanedChunks(data)).toEqual([]);
  });

  it('finds orphaned _0 chunk when _keys is empty', () => {
    const data = {
      branch_faves_keys: [],
      branch_faves_0: [100],
    };
    const orphans = findOrphanedChunks(data);

    expect(orphans).toContain('branch_faves_0');
  });

  it('finds orphaned _1 when set shrank to one chunk', () => {
    const data = {
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [1, 2, 3],
      branch_faves_1: [4, 5, 6],
    };
    const orphans = findOrphanedChunks(data);

    expect(orphans).toEqual(['branch_faves_1']);
  });

  it('handles multiple categories independently', () => {
    const data = {
      branch_faves_keys: [],
      branch_faves_0: [100],
      card_faves_keys: ['card_faves_0'],
      card_faves_0: [200],
      storylet_faves_keys: [],
      storylet_faves_0: [300],
    };
    const orphans = findOrphanedChunks(data);

    expect(orphans).toContain('branch_faves_0');
    expect(orphans).toContain('storylet_faves_0');
    expect(orphans).not.toContain('card_faves_0');
  });

  it('finds chunks for obsolete categories (card_protects, card_discards)', () => {
    const data = {
      card_protects_keys: ['card_protects_0'],
      card_protects_0: [1, 2],
      card_discards_0: [5],
    };
    const orphans = findOrphanedChunks(data);

    expect(orphans).toContain('card_discards_0');
    expect(orphans).not.toContain('card_protects_0');
  });

  it('does not flag non-chunk keys', () => {
    const data = {
      branch_reorder_mode: 'branch_reorder_active',
      storage_schema: 4,
      unknown_future_key: true,
    };

    expect(findOrphanedChunks(data)).toEqual([]);
  });

  it('ignores _keys entries that are not arrays', () => {
    const data = {
      branch_faves_keys: 'corrupted',
      branch_faves_0: [100],
    };
    const orphans = findOrphanedChunks(data);

    expect(orphans).toContain('branch_faves_0');
  });
});

describe('findZombieKeys', () => {
  it('returns empty array for clean storage', () => {
    const data = {
      storage_schema: 4,
      branch_faves_keys: [],
      click_protection: 'off',
    };

    expect(findZombieKeys(data)).toEqual([]);
  });

  it('finds block_action', () => {
    const data = { block_action: true, storage_schema: 4 };

    expect(findZombieKeys(data)).toContain('block_action');
  });

  it('finds legacy array keys', () => {
    const data = {
      branch_fave_array: [1, 2],
      storylet_fave_array: [3],
      card_protect_array: [4],
      card_discard_array: [5],
    };
    const zombies = findZombieKeys(data);

    expect(zombies).toContain('branch_fave_array');
    expect(zombies).toContain('storylet_fave_array');
    expect(zombies).toContain('card_protect_array');
    expect(zombies).toContain('card_discard_array');
  });

  it('finds v0 branch_faves plain key', () => {
    const data = { branch_faves: [1, 2, 3] };

    expect(findZombieKeys(data)).toContain('branch_faves');
  });

  it('does not flag branch_faves_keys or branch_faves_0', () => {
    const data = {
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [100],
    };

    expect(findZombieKeys(data)).toEqual([]);
  });

  it('finds obsolete card_protects_keys and card_discards_keys', () => {
    const data = {
      card_protects_keys: [],
      card_discards_keys: ['card_discards_0'],
    };
    const zombies = findZombieKeys(data);

    expect(zombies).toContain('card_protects_keys');
    expect(zombies).toContain('card_discards_keys');
  });
});

describe('cleanupStorage', () => {
  it('removes orphaned chunks', async () => {
    const storage = createMockStorage({
      storage_schema: 4,
      branch_faves_keys: [],
      branch_faves_0: [100],
      card_faves_keys: ['card_faves_0'],
      card_faves_0: [200],
    });

    await cleanupStorage(storage);

    const data = storage._getData();

    expect(data).not.toHaveProperty('branch_faves_0');
    expect(data).toHaveProperty('card_faves_0');
  });

  it('removes zombie keys', async () => {
    const storage = createMockStorage({
      storage_schema: 4,
      block_action: true,
      branch_fave_array: [1, 2],
      click_protection: 'shift',
    });

    await cleanupStorage(storage);

    const data = storage._getData();

    expect(data).not.toHaveProperty('block_action');
    expect(data).not.toHaveProperty('branch_fave_array');
    expect(data).toHaveProperty('click_protection');
    expect(data).toHaveProperty('storage_schema');
  });

  it('removes both orphans and zombies in one pass', async () => {
    const storage = createMockStorage({
      storage_schema: 4,
      block_action: true,
      branch_faves_keys: [],
      branch_faves_0: [100],
    });

    await cleanupStorage(storage);

    const data = storage._getData();

    expect(data).not.toHaveProperty('block_action');
    expect(data).not.toHaveProperty('branch_faves_0');
    expect(data).toHaveProperty('storage_schema');
  });

  it('does not remove unknown keys', async () => {
    const storage = createMockStorage({
      storage_schema: 4,
      future_feature_key: 'something',
      branch_faves_keys: [],
    });

    await cleanupStorage(storage);

    const data = storage._getData();

    expect(data).toHaveProperty('future_feature_key');
  });

  it('is a no-op on empty storage', async () => {
    const storage = createMockStorage({});

    await cleanupStorage(storage);

    expect(storage._getData()).toEqual({});
  });

  it('is a no-op on clean storage', async () => {
    const original = {
      storage_schema: 4,
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [100],
      click_protection: 'off',
    };
    const storage = createMockStorage({ ...original });

    await cleanupStorage(storage);

    expect(storage._getData()).toEqual(original);
  });

  it('removes obsolete card_protects and card_discards chunks', async () => {
    const storage = createMockStorage({
      storage_schema: 4,
      card_protects_keys: [],
      card_protects_0: [1, 2],
      card_discards_keys: ['card_discards_0'],
      card_discards_0: [5],
      card_faves_keys: ['card_faves_0'],
      card_faves_0: [1, 2],
    });

    await cleanupStorage(storage);

    const data = storage._getData();

    expect(data).not.toHaveProperty('card_protects_keys');
    expect(data).not.toHaveProperty('card_discards_keys');
    expect(data).not.toHaveProperty('card_protects_0');
    expect(data).toHaveProperty('card_faves_0');
  });
});
