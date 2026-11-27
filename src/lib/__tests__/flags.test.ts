import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import {
  syncPayload,
  setDeviceFlag,
  SYNC_FULL_FLAG,
  JWT_DEGRADED_FLAG,
  WHATS_NEW_FLAG,
} from '../flags';

describe('syncPayload', () => {
  it('strips device-local dev: keys and keeps everything else', () => {
    const result = syncPayload({
      storage_schema: 5,
      branch_faves_keys: ['branch_faves_0'],
      [SYNC_FULL_FLAG]: true,
      [JWT_DEGRADED_FLAG]: true,
      [WHATS_NEW_FLAG]: true,
    });

    expect(result).toEqual({ storage_schema: 5, branch_faves_keys: ['branch_faves_0'] });
    expect(result).not.toHaveProperty(SYNC_FULL_FLAG);
    expect(result).not.toHaveProperty(JWT_DEGRADED_FLAG);
    expect(result).not.toHaveProperty(WHATS_NEW_FLAG);
  });
});

describe('setDeviceFlag', () => {
  let mock: ReturnType<typeof createMockStorage>;
  let setSpy: ReturnType<typeof vi.fn<(items: Record<string, unknown>) => Promise<void>>>;

  beforeEach(() => {
    mock = createMockStorage();
    setSpy = vi.fn<(items: Record<string, unknown>) => Promise<void>>(mock.set);
    mock.set = setSpy;
    vi.stubGlobal('browser', { storage: { local: mock } });
  });

  it('sets a flag that was absent', async () => {
    await setDeviceFlag(SYNC_FULL_FLAG, true);

    expect(mock._getData()[SYNC_FULL_FLAG]).toBe(true);
  });

  it('does not write again when the flag is already set', async () => {
    await setDeviceFlag(SYNC_FULL_FLAG, true);
    setSpy.mockClear();

    await setDeviceFlag(SYNC_FULL_FLAG, true);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('clears a flag that was set', async () => {
    await setDeviceFlag(SYNC_FULL_FLAG, true);
    await setDeviceFlag(SYNC_FULL_FLAG, false);

    expect(mock._getData()).not.toHaveProperty(SYNC_FULL_FLAG);
  });

  it('leaves an absent flag absent when clearing it', async () => {
    await setDeviceFlag(SYNC_FULL_FLAG, false);

    expect(mock._getData()).not.toHaveProperty(SYNC_FULL_FLAG);
  });
});
