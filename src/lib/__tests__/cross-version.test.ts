import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import {
  type Device,
  useDevice,
  sets,
  sorted,
  legacyPull,
  legacyPush,
  legacySaveFaves,
  legacyRead,
} from '../../../tests/helpers/clients';
import { localToSync, syncToLocal } from '../sync';
import { saveFaves } from '../toggle';
import { readSets, resolveContext, listProfileCharIds } from '../profiles';
import { migrate } from '../migration';
import { findOrphanedChunks, findZombieKeys } from '../cleanup';

// A v4 client and a v5 client sharing one sync area. The flat keys are the
// shared `default`; the old client must leave the `p:<charId>:*` profiles alone.

const flatV4 = {
  storage_schema: 4,
  storylet_faves_keys: ['storylet_faves_0'],
  storylet_faves_0: [1, 2],
};

const flatV5 = { ...flatV4, storage_schema: 5 };

const profile111 = {
  'p:111:storylet_faves_keys': ['p:111:storylet_faves_0'],
  'p:111:storylet_faves_0': [7],
  'p:registry': { '111': 'Alice' },
};

const PROFILE_KEYS = Object.keys(profile111);

function device(local: Record<string, unknown>, sync: Record<string, unknown>): Device {
  return { local: createMockStorage(local), sync: createMockStorage(sync) };
}

function sharing(sync: Device['sync'], local: Record<string, unknown>): Device {
  return { local: createMockStorage(local), sync };
}

function profileIntact(data: Record<string, unknown>): void {
  for (const key of PROFILE_KEYS) {
    expect(data[key]).toEqual(profile111[key as keyof typeof profile111]);
  }
}

