import { describe, it, expect } from 'vitest';
import { getNextState, getNextCardState, getCurrentState, applyState } from '../toggle';

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
