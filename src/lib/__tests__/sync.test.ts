import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import { localToSync, syncToLocal } from '../sync';
import { SYNC_FULL_FLAG } from '../flags';

describe('localToSync cleanup', () => {
  let mockLocal: ReturnType<typeof createMockStorage>;
  let mockSync: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockLocal = createMockStorage();
    mockSync = createMockStorage();

    vi.stubGlobal('browser', {
      storage: {
        local: mockLocal,
        sync: mockSync,
        onChanged: { addListener: vi.fn() },
      },
    });
  });

  it('removes orphaned chunks from sync after write', async () => {
    mockLocal = createMockStorage({
      storage_schema: 4,
      branch_faves_keys: [],
    });
    mockSync = createMockStorage({
      storage_schema: 4,
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [100],
    });
    vi.stubGlobal('browser', {
      storage: {
        local: mockLocal,
        sync: mockSync,
        onChanged: { addListener: vi.fn() },
      },
    });

    await localToSync();

    const syncData = mockSync._getData();

    expect(syncData.branch_faves_keys).toEqual([]);
    expect(syncData).not.toHaveProperty('branch_faves_0');
  });

  it('removes zombie keys from sync after write', async () => {
    mockLocal = createMockStorage({
      storage_schema: 4,
      click_protection: 'shift',
    });
    mockSync = createMockStorage({
      storage_schema: 4,
      block_action: true,
      click_protection: 'off',
    });
    vi.stubGlobal('browser', {
      storage: {
        local: mockLocal,
        sync: mockSync,
        onChanged: { addListener: vi.fn() },
      },
    });

    await localToSync();

    const syncData = mockSync._getData();

    expect(syncData).not.toHaveProperty('block_action');
    expect(syncData.click_protection).toBe('shift');
  });

  it('preserves sync write when cleanup throws', async () => {
    mockLocal = createMockStorage({
      storage_schema: 4,
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [100],
      click_protection: 'shift',
    });
    mockSync = createMockStorage({
      block_action: true,
    });

    mockSync.remove = async () => {
      throw new Error('Sync quota exceeded');
    };

    vi.stubGlobal('browser', {
      storage: {
        local: mockLocal,
        sync: mockSync,
        onChanged: { addListener: vi.fn() },
      },
    });

    await localToSync();

    const syncData = mockSync._getData();

    expect(syncData.branch_faves_keys).toEqual(['branch_faves_0']);
    expect(syncData.branch_faves_0).toEqual([100]);
    expect(syncData.click_protection).toBe('shift');
    // Zombie remains because cleanup failed — that's OK
    expect(syncData).toHaveProperty('block_action');
  });

  it('does not remove unknown keys from sync', async () => {
    mockLocal = createMockStorage({ storage_schema: 4 });
    mockSync = createMockStorage({
      storage_schema: 4,
      future_key_from_newer_version: true,
    });
    vi.stubGlobal('browser', {
      storage: {
        local: mockLocal,
        sync: mockSync,
        onChanged: { addListener: vi.fn() },
      },
    });

    await localToSync();

    const syncData = mockSync._getData();

    expect(syncData).toHaveProperty('future_key_from_newer_version');
  });
});

describe('mirror: device flags, quota and profile chunks', () => {
  let mockLocal: ReturnType<typeof createMockStorage>;
  let mockSync: ReturnType<typeof createMockStorage>;

  function stub(local: Record<string, unknown>, sync: Record<string, unknown> = {}): void {
    mockLocal = createMockStorage(local);
    mockSync = createMockStorage(sync);
    vi.stubGlobal('browser', {
      storage: { local: mockLocal, sync: mockSync, onChanged: { addListener: vi.fn() } },
    });
  }

  // An older build mirrors everything it finds in local, flags included.
  it('does not pull device flags that reached sync, and clears them there', async () => {
    stub(
      { storage_schema: 5 },
      { storage_schema: 5, switch_mode: 'modifier_click', [SYNC_FULL_FLAG]: true },
    );

    await syncToLocal();

    expect(mockLocal._getData()).toEqual({ storage_schema: 5, switch_mode: 'modifier_click' });

    await localToSync();

    expect(mockSync._getData()).not.toHaveProperty(SYNC_FULL_FLAG);
  });

  it('does not mirror device-local dev: flags to sync', async () => {
    stub({
      storage_schema: 5,
      branch_faves_keys: [],
      [SYNC_FULL_FLAG]: true,
      'dev:jwt_degraded': true,
    });

    await localToSync();

    const syncData = mockSync._getData();

    expect(syncData).not.toHaveProperty(SYNC_FULL_FLAG);
    expect(syncData).not.toHaveProperty('dev:jwt_degraded');
    expect(syncData.storage_schema).toBe(5);
  });

  it('skips the set and raises the flag when local alone exceeds the key cap', async () => {
    const big: Record<string, unknown> = { storage_schema: 5 };

    for (let i = 0; i < 600; i++) {
      big[`branch_faves_${i}`] = [i];
    }

    stub(big);

    await localToSync();

    expect(Object.keys(mockSync._getData())).toHaveLength(0);
    expect(mockLocal._getData().branch_faves_0).toEqual([0]);
    expect(mockLocal._getData()[SYNC_FULL_FLAG]).toBe(true);
  });

  it('removes a profile chunk from sync once the registry it mirrors stops naming it', async () => {
    stub(
      {
        storage_schema: 5,
        'p:111:storylet_faves_keys': [],
        'p:222:storylet_faves_keys': ['p:222:storylet_faves_0'],
        'p:222:storylet_faves_0': [8],
      },
      {
        storage_schema: 5,
        'p:111:storylet_faves_keys': ['p:111:storylet_faves_0'],
        'p:111:storylet_faves_0': [7],
        'p:222:storylet_faves_keys': ['p:222:storylet_faves_0'],
        'p:222:storylet_faves_0': [8],
      },
    );

    await localToSync();

    expect(mockSync._getData()).toEqual({
      storage_schema: 5,
      'p:111:storylet_faves_keys': [],
      'p:222:storylet_faves_keys': ['p:222:storylet_faves_0'],
      'p:222:storylet_faves_0': [8],
    });
  });

  it('skips the set when each device is under the key cap and their union is over it', async () => {
    const here: Record<string, unknown> = { storage_schema: 5 };
    const there: Record<string, unknown> = { storage_schema: 5 };

    for (let i = 0; i < 300; i++) {
      here[`branch_faves_${i}`] = [i];
      there[`card_faves_${i}`] = [i];
    }

    stub(here, there);

    await localToSync();

    expect(mockSync._getData()).toEqual(there);
    expect(mockLocal._getData()[SYNC_FULL_FLAG]).toBe(true);
  });

  it('does not delete a real chunk in the cleanup when over quota', async () => {
    const big: Record<string, unknown> = { storage_schema: 5 };

    for (let i = 0; i < 600; i++) {
      big[`storylet_faves_${i}`] = [i];
    }

    // The chunk looks orphaned, but its registry update may not have synced yet.
    stub(big, { branch_faves_keys: [], branch_faves_0: [42] });

    await localToSync();

    expect(mockSync._getData().branch_faves_0).toEqual([42]);
  });

  it('clears a raised storage-full flag once a mirror succeeds', async () => {
    stub({ storage_schema: 5, branch_faves_keys: [], [SYNC_FULL_FLAG]: true });

    await localToSync();

    expect(mockLocal._getData()).not.toHaveProperty(SYNC_FULL_FLAG);
  });
});