describe('cross-version: v4 and v5 clients on one sync area', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a profile written by v5 reaches v4 untouched — default intact, nothing cleaned up', async () => {
    const v5 = device({ ...flatV5, multi_toggle: true }, {});
    const v4 = sharing(v5.sync, { ...flatV4 });

    useDevice(v5);
    await saveFaves(sets({ storylet_faves: [7] }), { kind: 'profile', charId: '111' }, 'Alice');
    await localToSync();

    await legacyPull(v4);

    const old = v4.local._getData();

    expect(await legacyRead(v4, 'storylet_faves')).toEqual([1, 2]);
    profileIntact(old);
    expect(findOrphanedChunks(old)).toEqual([]);
    expect(findZombieKeys(old)).toEqual([]);

    await legacyPush(v4);
    profileIntact(v4.sync._getData());
  });

  it('a flat edit by v4 reaches v5 as a default update, profiles untouched', async () => {
    const v5 = device({ ...flatV5, ...profile111 }, { ...flatV5, ...profile111 });
    const v4 = sharing(v5.sync, {});

    await legacyPull(v4);
    await legacySaveFaves(v4, 'storylet_faves', [1, 2, 3]);
    await legacyPush(v4);

    useDevice(v5);
    await syncToLocal();

    const data = v5.local._getData();

    expect(sorted(readSets(data, { kind: 'default' }).storylet_faves)).toEqual([1, 2, 3]);
    profileIntact(data);
    expect(data.storage_schema).toBe(5);
  });

  it('a v4 push over a sync area holding profiles keeps the profiles', async () => {
    const v4 = device({ ...flatV4 }, { ...flatV5, ...profile111 });

    await legacyPush(v4);

    profileIntact(v4.sync._getData());
  });

  it('a v5 push of profiles over a flat-only sync area leaves the flat keys as they were', async () => {
    const v5 = device({ ...flatV5, ...profile111 }, { ...flatV4 });

    useDevice(v5);
    await localToSync();

    const data = v5.sync._getData();

    expect(data.storylet_faves_0).toEqual([1, 2]);
    expect(data.storylet_faves_keys).toEqual(['storylet_faves_0']);
    profileIntact(data);
  });

  it('a fresh v4 install pulling flat + profiles shows default and keeps the profiles', async () => {
    const v4 = device({}, { ...flatV5, ...profile111 });

    await expect(legacyPull(v4)).resolves.toBeUndefined();
    expect(await legacyRead(v4, 'storylet_faves')).toEqual([1, 2]);
    profileIntact(v4.local._getData());
  });

  it('a fresh v5 install pulling flat-only data reads it as default with the feature off', async () => {
    const v5 = device({}, { ...flatV4 });

    useDevice(v5);
    await syncToLocal();

    const data = v5.local._getData();
    const context = resolveContext(data.multi_toggle === true, '111', data);

    expect(data.storage_schema).toBe(5);
    expect(context.readTarget).toEqual({ kind: 'default' });
    expect(sorted(readSets(data, context.readTarget).storylet_faves)).toEqual([1, 2]);
    expect(listProfileCharIds(data)).toEqual([]);
  });

  it('profiles survive a v5 → v4 → edit → v5 round-trip', async () => {
    const v5 = device({ ...flatV5, ...profile111 }, {});
    const v4 = sharing(v5.sync, {});

    useDevice(v5);
    await localToSync();

    await legacyPull(v4);
    await legacySaveFaves(v4, 'storylet_faves', [1, 2, 3]);
    await legacyPush(v4);

    await syncToLocal();

    const data = v5.local._getData();

    profileIntact(data);
    expect(sorted(readSets(data, { kind: 'default' }).storylet_faves)).toEqual([1, 2, 3]);
  });

  it('a v4 device that pulled the v5 marker still reads its data and needs no migration once updated', async () => {
    const v4 = device({ ...flatV4 }, { ...flatV5, ...profile111 });

    await legacyPull(v4);

    expect(v4.local._getData().storage_schema).toBe(5);
    expect(await legacyRead(v4, 'storylet_faves')).toEqual([1, 2]);

    // The same device updates to v5: its local is already at the current marker.
    useDevice(v4);

    const before = v4.local._getData();

    await migrate(v4.local as unknown as Browser.storage.StorageArea);

    expect(v4.local._getData()).toEqual(before);
  });

  it('a v4 marker pushed over a v5 area is bumped back on the next v5 pull, profiles kept', async () => {
    const v4 = device({ ...flatV4 }, { ...flatV5, ...profile111 });
    const v5 = sharing(v4.sync, { ...flatV5, ...profile111 });

    await legacyPush(v4);
    expect(v4.sync._getData().storage_schema).toBe(4);

    useDevice(v5);
    await syncToLocal();

    expect(v5.sync._getData().storage_schema).toBe(5);
    profileIntact(v5.sync._getData());
    profileIntact(v5.local._getData());
    expect(v5.local._getData().storylet_faves_0).toEqual([1, 2]);
  });

  it('with the feature off, a v5 device neither uses nor deletes the stored profiles', async () => {
    const v5 = device({ ...flatV5, ...profile111, multi_toggle: false }, {});

    useDevice(v5);

    const data = v5.local._getData();
    const context = resolveContext(data.multi_toggle === true, '111', data);

    expect(context.readTarget).toEqual({ kind: 'default' });
    expect(context.writeTarget).toEqual({ kind: 'default' });

    await localToSync();
    await syncToLocal();

    profileIntact(v5.local._getData());
    profileIntact(v5.sync._getData());
  });

  it('a synced toggle flip changes only what is displayed, never the data', async () => {
    const stored = { ...flatV5, ...profile111, multi_toggle: false };
    const v5 = device({ ...stored }, { ...stored, multi_toggle: true });

    useDevice(v5);
    await syncToLocal();

    const on = v5.local._getData();

    expect(resolveContext(on.multi_toggle === true, '111', on).readTarget).toEqual({
      kind: 'profile',
      charId: '111',
    });

    await v5.sync.set({ multi_toggle: false });
    await syncToLocal();

    const off = v5.local._getData();

    expect(resolveContext(off.multi_toggle === true, '111', off).readTarget).toEqual({
      kind: 'default',
    });

    const { multi_toggle: _on, ...onData } = on;
    const { multi_toggle: _off, ...offData } = off;
    const { multi_toggle: _stored, ...storedData } = stored;

    expect(onData).toEqual(storedData);
    expect(offData).toEqual(storedData);
  });
});
