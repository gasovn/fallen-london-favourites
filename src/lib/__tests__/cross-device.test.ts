import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import { type Device, useDevice, sets, sorted } from '../../../tests/helpers/clients';
import { localToSync, syncToLocal } from '../sync';
import { saveFaves } from '../toggle';
import { readSets, isComplete, listProfileCharIds } from '../profiles';
import { findOrphanedChunks } from '../cleanup';
import { disableMultiProfile, deleteProfile } from '../multi-profile';
import { exportData, importData } from '../io';

// Two v5 devices on one sync area, with the mirror steps interleaved by hand.

const base = {
  storage_schema: 5,
  multi_toggle: true,
  storylet_faves_keys: ['storylet_faves_0'],
  storylet_faves_0: [1, 2],
  'p:111:storylet_faves_keys': ['p:111:storylet_faves_0'],
  'p:111:storylet_faves_0': [7],
  'p:222:storylet_faves_keys': ['p:222:storylet_faves_0'],
  'p:222:storylet_faves_0': [8],
  'p:registry': { '111': 'Alice', '222': 'Bob' },
};

function pair(): { a: Device; b: Device } {
  const sync = createMockStorage({ ...base });

  return {
    a: { local: createMockStorage({ ...base }), sync },
    b: { local: createMockStorage({ ...base }), sync },
  };
}

function storylets(data: Record<string, unknown>, charId?: string): number[] {
  const target = charId ? ({ kind: 'profile', charId } as const) : ({ kind: 'default' } as const);

  return sorted(readSets(data, target).storylet_faves);
}

describe('cross-device: two v5 devices on one sync area', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('edits of one set from two devices resolve to the last write, with no chunk missing or orphaned in sync', async () => {
    const { a, b } = pair();

    // more than one chunk on the first device, a single one on the second
    useDevice(a);
    await saveFaves(sets({ storylet_faves: Array.from({ length: 600 }, (_, i) => i + 100) }));
    await localToSync();

    useDevice(b);
    await saveFaves(sets({ storylet_faves: [1, 2, 4] }));
    await localToSync();

    useDevice(a);
    await syncToLocal();

    const sync = a.sync._getData();

    expect(storylets(sync)).toEqual([1, 2, 4]);
    expect(storylets(a.local._getData())).toEqual([1, 2, 4]);
    expect(isComplete(sync, { kind: 'default' })).toBe(true);
    expect(findOrphanedChunks(sync)).toEqual([]);
  });

  it('a profile deleted on one device comes back from another device that still holds it', async () => {
    const { a, b } = pair();

    useDevice(a);
    await deleteProfile('222');

    expect(listProfileCharIds(a.local._getData())).toEqual(['111']);
    expect(listProfileCharIds(a.sync._getData())).toEqual(['111']);

    useDevice(b);
    await localToSync();

    useDevice(a);
    await syncToLocal();

    expect(storylets(a.sync._getData(), '222')).toEqual([8]);
    expect(storylets(a.local._getData(), '222')).toEqual([8]);
    expect(storylets(a.local._getData(), '111')).toEqual([7]);
    expect(storylets(a.local._getData())).toEqual([1, 2]);
  });

  it('a profile left out of a backup restored on one device comes back from another device that still holds it', async () => {
    const { a, b } = pair();

    useDevice(a);

    const backup = await exportData();

    delete backup.profiles?.['222'];
    await importData(backup);

    expect(listProfileCharIds(a.local._getData())).toEqual(['111']);
    expect(listProfileCharIds(a.sync._getData())).toEqual(['111']);
    expect(storylets(a.sync._getData())).toEqual([1, 2]);

    useDevice(b);
    await localToSync();

    useDevice(a);
    await syncToLocal();

    expect(storylets(a.local._getData(), '222')).toEqual([8]);
    expect(storylets(a.local._getData(), '111')).toEqual([7]);
    expect(storylets(a.local._getData())).toEqual([1, 2]);
  });

  describe('a profile edit on one device while another turns the feature off', () => {
    it('after the editing device pulled the disable: the edit brings the profiles back, default keeps the chosen favourites', async () => {
      const { a, b } = pair();

      useDevice(a);
      expect((await disableMultiProfile('111', ['111', '222'])).status).toBe('disabled');
      await localToSync();

      useDevice(b);
      await syncToLocal();
      // A click that lands before the page reloads its data after the pull still writes
      // to profile 222.
      await saveFaves(sets({ storylet_faves: [8, 9] }), { kind: 'profile', charId: '222' }, 'Bob');
      await localToSync();

      useDevice(a);
      await syncToLocal();

      const data = a.local._getData();

      expect(data.multi_toggle).toBe(false);
      expect(storylets(data)).toEqual([7]);
      expect(storylets(data, '222')).toEqual([8, 9]);
      expect(storylets(data, '111')).toEqual([7]);
    });

    it('before the editing device pulled the disable: its next mirror puts the old shared list, the switch and the profiles back, nothing lost', async () => {
      const { a, b } = pair();

      useDevice(a);
      expect((await disableMultiProfile('111', ['111', '222'])).status).toBe('disabled');
      await localToSync();

      useDevice(b);
      await saveFaves(sets({ storylet_faves: [8, 9] }), { kind: 'profile', charId: '222' }, 'Bob');
      await localToSync();

      useDevice(a);
      await syncToLocal();

      const data = a.local._getData();

      expect(data.multi_toggle).toBe(true);
      expect(storylets(data)).toEqual([1, 2]);
      expect(storylets(data, '111')).toEqual([7]);
      expect(storylets(data, '222')).toEqual([8, 9]);
    });
  });
});
