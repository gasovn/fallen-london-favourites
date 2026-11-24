// Keys under dev: stay on this device; localToSync does not mirror them.
export const DEV_PREFIX = 'dev:';

export const SYNC_FULL_FLAG = 'dev:sync_full';

/** Raised when per-character mode is on and the only token found could not be read. */
export const JWT_DEGRADED_FLAG = 'dev:jwt_degraded';

export function syncPayload(data: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const key of Object.keys(data)) {
    if (!key.startsWith(DEV_PREFIX)) {
      payload[key] = data[key];
    }
  }

  return payload;
}

/** Writes only when the value changes; false removes the key. */
export async function setDeviceFlag(flag: string, value: boolean): Promise<void> {
  const current = await browser.storage.local.get([flag]);

  if (value) {
    if (current[flag] !== true) {
      await browser.storage.local.set({ [flag]: true });
    }
  } else if (flag in current) {
    await browser.storage.local.remove([flag]);
  }
}
