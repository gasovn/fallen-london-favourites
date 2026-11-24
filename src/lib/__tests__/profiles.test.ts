import { describe, it, expect } from 'vitest';
import {
  keyFor,
  profileExists,
  listProfileCharIds,
  keysForProfile,
  isComplete,
  readSets,
  resolveContext,
  renderSets,
  findProfileOrphans,
  REGISTRY_KEY,
} from '../profiles';
import { packSet } from '../storage';
import type { ReadTarget } from '@/types';

const DEFAULT: ReadTarget = { kind: 'default' };
const A = '900001';
const B = '1000002';

function flatStore(): Record<string, unknown> {
  return {
    storage_schema: 5,
    ...packSet(new Set([1, 2]), 'branch_faves'),
    ...packSet(new Set([3]), 'branch_avoids'),
    ...packSet(new Set(), 'storylet_faves'),
    ...packSet(new Set(), 'storylet_avoids'),
    ...packSet(new Set([4]), 'card_faves'),
    ...packSet(new Set(), 'card_avoids'),
  };
}

function withProfile(charId: string, faves: number[]): Record<string, unknown> {
  return {
    ...packSet(new Set(faves), `p:${charId}:branch_faves`),
    ...packSet(new Set(), `p:${charId}:branch_avoids`),
    ...packSet(new Set(), `p:${charId}:storylet_faves`),
    ...packSet(new Set(), `p:${charId}:storylet_avoids`),
    ...packSet(new Set(), `p:${charId}:card_faves`),
    ...packSet(new Set(), `p:${charId}:card_avoids`),
  };
}

describe('keyFor', () => {
  it('returns the flat key for the default target', () => {
    expect(keyFor(DEFAULT, 'branch_faves')).toBe('branch_faves');
  });

  it('returns the namespaced key for a profile target', () => {
    expect(keyFor({ kind: 'profile', charId: A }, 'branch_faves')).toBe('p:900001:branch_faves');
  });
});

describe('profileExists', () => {
  it('is true when at least one chunk registry is present (even empty)', () => {
    expect(profileExists({ 'p:900001:card_faves_keys': [] }, A)).toBe(true);
  });

  it('is false when no chunk registry is present', () => {
    expect(profileExists(flatStore(), A)).toBe(false);
  });

  it('ignores a charId that only appears in the name registry', () => {
    const data = { [REGISTRY_KEY]: { [A]: 'Jane Doe' } };

    expect(profileExists(data, A)).toBe(false);
  });
});

describe('listProfileCharIds', () => {
  it('lists the ids that have a chunk registry, sorted', () => {
    const data = { ...withProfile(B, [1]), ...withProfile(A, [2]) };

    expect(listProfileCharIds(data)).toEqual([A, B].sort());
  });

  it('does not list an id present only in the name registry', () => {
    const data = {
      ...withProfile(A, [1]),
      [REGISTRY_KEY]: { [A]: 'Jane', [B]: 'Deleted Ghost' },
    };

    expect(listProfileCharIds(data)).toEqual([A]);
  });

  it('ignores a registry key whose value is not an array', () => {
    expect(listProfileCharIds({ 'p:900001:branch_faves_keys': 'corrupt' })).toEqual([]);
  });
});

describe('keysForProfile', () => {
  it('returns only the keys belonging to that profile', () => {
    const data = { ...withProfile(A, [1]), ...withProfile(B, [2]), [REGISTRY_KEY]: { [A]: 'x' } };
    const keys = keysForProfile(data, A);

    expect(keys).toContain('p:900001:branch_faves_keys');
    expect(keys.every((k) => k.startsWith('p:900001:'))).toBe(true);
    expect(keys).not.toContain('p:1000002:branch_faves_keys');
    expect(keys).not.toContain(REGISTRY_KEY);
  });

  it('does not take the keys of a character whose id starts with this one', () => {
    const data = {
      ...packSet(new Set([1]), 'p:90000:branch_faves'),
      ...packSet(new Set([2]), 'p:900001:branch_faves'),
    };

    expect(keysForProfile(data, '90000').sort()).toEqual([
      'p:90000:branch_faves_0',
      'p:90000:branch_faves_keys',
    ]);
  });
});

describe('isComplete', () => {
  it('is complete for an intact default store', () => {
    expect(isComplete(flatStore(), DEFAULT)).toBe(true);
  });

  it('is complete for an intact profile', () => {
    expect(isComplete(withProfile(A, [1, 2]), { kind: 'profile', charId: A })).toBe(true);
  });

  it('is incomplete when a referenced chunk has not arrived', () => {
    const data = withProfile(A, [1, 2]);

    delete data['p:900001:branch_faves_0'];

    expect(isComplete(data, { kind: 'profile', charId: A })).toBe(false);
  });

  it('treats an empty registry as complete', () => {
    expect(isComplete({ branch_faves_keys: [] }, DEFAULT)).toBe(true);
  });

  it('treats an absent registry as complete (references nothing)', () => {
    expect(isComplete({}, DEFAULT)).toBe(true);
  });
});

