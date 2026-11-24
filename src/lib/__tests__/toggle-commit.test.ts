// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commitFaveChange, applyState, packTarget } from '../toggle';
import { unpackSet, packSet } from '../storage';
import { SYNC_FULL_FLAG } from '../flags';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import type { FaveData, FaveSets, WriteTarget, ReadTarget } from '@/types';

const A = '900001';
const B = '1000002';

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function tokenFor(charId: string): string {
  return `${base64Url('{}')}.${base64Url(JSON.stringify({ CharacterId: charId }))}.sig`;
}

function setActiveCharacter(charId: string): void {
  localStorage.setItem('access_token', tokenFor(charId));
}

function setCharacterName(name: string): void {
  document.body.innerHTML = `<div id="accessible-sidebar"><a href="/profile/${encodeURIComponent(name)}">x</a></div>`;
}

function makeFaveData(
  writeTarget: WriteTarget,
  readTarget: ReadTarget,
  loadedCharId: string | null,
  sets: Partial<FaveSets> = {},
): FaveData {
  return {
    branch_faves: new Set(),
    branch_avoids: new Set(),
    storylet_faves: new Set(),
    storylet_avoids: new Set(),
    card_faves: new Set(),
    card_avoids: new Set(),
    options: {
      branch_reorder_mode: 'branch_reorder_active',
      switch_mode: 'click_through',
      click_protection: 'off',
    },
    loadedCharId,
    readTarget,
    writeTarget,
    ...sets,
  };
}

const faveBranch = (id: number) => (sets: FaveSets) =>
  applyState(id, 'fave', sets.branch_faves, sets.branch_avoids);

function setsOf(branchFaves: number[]): FaveSets {
  return {
    branch_faves: new Set(branchFaves),
    branch_avoids: new Set(),
    storylet_faves: new Set(),
    storylet_avoids: new Set(),
    card_faves: new Set(),
    card_avoids: new Set(),
  };
}

