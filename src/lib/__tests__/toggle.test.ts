import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNextState,
  getNextCardState,
  getCurrentState,
  applyState,
  saveFaves,
  type FaveSets,
} from '../toggle';
import { createMockStorage } from '../../../tests/helpers/mock-storage';

describe('getCurrentState', () => {
  it('returns fave when id is in faves set', () => {
    const faves = new Set([1, 2, 3]);
    const avoids = new Set([4, 5]);

    expect(getCurrentState(1, faves, avoids)).toBe('fave');
  });

  it('returns avoid when id is in avoids set', () => {
    const faves = new Set([1, 2]);
    const avoids = new Set([3, 4]);

    expect(getCurrentState(3, faves, avoids)).toBe('avoid');
  });

  it('returns none when id is in neither set', () => {
    const faves = new Set([1, 2]);
    const avoids = new Set([3, 4]);

    expect(getCurrentState(99, faves, avoids)).toBe('none');
  });

  it('returns fave when id is in both sets (fave takes priority)', () => {
    const faves = new Set([1]);
    const avoids = new Set([1]);

    expect(getCurrentState(1, faves, avoids)).toBe('fave');
  });
});

describe('getNextState (branches/storylets)', () => {
  describe('click_through mode', () => {
    it('none -> fave', () => {
      expect(getNextState('none', 'click_through', false)).toBe('fave');
    });

    it('fave -> avoid', () => {
      expect(getNextState('fave', 'click_through', false)).toBe('avoid');
    });

    it('avoid -> none', () => {
      expect(getNextState('avoid', 'click_through', false)).toBe('none');
    });

    it('ignores modifier key in click_through mode', () => {
      expect(getNextState('none', 'click_through', true)).toBe('fave');
      expect(getNextState('fave', 'click_through', true)).toBe('avoid');
      expect(getNextState('avoid', 'click_through', true)).toBe('none');
    });
  });

  describe('modifier_click mode — normal click', () => {
    it('none -> fave', () => {
      expect(getNextState('none', 'modifier_click', false)).toBe('fave');
    });

    it('fave -> none (toggle off)', () => {
      expect(getNextState('fave', 'modifier_click', false)).toBe('none');
    });

    it('avoid -> fave (switch to fave)', () => {
      expect(getNextState('avoid', 'modifier_click', false)).toBe('fave');
    });
  });

  describe('modifier_click mode — modifier click', () => {
    it('none -> avoid', () => {
      expect(getNextState('none', 'modifier_click', true)).toBe('avoid');
    });

    it('avoid -> none (toggle off)', () => {
      expect(getNextState('avoid', 'modifier_click', true)).toBe('none');
    });

    it('fave -> avoid (switch to avoid)', () => {
      expect(getNextState('fave', 'modifier_click', true)).toBe('avoid');
    });
  });
});

describe('getNextCardState', () => {
  describe('click_through mode', () => {
    it('none -> fave', () => {
      expect(getNextCardState('none', 'click_through', false)).toBe('fave');
    });

    it('fave -> avoid', () => {
      expect(getNextCardState('fave', 'click_through', false)).toBe('avoid');
    });

    it('avoid -> none', () => {
      expect(getNextCardState('avoid', 'click_through', false)).toBe('none');
    });
  });

  describe('modifier_click mode — normal click', () => {
    it('none -> fave', () => {
      expect(getNextCardState('none', 'modifier_click', false)).toBe('fave');
    });

    it('fave -> none', () => {
      expect(getNextCardState('fave', 'modifier_click', false)).toBe('none');
    });

    it('avoid -> fave', () => {
      expect(getNextCardState('avoid', 'modifier_click', false)).toBe('fave');
    });
  });

  describe('modifier_click mode — modifier click', () => {
    it('none -> avoid', () => {
      expect(getNextCardState('none', 'modifier_click', true)).toBe('avoid');
    });

    it('avoid -> none', () => {
      expect(getNextCardState('avoid', 'modifier_click', true)).toBe('none');
    });

    it('fave -> avoid', () => {
      expect(getNextCardState('fave', 'modifier_click', true)).toBe('avoid');
    });
  });
});

describe('applyState', () => {
  it('fave: adds to faves, removes from avoids', () => {
    const faves = new Set<number>();
    const avoids = new Set([42]);

    applyState(42, 'fave', faves, avoids);
    expect(faves.has(42)).toBe(true);
    expect(avoids.has(42)).toBe(false);
  });

  it('avoid: adds to avoids, removes from faves', () => {
    const faves = new Set([42]);
    const avoids = new Set<number>();

    applyState(42, 'avoid', faves, avoids);
    expect(faves.has(42)).toBe(false);
    expect(avoids.has(42)).toBe(true);
  });

  it('none: removes from both sets', () => {
    const faves = new Set([42]);
    const avoids = new Set([42]);

    applyState(42, 'none', faves, avoids);
    expect(faves.has(42)).toBe(false);
    expect(avoids.has(42)).toBe(false);
  });

  it('does not affect other items in sets', () => {
    const faves = new Set([1, 2, 3]);
    const avoids = new Set([4, 5]);

    applyState(2, 'avoid', faves, avoids);
    expect(faves).toEqual(new Set([1, 3]));
    expect(avoids).toEqual(new Set([2, 4, 5]));
  });
});