describe('readSets', () => {
  it('reads the flat default sets', () => {
    const sets = readSets(flatStore(), DEFAULT);

    expect(sets.branch_faves).toEqual(new Set([1, 2]));
    expect(sets.card_faves).toEqual(new Set([4]));
  });

  it('reads from the profile namespace', () => {
    const sets = readSets(withProfile(A, [10, 20]), { kind: 'profile', charId: A });

    expect(sets.branch_faves).toEqual(new Set([10, 20]));
  });

  it('reads the chunks that are present when another has not arrived', () => {
    const data = {
      ...packSet(new Set([1, 2]), 'branch_faves'),
      // a second chunk is referenced but not yet delivered
      branch_faves_keys: ['branch_faves_0', 'branch_faves_1'],
    };

    const sets = readSets(data, DEFAULT);

    expect(sets.branch_faves).toEqual(new Set([1, 2]));
  });
});

describe('resolveContext', () => {
  it('reads and writes default when multi is off', () => {
    expect(resolveContext(false, A, flatStore())).toEqual({
      loadedCharId: A,
      readTarget: { kind: 'default' },
      writeTarget: { kind: 'default' },
    });
  });

  it('blocks writes when multi is on but no character resolves', () => {
    expect(resolveContext(true, null, flatStore())).toEqual({
      loadedCharId: null,
      readTarget: { kind: 'default' },
      writeTarget: { kind: 'blocked' },
    });
  });

  it('reads the shared default but writes to the profile while the character has none yet', () => {
    expect(resolveContext(true, A, flatStore())).toEqual({
      loadedCharId: A,
      readTarget: { kind: 'default' },
      writeTarget: { kind: 'profile', charId: A },
    });
  });

  it('reads and writes the profile once it exists', () => {
    const data = { ...flatStore(), ...withProfile(A, [9]) };

    expect(resolveContext(true, A, data)).toEqual({
      loadedCharId: A,
      readTarget: { kind: 'profile', charId: A },
      writeTarget: { kind: 'profile', charId: A },
    });
  });
});

describe('findProfileOrphans', () => {
  it('finds a chunk no longer referenced by its registry', () => {
    const data = withProfile(A, [1]);

    data['p:900001:branch_faves_1'] = [999]; // stale, not in the registry

    expect(findProfileOrphans(data, A)).toEqual(['p:900001:branch_faves_1']);
  });

  it('does not return chunks of another profile or of the flat default', () => {
    const data = {
      ...flatStore(),
      ...withProfile(A, [1]),
      ...withProfile(B, [2]),
      'p:1000002:branch_faves_1': [777], // an orphan of profile B
    };

    expect(findProfileOrphans(data, A)).toEqual([]);
  });

  it('reads an id with a regex metacharacter literally', () => {
    const data = {
      'p:1x2:branch_faves_keys': ['p:1x2:branch_faves_0'],
      'p:1x2:branch_faves_0': [5],
    };

    expect(findProfileOrphans(data, '1.2')).toEqual([]);
  });

  it('does not flag registry keys or the name registry', () => {
    const data = { ...withProfile(A, [1]), [REGISTRY_KEY]: { [A]: 'Jane' } };

    expect(findProfileOrphans(data, A)).toEqual([]);
  });
});

describe('renderSets', () => {
  const store = (): Record<string, unknown> => ({
    ...packSet(new Set([1, 2]), 'branch_faves'),
    ...packSet(new Set([7]), `p:${B}:branch_faves`),
  });
  const shown = (data: Record<string, unknown>, multi: boolean, charId: string | null): number[] =>
    [...renderSets(data, resolveContext(multi, charId, data)).branch_faves].sort((a, b) => a - b);

  it('shows the shared list to a character without a profile', () => {
    expect(shown(store(), true, A)).toEqual([1, 2]);
  });

  it('shows nothing to a character whose profile will start empty', () => {
    expect(shown({ ...store(), start_empty: true }, true, A)).toEqual([]);
  });

  it('"start empty" does not hide an existing profile', () => {
    expect(shown({ ...store(), start_empty: true }, true, B)).toEqual([7]);
  });

  it('"start empty" does not hide the shared list while the feature is off', () => {
    expect(shown({ ...store(), start_empty: true }, false, A)).toEqual([1, 2]);
  });

  it('shows nothing when no character resolves', () => {
    expect(shown(store(), true, null)).toEqual([]);
  });
});