describe('commitFaveChange', () => {
  let local: ReturnType<typeof createMockStorage>;
  let sync: ReturnType<typeof createMockStorage>;

  function stub(initial: Record<string, unknown> = {}): void {
    local = createMockStorage(initial);
    sync = createMockStorage();
    vi.stubGlobal('browser', { storage: { local, sync } });
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    stub();
  });

  it('does nothing when the target is blocked', async () => {
    setActiveCharacter(A);

    const faveData = makeFaveData({ kind: 'blocked' }, { kind: 'default' }, null);

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()).toEqual({});
    expect(faveData.branch_faves.has(42)).toBe(false);
  });

  it('writes to the active character profile and captures the name', async () => {
    setActiveCharacter(A);
    setCharacterName('Jane Doe');
    stub({ ...packSet(new Set([7]), 'branch_faves') }); // a default that is inherited

    const faveData = makeFaveData({ kind: 'profile', charId: A }, { kind: 'default' }, A, {
      branch_faves: new Set([7]),
    });

    await commitFaveChange(faveData, faveBranch(42));

    const data = local._getData();

    expect(unpackSet(data, 'p:900001:branch_faves')).toEqual(new Set([7, 42]));
    expect(data['p:registry']).toEqual({ '900001': 'Jane Doe' });
    expect(unpackSet(data, 'branch_faves')).toEqual(new Set([7]));
  });

  it('drops the write when the live token resolves to a different character', async () => {
    setActiveCharacter(B); // the tab is logged in as B

    const faveData = makeFaveData(
      { kind: 'profile', charId: A },
      { kind: 'profile', charId: A },
      A,
    );

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()).toEqual({});
  });

  it('drops the write while the profile it reads from is still syncing', async () => {
    setActiveCharacter(A);
    // the profile registry references a chunk that has not arrived yet
    stub({ 'p:900001:branch_faves_keys': ['p:900001:branch_faves_0'] });

    const faveData = makeFaveData(
      { kind: 'profile', charId: A },
      { kind: 'profile', charId: A },
      A,
    );

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()).toEqual({ 'p:900001:branch_faves_keys': ['p:900001:branch_faves_0'] });
  });

  it('saves the same edit once the missing chunk has arrived', async () => {
    setActiveCharacter(A);
    stub({ 'p:900001:branch_faves_keys': ['p:900001:branch_faves_0'] });

    const faveData = makeFaveData(
      { kind: 'profile', charId: A },
      { kind: 'profile', charId: A },
      A,
    );

    await commitFaveChange(faveData, faveBranch(42));
    await local.set({ 'p:900001:branch_faves_0': [7] });
    await commitFaveChange(faveData, faveBranch(42));

    expect(unpackSet(local._getData(), 'p:900001:branch_faves')).toEqual(new Set([7, 42]));
  });

  it('drops the first edit of a character while the shared list it would copy is incomplete', async () => {
    setActiveCharacter(A);

    const before = { branch_faves_keys: ['branch_faves_0', 'branch_faves_1'], branch_faves_0: [1] };

    stub({ ...before });

    const faveData = makeFaveData({ kind: 'profile', charId: A }, { kind: 'default' }, A);

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()).toEqual(before);
  });

  it('drops the write when a profile created after load is incomplete', async () => {
    setActiveCharacter(A);

    const before = {
      ...packTarget(setsOf([7]), { kind: 'default' }),
      'p:900001:branch_faves_keys': ['p:900001:branch_faves_0'],
    };

    stub({ ...before });

    const faveData = makeFaveData({ kind: 'profile', charId: A }, { kind: 'default' }, A);

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()).toEqual(before);
  });

  it('builds on the complete set in the store, not on the partial copy the page loaded', async () => {
    setActiveCharacter(A);
    // The store holds the chunk that was missing when the page loaded.
    stub(packTarget(setsOf([1, 2]), { kind: 'profile', charId: A }));

    // faveData still holds the partial read.
    const faveData = makeFaveData(
      { kind: 'profile', charId: A },
      { kind: 'profile', charId: A },
      A,
      {
        branch_faves: new Set([1]),
      },
    );

    await commitFaveChange(faveData, faveBranch(3));

    expect(unpackSet(local._getData(), 'p:900001:branch_faves')).toEqual(new Set([1, 2, 3]));
  });

  it('refuses a growing write that would overflow the sync quota and raises the storage-full flag', async () => {
    setActiveCharacter(A);

    const filler: Record<string, unknown> = {};

    for (let i = 0; i < 510; i++) {
      filler[`k${i}`] = 1;
    }

    stub(filler);

    const faveData = makeFaveData({ kind: 'profile', charId: A }, { kind: 'default' }, A);

    await commitFaveChange(faveData, faveBranch(42));

    const data = local._getData();

    expect(data).not.toHaveProperty('p:900001:branch_faves_keys');
    expect(data[SYNC_FULL_FLAG]).toBe(true);
    expect(faveData.branch_faves.has(42)).toBe(false);
  });

  it('counts the character name the save adds when checking the quota', async () => {
    setActiveCharacter(A);
    setCharacterName('Jane');

    // 505 keys: the first edit adds 7 more (6 registries and a chunk), the name an 8th
    const filler: Record<string, unknown> = { storage_schema: 5 };

    for (let i = 0; i < 504; i++) {
      filler[`k${i}`] = 1;
    }

    stub(filler);

    const faveData = makeFaveData({ kind: 'profile', charId: A }, { kind: 'default' }, A);

    await commitFaveChange(faveData, faveBranch(42));

    const data = local._getData();

    expect(data).not.toHaveProperty('p:900001:branch_faves_keys');
    expect(data[SYNC_FULL_FLAG]).toBe(true);
  });

  it('counts the schema marker the first save adds when checking the quota', async () => {
    // 505 keys and no marker: the first edit adds 7, the marker an 8th
    const filler: Record<string, unknown> = {};

    for (let i = 0; i < 505; i++) {
      filler[`k${i}`] = 1;
    }

    stub(filler);

    const faveData = makeFaveData({ kind: 'default' }, { kind: 'default' }, null);

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()).not.toHaveProperty('branch_faves_keys');
    expect(local._getData()[SYNC_FULL_FLAG]).toBe(true);
  });

  it('lets a shrinking write through while the area is over the quota', async () => {
    const filler: Record<string, unknown> = {};

    for (let i = 0; i < 520; i++) {
      filler[`k${i}`] = 1;
    }

    stub({ ...filler, ...packTarget(setsOf([7, 8]), { kind: 'default' }) });

    const faveData = makeFaveData({ kind: 'default' }, { kind: 'default' }, null);

    await commitFaveChange(faveData, (sets) =>
      applyState(8, 'none', sets.branch_faves, sets.branch_avoids),
    );

    expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([7]));
    expect(local._getData()).not.toHaveProperty(SYNC_FULL_FLAG);
  });

  it('adds a captured name to the names already known', async () => {
    setActiveCharacter(B);
    setCharacterName('Bob');
    stub({ 'p:registry': { [A]: 'Alice' } });

    const faveData = makeFaveData({ kind: 'profile', charId: B }, { kind: 'default' }, B);

    await commitFaveChange(faveData, faveBranch(42));

    expect(local._getData()['p:registry']).toEqual({ [A]: 'Alice', [B]: 'Bob' });
  });

  it('creates a profile from the shared default by default', async () => {
    setActiveCharacter(A);
    // the shared default the page was showing
    stub(packTarget(setsOf([7, 8]), { kind: 'default' }));

    const faveData = makeFaveData({ kind: 'profile', charId: A }, { kind: 'default' }, A, {
      branch_faves: new Set([7, 8]),
    });

    await commitFaveChange(faveData, faveBranch(42));

    expect(unpackSet(local._getData(), 'p:900001:branch_faves')).toEqual(new Set([7, 8, 42]));
  });

  it('creates an empty profile when "start empty" is set', async () => {
    setActiveCharacter(A);
    stub({ start_empty: true, ...packTarget(setsOf([7, 8]), { kind: 'default' }) });

    const faveData = makeFaveData(
      { kind: 'profile', charId: A },
      { kind: 'default' },
      A,
      { branch_faves: new Set([7, 8]) }, // the shared list the page was showing
    );

    await commitFaveChange(faveData, faveBranch(42));

    expect(unpackSet(local._getData(), 'p:900001:branch_faves')).toEqual(new Set([42]));
  });

  describe('several edits before the page reloads its data', () => {
    const profileA = { kind: 'profile', charId: A } as const;
    const stored = (name: string): number[] =>
      [...unpackSet(local._getData(), name)].sort((a, b) => a - b);

    it('keeps both edits of a character whose profile the first one created', async () => {
      setActiveCharacter(A);
      stub(packTarget(setsOf([7]), { kind: 'default' }));

      const faveData = makeFaveData(profileA, { kind: 'default' }, A, {
        branch_faves: new Set([7]),
      });

      await commitFaveChange(faveData, faveBranch(42));
      await commitFaveChange(faveData, faveBranch(43));

      expect(stored('p:900001:branch_faves')).toEqual([7, 42, 43]);
    });

    it('does not copy the shared list into a "start empty" profile on the second edit', async () => {
      setActiveCharacter(A);
      stub({ start_empty: true, ...packTarget(setsOf([7]), { kind: 'default' }) });

      const faveData = makeFaveData(profileA, { kind: 'default' }, A, {
        branch_faves: new Set([7]),
      });

      await commitFaveChange(faveData, faveBranch(42));
      await commitFaveChange(faveData, faveBranch(43));

      expect(stored('p:900001:branch_faves')).toEqual([42, 43]);
    });

    it('builds on a profile another tab created after this page loaded', async () => {
      setActiveCharacter(A);
      stub(packTarget(setsOf([7]), { kind: 'default' }));

      const faveData = makeFaveData(profileA, { kind: 'default' }, A, {
        branch_faves: new Set([7]),
      });

      await local.set(packTarget(setsOf([7, 50]), profileA));
      await commitFaveChange(faveData, faveBranch(42));

      expect(stored('p:900001:branch_faves')).toEqual([7, 42, 50]);
    });

    it('keeps both of two overlapping edits to a profile', async () => {
      setActiveCharacter(A);
      stub(packTarget(setsOf([7]), profileA));

      const faveData = makeFaveData(profileA, profileA, A, { branch_faves: new Set([7]) });

      await Promise.all([
        commitFaveChange(faveData, faveBranch(42)),
        commitFaveChange(faveData, faveBranch(43)),
      ]);

      expect(stored('p:900001:branch_faves')).toEqual([7, 42, 43]);
      expect(faveData.branch_faves).toEqual(new Set([7, 42, 43]));
    });

    it('keeps both of two overlapping edits to the shared list', async () => {
      stub(packTarget(setsOf([7]), { kind: 'default' }));

      const faveData = makeFaveData({ kind: 'default' }, { kind: 'default' }, null, {
        branch_faves: new Set([7]),
      });

      await Promise.all([
        commitFaveChange(faveData, faveBranch(42)),
        commitFaveChange(faveData, faveBranch(43)),
      ]);

      expect(stored('branch_faves')).toEqual([7, 42, 43]);
    });

    it('still saves an edit made after one that failed', async () => {
      stub(packTarget(setsOf([7]), { kind: 'default' }));

      const faveData = makeFaveData({ kind: 'default' }, { kind: 'default' }, null, {
        branch_faves: new Set([7]),
      });
      const failed = commitFaveChange(faveData, () => {
        throw new Error('boom');
      });

      await expect(failed).rejects.toThrow('boom');
      await commitFaveChange(faveData, faveBranch(43));

      expect(stored('branch_faves')).toEqual([7, 43]);
    });
  });
});
