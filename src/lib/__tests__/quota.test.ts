import { describe, it, expect } from 'vitest';
import {
  projectArea,
  wouldExceed,
  exceedsCaps,
  SYNC_MAX_ITEMS,
  SYNC_QUOTA_BYTES,
  type AreaProjection,
} from '../quota';

describe('projectArea', () => {
  it('counts zero for an empty area', () => {
    expect(projectArea({})).toEqual({ bytes: 0, keys: 0 });
  });

  it('counts every key and the serialised byte size', () => {
    const result = projectArea({ ab: [1, 2], c: 'x' });

    expect(result.keys).toBe(2);
    // 'ab' + '[1,2]' = 2 + 5, 'c' + '"x"' = 1 + 3
    expect(result.bytes).toBe(2 + 5 + 1 + 3);
  });
});

describe('wouldExceed', () => {
  it('refuses a write that grows the key count past the cap', () => {
    const current: AreaProjection = { keys: SYNC_MAX_ITEMS, bytes: 100 };
    const projected: AreaProjection = { keys: SYNC_MAX_ITEMS + 1, bytes: 110 };

    expect(wouldExceed(projected, current)).toBe(true);
  });

  it('refuses a write that grows the byte size past the cap', () => {
    const current: AreaProjection = { keys: 50, bytes: 100 };
    const projected: AreaProjection = { keys: 50, bytes: SYNC_QUOTA_BYTES + 1 };

    expect(wouldExceed(projected, current)).toBe(true);
  });

  it('permits a growing write that stays under both caps', () => {
    const current: AreaProjection = { keys: 50, bytes: 4000 };
    const projected: AreaProjection = { keys: 51, bytes: 4100 };

    expect(wouldExceed(projected, current)).toBe(false);
  });

  it('always permits a shrinking write, even when already over a cap', () => {
    const current: AreaProjection = { keys: SYNC_MAX_ITEMS + 1, bytes: 60 };
    const projected: AreaProjection = { keys: SYNC_MAX_ITEMS, bytes: 50 };

    expect(wouldExceed(projected, current)).toBe(false);
  });

  it('permits a write that keeps an area over the cap at the same size', () => {
    const at: AreaProjection = { keys: SYNC_MAX_ITEMS + 1, bytes: 100 };

    expect(wouldExceed(at, at)).toBe(false);
  });
});

describe('exceedsCaps', () => {
  it('is true when the key count is over the cap', () => {
    expect(exceedsCaps({ keys: SYNC_MAX_ITEMS + 1, bytes: 100 })).toBe(true);
  });

  it('is true when the byte size is over the cap', () => {
    expect(exceedsCaps({ keys: 10, bytes: SYNC_QUOTA_BYTES + 1 })).toBe(true);
  });

  it('is false when under both caps', () => {
    expect(exceedsCaps({ keys: 10, bytes: 100 })).toBe(false);
  });
});