describe('saveFaves', () => {
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
    vi.stubGlobal('browser', {
      storage: { local: mockStorage },
    });
  });

  function emptySets(): FaveSets {
    return {
      branch_faves: new Set(),
      branch_avoids: new Set(),
      storylet_faves: new Set(),
      storylet_avoids: new Set(),
      card_faves: new Set(),
      card_avoids: new Set(),
    };
  }

  it('removes orphaned chunks after save', async () => {
    mockStorage = createMockStorage({
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [100, 200],
    });
    vi.stubGlobal('browser', { storage: { local: mockStorage } });

    const sets = emptySets();

    await saveFaves(sets);

    const data = mockStorage._getData();

    expect(data.branch_faves_keys).toEqual([]);
    expect(data).not.toHaveProperty('branch_faves_0');
  });

  it('does not remove valid chunks', async () => {
    const sets = emptySets();

    sets.branch_faves = new Set([100, 200]);

    await saveFaves(sets);

    const data = mockStorage._getData();

    expect(data.branch_faves_keys).toEqual(['branch_faves_0']);
    expect(data.branch_faves_0).toEqual([100, 200]);
  });

  it('removes _1 when set shrinks to one chunk', async () => {
    mockStorage = createMockStorage({
      branch_faves_keys: ['branch_faves_0', 'branch_faves_1'],
      branch_faves_0: Array.from({ length: 512 }, (_, i) => i),
      branch_faves_1: [999],
    });
    vi.stubGlobal('browser', { storage: { local: mockStorage } });

    const sets = emptySets();

    sets.branch_faves = new Set([42]);

    await saveFaves(sets);

    const data = mockStorage._getData();

    expect(data.branch_faves_keys).toEqual(['branch_faves_0']);
    expect(data).not.toHaveProperty('branch_faves_1');
  });

  it('handles all 6 categories independently', async () => {
    mockStorage = createMockStorage({
      branch_faves_keys: [],
      branch_faves_0: [100],
      card_faves_keys: [],
      card_faves_0: [200],
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [300],
    });
    vi.stubGlobal('browser', { storage: { local: mockStorage } });

    const sets = emptySets();

    sets.storylet_faves = new Set([300]);

    await saveFaves(sets);

    const data = mockStorage._getData();

    expect(data).not.toHaveProperty('branch_faves_0');
    expect(data).not.toHaveProperty('card_faves_0');
    expect(data).toHaveProperty('storylet_faves_0');
  });

  it('survives cleanup failure (remove throws)', async () => {
    const failingStorage = createMockStorage({
      branch_faves_keys: [],
      branch_faves_0: [100],
    });

    failingStorage.remove = async () => {
      throw new Error('Storage error');
    };

    vi.stubGlobal('browser', { storage: { local: failingStorage } });

    const sets = emptySets();

    // Should not throw — cleanup failure is swallowed
    await expect(saveFaves(sets)).resolves.toBeUndefined();

    // Data is still written correctly despite cleanup failure
    const data = failingStorage._getData();

    expect(data.branch_faves_keys).toEqual([]);
  });

  it('skips orphan cleanup when _keys changed between save and read', async () => {
    mockStorage = createMockStorage({
      branch_faves_0: [999],
    });

    const originalGet = mockStorage.get;

    mockStorage.get = async (keys: Parameters<typeof originalGet>[0]) => {
      const result = await originalGet(keys);

      if (keys === null) {
        // Simulate a concurrent save that changed _keys
        result.branch_faves_keys = ['branch_faves_0'];
      }

      return result;
    };

    vi.stubGlobal('browser', { storage: { local: mockStorage } });

    const sets = emptySets();

    await saveFaves(sets);

    // Orphan should NOT be removed — guard detected _keys mismatch
    const data = mockStorage._getData();

    expect(data).toHaveProperty('branch_faves_0');
  });

  it('two sequential saves — second data is intact', async () => {
    const sets1 = emptySets();

    sets1.branch_faves = new Set([100, 200]);
    sets1.card_faves = new Set([300]);

    await saveFaves(sets1);

    const sets2 = emptySets();

    sets2.branch_faves = new Set([400]);
    sets2.storylet_faves = new Set([500, 600]);

    await saveFaves(sets2);

    const data = mockStorage._getData();

    expect(data.branch_faves_0).toEqual([400]);
    expect(data).not.toHaveProperty('card_faves_0');
    expect(data.storylet_faves_0).toEqual([500, 600]);
  });
});
