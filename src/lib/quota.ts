// storage.sync has both limits; with many small profiles the key count is hit first.
export const SYNC_QUOTA_BYTES = 102400;
export const SYNC_MAX_ITEMS = 512;

export interface AreaProjection {
  bytes: number;
  keys: number;
}

/** Key count and JSON size of a snapshot: an estimate of what storage.sync counts. */
export function projectArea(data: Record<string, unknown>): AreaProjection {
  const keys = Object.keys(data);
  let bytes = 0;

  for (const key of keys) {
    bytes += key.length + (JSON.stringify(data[key]) ?? '').length;
  }

  return { bytes, keys: keys.length };
}

/**
 * Refuses only growth past a cap. A shrinking write always passes, so a full
 * area can still be emptied.
 */
export function wouldExceed(projected: AreaProjection, current: AreaProjection): boolean {
  const keysOver = projected.keys > current.keys && projected.keys > SYNC_MAX_ITEMS;
  const bytesOver = projected.bytes > current.bytes && projected.bytes > SYNC_QUOTA_BYTES;

  return keysOver || bytesOver;
}

/** Absolute check for the mirror: the union of all devices may already be over. */
export function exceedsCaps(projection: AreaProjection): boolean {
  return projection.keys > SYNC_MAX_ITEMS || projection.bytes > SYNC_QUOTA_BYTES;
}

// Size refusals only: Chrome's write-rate limits also say "quota" and are transient.
export const QUOTA_REFUSAL = /QuotaExceededError|kQuotaBytes|kMaxItems/;
