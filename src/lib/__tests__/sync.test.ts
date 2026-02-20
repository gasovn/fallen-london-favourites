import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import { localToSync } from '../sync';

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
