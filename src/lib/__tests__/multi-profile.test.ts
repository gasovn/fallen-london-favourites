import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enableMultiProfile,
  disableMultiProfile,
  deleteProfile,
  listProfilesWithNames,
} from '../multi-profile';
import { packTarget } from '../toggle';
import { emptySets } from '../profiles';
import { unpackSet } from '../storage';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import type { FaveSets } from '@/types';

const A = '900001';
const B = '1000002';

function sets(branchFaves: number[]): FaveSets {
  return { ...emptySets(), branch_faves: new Set(branchFaves) };
}

describe('multi-profile enable, disable and delete', () => {
  let local: ReturnType<typeof createMockStorage>;
  let sync: ReturnType<typeof createMockStorage>;

  function stub(
    localInit: Record<string, unknown> = {},
    syncInit: Record<string, unknown> = {},
  ): void {
    local = createMockStorage(localInit);
    sync = createMockStorage(syncInit);
    vi.stubGlobal('browser', { storage: { local, sync } });
  }

  beforeEach(() => stub());

  it('enable just sets the synced toggle', async () => {
    await enableMultiProfile();

    expect(local._getData().multi_toggle).toBe(true);
  });

  it('lists profiles that have a chunk registry, named by id when no name is known', () => {
    stub({
      ...packTarget(sets([1]), { kind: 'profile', charId: A }),
      ...packTarget(sets([2]), { kind: 'profile', charId: B }),
      'p:registry': { [A]: 'Jane' }, // B has no name yet
    });

    // ids are sorted lexicographically: '1000002' before '900001'
    expect(listProfilesWithNames(local._getData())).toEqual([
      { charId: B, name: B },
      { charId: A, name: 'Jane' },
    ]);
  });

  describe('disable', () => {
    it('copies the chosen profile into default and removes every profile and name', async () => {
      stub(
        {
          multi_toggle: true,
          ...packTarget(sets([99]), { kind: 'default' }), // stale default
          ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
          ...packTarget(sets([3]), { kind: 'profile', charId: B }),
          'p:registry': { [A]: 'Jane', [B]: 'Mary' },
        },
        {
          ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
          ...packTarget(sets([3]), { kind: 'profile', charId: B }),
        },
      );

      const result = await disableMultiProfile(A, [A, B]);

      expect(result.status).toBe('disabled');

      const data = local._getData();

      expect(data.multi_toggle).toBe(false);
      expect(unpackSet(data, 'branch_faves')).toEqual(new Set([1, 2]));
      expect(Object.keys(data).filter((key) => /^p:\d/.test(key))).toEqual([]);
      expect(Object.keys(sync._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
      expect(data['p:registry']).toEqual({});
    });

    it('keeps an edit made while off through enable and a second disable', async () => {
      stub({
        multi_toggle: true,
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
        'p:registry': { [A]: 'Jane' },
      });

      await disableMultiProfile(A, [A]);
      await local.set(packTarget(sets([1, 2, 50]), { kind: 'default' }));
      await enableMultiProfile();

      expect(listProfilesWithNames(local._getData())).toEqual([]);
      expect((await disableMultiProfile(null, [])).status).toBe('disabled');
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([1, 2, 50]));
    });

    it('refuses when the chosen profile is still syncing, leaving default untouched', async () => {
      stub({
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        // registry references a chunk that has not arrived
        'p:900001:branch_faves_keys': ['p:900001:branch_faves_0'],
        'p:900001:card_faves_keys': [],
        'p:registry': { [A]: 'Jane' },
      });

      const result = await disableMultiProfile(A, [A]);

      expect(result.status).toBe('incomplete');

      const data = local._getData();

      expect(data.multi_toggle).toBe(true);
      expect(unpackSet(data, 'branch_faves')).toEqual(new Set([99]));
    });

    it('turns off once the missing chunk of the chosen profile has arrived', async () => {
      stub({
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        'p:900001:branch_faves_keys': ['p:900001:branch_faves_0'],
        'p:registry': { [A]: 'Jane' },
      });

      expect((await disableMultiProfile(A, [A])).status).toBe('incomplete');

      await local.set({ 'p:900001:branch_faves_0': [4, 5] });

      expect((await disableMultiProfile(A, [A])).status).toBe('disabled');

      const data = local._getData();

      expect(data.multi_toggle).toBe(false);
      expect(unpackSet(data, 'branch_faves')).toEqual(new Set([4, 5]));
    });

    it('refuses a chosen character that exists only in the name registry', async () => {
      stub({
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        'p:registry': { [A]: 'Deleted Ghost' }, // no chunk registries for A
      });

      const result = await disableMultiProfile(A, [A]);

      expect(result.status).toBe('no-survivor');
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([99]));
    });

    it('packs default from the captured snapshot even if the store shrinks mid-operation', async () => {
      stub({
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
      });

      // The store loses a chunk right after the snapshot is read; the pack
      // must use the snapshot.
      const realGet = local.get.bind(local);

      local.get = (async (keys: Parameters<typeof realGet>[0]) => {
        const snapshot = await realGet(keys);

        if (keys === null) {
          await local.remove(['p:900001:branch_faves_0']);
        }

        return snapshot;
      }) as typeof local.get;

      const result = await disableMultiProfile(A, [A]);

      expect(result.status).toBe('disabled');
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
    });

    it('refuses when the stored profiles differ from the ones shown, touching nothing', async () => {
      const before = {
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        ...packTarget(sets([1]), { kind: 'profile', charId: A }),
        ...packTarget(sets([2]), { kind: 'profile', charId: B }),
      };

      stub({ ...before });

      expect((await disableMultiProfile(A, [A])).status).toBe('changed');
      expect((await disableMultiProfile(null, [])).status).toBe('changed');
      // same number shown, another character among them
      expect((await disableMultiProfile(A, [A, '555'])).status).toBe('changed');
      // one more shown than is stored
      expect((await disableMultiProfile(A, [A, B, '555'])).status).toBe('changed');
      expect(local._getData()).toEqual(before);
    });

    it('accepts the shown characters in any order', async () => {
      stub({
        multi_toggle: true,
        ...packTarget(sets([1]), { kind: 'profile', charId: A }),
        ...packTarget(sets([2]), { kind: 'profile', charId: B }),
      });

      expect((await disableMultiProfile(A, [A, B])).status).toBe('disabled');
    });

    // A pull that passed its check before this write was seen writes the old
    // snapshot, profiles included, back over it.
    it.each(['before the profiles are removed', 'right after the profiles are removed'])(
      'ends with the chosen profile as the shared list when a pull already under way lands %s',
      async (moment) => {
        const before = {
          multi_toggle: true,
          ...packTarget(sets([99]), { kind: 'default' }),
          ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
        };

        stub({ ...before });

        const realSet = local.set.bind(local);
        const realRemove = local.remove.bind(local);
        let landed = false;

        const pull = async (): Promise<void> => {
          if (!landed) {
            landed = true;
            await realSet(before);
          }
        };

        local.remove = (async (keys: string | string[]) => {
          if (moment === 'before the profiles are removed') {
            await pull();
          }

          await realRemove(keys);

          if (moment === 'right after the profiles are removed') {
            await pull();
          }
        }) as typeof local.remove;

        expect((await disableMultiProfile(A, [A])).status).toBe('disabled');
        expect(local._getData().multi_toggle).toBe(false);
        expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
        expect(Object.keys(local._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
      },
    );

    // A background restarted before its mirror pulls whatever sync holds.
    it('puts the new shared list into sync before the chosen profile leaves it', async () => {
      const held = {
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
      };

      stub({ ...held }, { ...held });

      const order: string[] = [];
      const realSet = sync.set.bind(sync);
      const realRemove = sync.remove.bind(sync);

      sync.set = (async (items: Record<string, unknown>) => {
        order.push('set');
        await realSet(items);
      }) as typeof sync.set;
      sync.remove = (async (keys: string | string[]) => {
        order.push(
          [keys].flat().some((key) => key.startsWith(`p:${A}:`)) ? 'remove chosen' : 'remove',
        );
        await realRemove(keys);
      }) as typeof sync.remove;

      await disableMultiProfile(A, [A]);

      expect(order.indexOf('set')).toBeLessThan(order.indexOf('remove chosen'));
      expect(sync._getData().multi_toggle).toBe(false);
      expect(unpackSet(sync._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
      expect(Object.keys(sync._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
    });

    it('leaves the chosen profile in sync when the shared list cannot be written there for a reason other than size', async () => {
      const held = {
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
      };

      stub({ ...held }, { ...held });
      sync.set = (async () => {
        throw new Error('offline');
      }) as typeof sync.set;

      expect((await disableMultiProfile(A, [A])).status).toBe('disabled');
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
      expect(unpackSet(sync._getData(), `p:${A}:branch_faves`)).toEqual(new Set([1, 2]));
    });

    // The shared list is written while the chosen profile is still in sync,
    // so for a moment the area holds those favourites twice.
    it.each([
      ['the other profiles', B],
      ['the chosen profile itself', A],
    ])('makes room in sync when the shared list does not fit beside %s', async (_name, blocker) => {
      const held = {
        multi_toggle: true,
        ...packTarget(sets([99]), { kind: 'default' }),
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
        ...packTarget(sets([5]), { kind: 'profile', charId: B }),
      };

      stub({ ...held }, { ...held });

      const realSet = sync.set.bind(sync);

      sync.set = (async (items: Record<string, unknown>) => {
        if (Object.keys(sync._getData()).some((key) => key.startsWith(`p:${blocker}:`))) {
          throw new Error(
            'QuotaExceededError: storage.sync API call exceeded its quota limitations.',
          );
        }

        await realSet(items);
      }) as typeof sync.set;

      expect((await disableMultiProfile(A, [A, B])).status).toBe('disabled');
      expect(sync._getData().multi_toggle).toBe(false);
      expect(unpackSet(sync._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
      expect(Object.keys(sync._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
    });

    it('still turns off when sync cannot be reached to remove the profiles', async () => {
      const held = {
        multi_toggle: true,
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
        ...packTarget(sets([5]), { kind: 'profile', charId: B }),
      };

      stub({ ...held }, { ...held });
      sync.remove = (async () => {
        throw new Error('offline');
      }) as typeof sync.remove;

      expect((await disableMultiProfile(A, [A, B])).status).toBe('disabled');
      expect(local._getData().multi_toggle).toBe(false);
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
    });

    it('still turns off when sync refuses the shared list for size even after room was made', async () => {
      const held = {
        multi_toggle: true,
        ...packTarget(sets([1, 2]), { kind: 'profile', charId: A }),
      };

      stub({ ...held }, { ...held });
      sync.set = (async () => {
        throw new Error(
          'QuotaExceededError: storage.sync API call exceeded its quota limitations.',
        );
      }) as typeof sync.set;

      expect((await disableMultiProfile(A, [A])).status).toBe('disabled');
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([1, 2]));
    });

    it('removes from sync the chunks of a profile that local no longer holds', async () => {
      stub(
        { multi_toggle: true, ...packTarget(sets([1]), { kind: 'profile', charId: A }) },
        {
          ...packTarget(sets([1]), { kind: 'profile', charId: A }),
          'p:900001:branch_faves_1': [5],
        },
      );

      await disableMultiProfile(A, [A]);

      expect(Object.keys(sync._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
    });

    it('refuses when the feature is already off, as after another device turned it off', async () => {
      const before = {
        multi_toggle: false,
        ...packTarget(sets([7, 50]), { kind: 'default' }),
        ...packTarget(sets([7]), { kind: 'profile', charId: A }),
      };

      stub({ ...before });

      expect((await disableMultiProfile(A, [A])).status).toBe('changed');
      expect(local._getData()).toEqual(before);
    });

    it('with no profile to choose just turns off and keeps default', async () => {
      stub({ multi_toggle: true, ...packTarget(sets([99]), { kind: 'default' }) });

      const result = await disableMultiProfile(null, []);

      expect(result.status).toBe('disabled');
      expect(local._getData().multi_toggle).toBe(false);
      expect(unpackSet(local._getData(), 'branch_faves')).toEqual(new Set([99]));
    });
  });

  it('deleteProfile removes the profile here when sync cannot be reached', async () => {
    stub(
      { ...packTarget(sets([1]), { kind: 'profile', charId: A }), 'p:registry': { [A]: 'Jane' } },
      { ...packTarget(sets([1]), { kind: 'profile', charId: A }) },
    );
    sync.get = (async () => {
      throw new Error('offline');
    }) as typeof sync.get;

    await expect(deleteProfile(A)).resolves.toBeUndefined();
    expect(Object.keys(local._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
  });

  it('deleteProfile removes the profile here when the removal from sync fails', async () => {
    stub(
      { ...packTarget(sets([1]), { kind: 'profile', charId: A }) },
      { ...packTarget(sets([1]), { kind: 'profile', charId: A }) },
    );
    sync.remove = (async () => {
      throw new Error('offline');
    }) as typeof sync.remove;

    await expect(deleteProfile(A)).resolves.toBeUndefined();
    expect(Object.keys(local._getData()).filter((key) => /^p:\d/.test(key))).toEqual([]);
  });

  it('deleteProfile removes a profile from local and sync and prunes its registry entry', async () => {
    stub(
      {
        ...packTarget(sets([1]), { kind: 'profile', charId: A }),
        ...packTarget(sets([2]), { kind: 'profile', charId: B }),
        'p:registry': { [A]: 'Jane', [B]: 'Mary' },
      },
      {
        ...packTarget(sets([1]), { kind: 'profile', charId: A }),
        // a chunk local dropped before the mirror could
        'p:900001:branch_faves_1': [5],
      },
    );

    await deleteProfile(A);

    const data = local._getData();

    expect(data).not.toHaveProperty('p:900001:branch_faves_keys');
    expect(Object.keys(sync._getData()).filter((key) => key.startsWith('p:900001:'))).toEqual([]);
    expect(data['p:registry']).toEqual({ [B]: 'Mary' });
    expect(unpackSet(data, 'p:1000002:branch_faves')).toEqual(new Set([2]));
  });
});
