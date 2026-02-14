import { describe, it, expect } from 'vitest';
import { packSet, unpackSet } from '../storage';

describe('packSet', () => {
  it('packs an empty set', () => {
    const result = packSet(new Set(), 'test');

    expect(result).toEqual({ test_keys: [] });
  });

  it('packs a small set into a single chunk', () => {
    const result = packSet(new Set([3, 1, 2]), 'branch_faves');

    expect(result).toEqual({
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [1, 2, 3],
    });
  });

  it('sorts numerically', () => {
    const result = packSet(new Set([1, 10, 100, 2, 20, 3]), 'test');

    expect(result.test_0).toEqual([1, 2, 3, 10, 20, 100]);
  });

  it('packs a large set into multiple chunks of 512', () => {
    const items = new Set(Array.from({ length: 1025 }, (_, i) => i));
    const result = packSet(items, 'big');

    expect(result.big_keys).toEqual(['big_0', 'big_1', 'big_2']);
    expect((result.big_0 as number[]).length).toBe(512);
    expect((result.big_1 as number[]).length).toBe(512);
    expect((result.big_2 as number[]).length).toBe(1);
  });

  it('handles exactly 512 items in one chunk', () => {
    const items = new Set(Array.from({ length: 512 }, (_, i) => i));
    const result = packSet(items, 'exact');

    expect(result.exact_keys).toEqual(['exact_0']);
    expect((result.exact_0 as number[]).length).toBe(512);
  });

  it('handles 513 items splitting into two chunks', () => {
    const items = new Set(Array.from({ length: 513 }, (_, i) => i));
    const result = packSet(items, 'split');

    expect(result.split_keys).toEqual(['split_0', 'split_1']);
    expect((result.split_0 as number[]).length).toBe(512);
    expect((result.split_1 as number[]).length).toBe(1);
  });
});

describe('unpackSet', () => {
  it('unpacks an empty set', () => {
    const result = unpackSet({ test_keys: [] }, 'test');

    expect(result.size).toBe(0);
  });

  it('unpacks a single chunk', () => {
    const data = {
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [1, 2, 3],
    };
    const result = unpackSet(data, 'branch_faves');

    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it('unpacks multiple chunks', () => {
    const data = {
      big_keys: ['big_0', 'big_1'],
      big_0: [1, 2, 3],
      big_1: [4, 5, 6],
    };
    const result = unpackSet(data, 'big');

    expect(result).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('returns empty set when keys are missing', () => {
    const result = unpackSet({}, 'missing');

    expect(result.size).toBe(0);
  });

  it('skips missing chunk data gracefully', () => {
    const data = {
      partial_keys: ['partial_0', 'partial_1'],
      partial_0: [1, 2, 3],
      // partial_1 is missing
    };
    const result = unpackSet(data, 'partial');

    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it('skips non-array chunk data gracefully', () => {
    const data = {
      bad_keys: ['bad_0', 'bad_1'],
      bad_0: [1, 2, 3],
      bad_1: 'not an array',
    };
    const result = unpackSet(data, 'bad');

    expect(result).toEqual(new Set([1, 2, 3]));
  });
});

describe('pack/unpack round-trip', () => {
  it('preserves data through round-trip', () => {
    const original = new Set([42, 7, 100, 999, 1]);
    const packed = packSet(original, 'rt');
    const unpacked = unpackSet(packed, 'rt');

    expect(unpacked).toEqual(original);
  });

  it('preserves large dataset through round-trip', () => {
    const original = new Set(Array.from({ length: 2000 }, (_, i) => i * 3));
    const packed = packSet(original, 'large');
    const unpacked = unpackSet(packed, 'large');

    expect(unpacked).toEqual(original);
  });
});
