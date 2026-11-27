import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExportFile } from '@/types';
import {
  createEventfulBrowser,
  createMockStorage,
  type EventfulBrowserStub,
} from '../../../tests/helpers/mock-storage';
import { sets } from '../../../tests/helpers/clients';
import { WHATS_NEW_FLAG } from '../flags';

// The extension's own sync writes echo back as onChanged(area='sync'); a pull
// on that echo must not overwrite freshly written local state.

function unpack(data: Record<string, unknown>, key: string): number[] {
  const out: number[] = [];
  const registry = data[`${key}_keys`];

  if (Array.isArray(registry)) {
    for (const chunk of registry) {
      const values = data[chunk as string];

      if (Array.isArray(values)) {
        out.push(...(values as number[]));
      }
    }
  }

  return out.sort((a, b) => a - b);
}

function makeBackup(storyletFaves: number[]): ExportFile {
  return {
    format: 'fallen-london-favourites',
    version: 3,
    exported_at: new Date().toISOString(),
    data: {
      branch_faves: [],
      branch_avoids: [],
      storylet_faves: storyletFaves,
      storylet_avoids: [],
      card_faves: [],
      card_avoids: [],
    },
    options: {
      branch_reorder_mode: 'branch_reorder_active',
      switch_mode: 'click_through',
      click_protection: 'off',
    },
    profiles: {},
    registry: {},
  };
}

async function setupListener(stub: EventfulBrowserStub): Promise<void> {
  vi.stubGlobal('browser', stub.browserStub);

  const { setupSyncListener } = await import('../sync');

  setupSyncListener();
}

describe('sync echo races', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('import survives the echo of its own profile removal and keeps the toggle', async () => {
    // Both areas hold the old flat set and a profile the backup does not contain.
    const pre = {
      storage_schema: 5,
      multi_toggle: true,
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [12345, 88888],
      'p:999999:storylet_faves_keys': ['p:999999:storylet_faves_0'],
      'p:999999:storylet_faves_0': [7],
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });

    await setupListener(stub);

    const { importData } = await import('../io');

    await importData(makeBackup([12345, 99999]));
    await vi.runAllTimersAsync();

    const local = stub.local._getData();
    const sync = stub.sync._getData();

    expect(unpack(local, 'storylet_faves')).toEqual([12345, 99999]);
    expect(unpack(sync, 'storylet_faves')).toEqual([12345, 99999]);
    expect(Object.keys(local).filter((k) => k.startsWith('p:999999:'))).toEqual([]);
    expect(Object.keys(sync).filter((k) => k.startsWith('p:999999:'))).toEqual([]);
    expect(local.multi_toggle).toBe(true);
  });

  it('disable completes despite the echo of its best-effort profile delete', async () => {
    const pre = {
      storage_schema: 5,
      multi_toggle: true,
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [12345],
      'p:111111:storylet_faves_keys': ['p:111111:storylet_faves_0'],
      'p:111111:storylet_faves_0': [55555],
      'p:222222:storylet_faves_keys': ['p:222222:storylet_faves_0'],
      'p:222222:storylet_faves_0': [7],
      'p:registry': { '111111': 'Alice', '222222': 'Bob' },
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });

    await setupListener(stub);

    // Consume the immediate mirror slot so the disable's writes hit the debounce.
    await stub.local.set({ start_empty: false });
    await vi.advanceTimersByTimeAsync(0);

    const { disableMultiProfile } = await import('../multi-profile');
    const result = await disableMultiProfile('111111', ['111111', '222222']);

    await vi.runAllTimersAsync();

    expect(result.status).toBe('disabled');

    const local = stub.local._getData();
    const sync = stub.sync._getData();

    expect(local.multi_toggle).toBe(false);
    expect(sync.multi_toggle).toBe(false);
    expect(unpack(local, 'storylet_faves')).toEqual([55555]);
    expect(unpack(sync, 'storylet_faves')).toEqual([55555]);
    expect(Object.keys(local).filter((k) => /^p:\d/.test(k))).toEqual([]);
    expect(Object.keys(sync).filter((k) => /^p:\d/.test(k))).toEqual([]);
    expect(local['p:registry']).toEqual({});
  });

  it('does not let a pull that started before a local edit write over it', async () => {
    const pre = {
      storage_schema: 5,
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [1, 2],
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });
    const storage = stub.browserStub.storage as {
      sync: { get(keys: null): Promise<Record<string, unknown>> };
    };
    const realGet = storage.sync.get.bind(storage.sync);

    let release = (): void => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await setupListener(stub);

    // Consume the immediate mirror slot so the edit below waits for the debounce.
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);

    storage.sync.get = async (keys: null) => {
      await gate;

      return realGet(keys);
    };

    // a change from another device starts a pull, which waits on its read
    await stub.sync.set({ storylet_faves_0: [9] });
    await vi.advanceTimersByTimeAsync(0);
    await stub.local.set({ storylet_faves_0: [1, 2, 3] });
    await vi.advanceTimersByTimeAsync(0);
    storage.sync.get = realGet;
    release();
    await vi.runAllTimersAsync();

    expect(stub.local._getData().storylet_faves_0).toEqual([1, 2, 3]);
    expect(stub.sync._getData().storylet_faves_0).toEqual([1, 2, 3]);
  });

  it('applies a remote update when there is no local edit to mirror', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });

    await setupListener(stub);
    await stub.sync.set({ switch_mode: 'modifier_click' });
    await vi.runAllTimersAsync();

    expect(stub.local._getData().switch_mode).toBe('modifier_click');
  });

  it('defers a remote update while a local edit is unmirrored, then applies it without dropping the edit', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });

    await setupListener(stub);

    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);
    await stub.local.set({ switch_mode: 'modifier_click' });
    await vi.advanceTimersByTimeAsync(0);

    await stub.sync.set({ branch_reorder_mode: 'branch_no_reorder' });
    await vi.advanceTimersByTimeAsync(0);

    expect(stub.local._getData().branch_reorder_mode).toBeUndefined();
    expect(stub.local._getData().switch_mode).toBe('modifier_click');

    await vi.runAllTimersAsync();

    expect(stub.local._getData().branch_reorder_mode).toBe('branch_no_reorder');
    expect(stub.local._getData().switch_mode).toBe('modifier_click');
    expect(stub.sync._getData().switch_mode).toBe('modifier_click');
  });

  it('keeps the local value when the same key changes remotely before the local edit is mirrored', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);
    await stub.local.set({ switch_mode: 'modifier_click' });
    await vi.advanceTimersByTimeAsync(0);

    await stub.sync.set({ switch_mode: 'click_through' });
    await vi.runAllTimersAsync();

    expect(stub.local._getData().switch_mode).toBe('modifier_click');
    expect(stub.sync._getData().switch_mode).toBe('modifier_click');
  });

  it('while the sync area is full, a remote edit to the same key is overwritten once space is freed', async () => {
    const filler: Record<string, unknown> = {};

    for (let i = 0; i < 520; i++) {
      filler[`f${i}`] = i;
    }

    const pre = { storage_schema: 5, switch_mode: 'click_through', ...filler };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });

    await setupListener(stub);

    // A edits; the mirror is refused (union over the key cap), the edit stays unmirrored.
    await stub.local.set({ switch_mode: 'modifier_click' });
    await vi.runAllTimersAsync();

    expect(stub.local._getData()['dev:sync_full']).toBe(true);
    expect(stub.sync._getData().switch_mode).toBe('click_through');

    // B edits the same key while A is full.
    await stub.sync.set({ switch_mode: 'click_through_b' });
    await vi.runAllTimersAsync();

    // A frees space (as deleteProfile does: local and sync).
    const freed = Object.keys(filler).slice(0, 20);

    await stub.sync.remove(freed);
    await stub.local.remove(freed);
    await vi.runAllTimersAsync();

    expect(stub.local._getData()['dev:sync_full']).toBeUndefined();
    expect(stub.sync._getData().switch_mode).toBe('modifier_click');
    expect(stub.local._getData().switch_mode).toBe('modifier_click');
  });

  it('sends a refused edit and takes remote changes once another device frees the space', async () => {
    const filler: Record<string, unknown> = {};

    for (let i = 0; i < 520; i++) {
      filler[`f${i}`] = i;
    }

    const pre = { storage_schema: 5, switch_mode: 'click_through' };
    const stub = createEventfulBrowser({ ...pre }, { ...pre, ...filler });

    await setupListener(stub);
    await stub.local.set({ switch_mode: 'modifier_click' });
    await vi.runAllTimersAsync();

    expect(stub.local._getData()['dev:sync_full']).toBe(true);

    // A remote change that frees nothing leaves the edit waiting.
    await stub.sync.set({ f0: 'changed' });
    await vi.runAllTimersAsync();

    expect(stub.sync._getData().switch_mode).toBe('click_through');
    expect(stub.local._getData()['dev:sync_full']).toBe(true);

    await stub.sync.remove(Object.keys(filler).slice(0, 100));
    await stub.sync.set({ click_protection: 'shift' });
    await vi.runAllTimersAsync();

    expect(stub.sync._getData().switch_mode).toBe('modifier_click');
    expect(stub.local._getData().click_protection).toBe('shift');
    expect(stub.local._getData()['dev:sync_full']).toBeUndefined();
  });

  it('starts no extra mirror for a remote change once the area has room again', async () => {
    const filler: Record<string, unknown> = {};

    for (let i = 0; i < 520; i++) {
      filler[`f${i}`] = i;
    }

    const pre = { storage_schema: 5, switch_mode: 'click_through' };
    const stub = createEventfulBrowser({ ...pre }, { ...pre, ...filler });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);

    await setupListener(stub);
    await stub.local.set({ switch_mode: 'modifier_click' });
    await vi.runAllTimersAsync();
    await stub.sync.remove(Object.keys(filler).slice(0, 100));
    await vi.runAllTimersAsync();

    expect(stub.sync._getData().switch_mode).toBe('modifier_click');

    await vi.advanceTimersByTimeAsync(10_000);

    let release = (): void => {};

    let writes = 0;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    storage.sync.set = async (items: Record<string, unknown>) => {
      writes++;
      await gate;
      await realSet(items);
    };

    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);
    await realSet({ branch_reorder_mode: 'branch_no_reorder' });
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(writes).toBe(1);
  });

  it('keeps a raised storage-full flag until a real change is mirrored', async () => {
    const pre = { storage_schema: 5, switch_mode: 'click_through' };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });

    await setupListener(stub);

    // A refused growing write raises the flag; that write alone must not start a
    // mirror whose success would clear it straight away.
    await stub.local.set({ 'dev:sync_full': true });
    await vi.runAllTimersAsync();

    expect(stub.local._getData()['dev:sync_full']).toBe(true);

    await stub.local.set({ switch_mode: 'modifier_click' });
    await vi.runAllTimersAsync();

    expect(stub.sync._getData().switch_mode).toBe('modifier_click');
    expect(stub.local._getData()['dev:sync_full']).toBeUndefined();
  });

  it('a fresh install keeps the chosen click protection through the first favourite', async () => {
    const stub = createEventfulBrowser({}, {});

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);

    const { saveFaves } = await import('../toggle');

    await saveFaves(sets({ storylet_faves: [222] }));
    await vi.runAllTimersAsync();

    const local = stub.local._getData();
    const sync = stub.sync._getData();

    expect(local.click_protection).toBe('shift');
    expect(sync.click_protection).toBe('shift');
    expect(local.storage_schema).toBe(5);
    expect(sync.storage_schema).toBe(5);
    expect(unpack(sync, 'storylet_faves')).toEqual([222]);
  });

  it('leaves the shared keys in sync when they leave local while a slow mirror is still running', async () => {
    const pre = {
      storage_schema: 5,
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [1, 2],
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);

    let release = (): void => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    storage.sync.set = async (items: Record<string, unknown>) => {
      await gate;
      await realSet(items);
    };

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);
    // the shared list leaves local while that mirror runs
    await stub.local.remove(['storylet_faves_keys', 'storylet_faves_0']);
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(stub.sync._getData().storylet_faves_0).toEqual([1, 2]);
  });

  it('leaves a profile chunk in sync while the registry written with it still names it', async () => {
    const pre = {
      storage_schema: 5,
      'p:111111:storylet_faves_keys': ['p:111111:storylet_faves_0', 'p:111111:storylet_faves_1'],
      'p:111111:storylet_faves_0': [1],
      'p:111111:storylet_faves_1': [2],
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);

    let release = (): void => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    storage.sync.set = async (items: Record<string, unknown>) => {
      await gate;
      await realSet(items);
    };

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(0);
    // the list shrinks while that mirror is still running
    await stub.local.set({ 'p:111111:storylet_faves_keys': ['p:111111:storylet_faves_0'] });
    await stub.local.remove(['p:111111:storylet_faves_1']);
    storage.sync.set = realSet;
    release();
    await vi.advanceTimersByTimeAsync(0);

    // the old registry is in sync again, and so must be the chunk it names
    expect(stub.sync._getData()['p:111111:storylet_faves_1']).toEqual([2]);

    await vi.runAllTimersAsync();

    expect(stub.sync._getData()['p:111111:storylet_faves_keys']).toEqual([
      'p:111111:storylet_faves_0',
    ]);
    expect(stub.sync._getData()).not.toHaveProperty('p:111111:storylet_faves_1');
  });

  it('does not bring back a profile deleted while a slow mirror is still running', async () => {
    const pre = {
      storage_schema: 5,
      multi_toggle: true,
      'p:111111:storylet_faves_keys': ['p:111111:storylet_faves_0'],
      'p:111111:storylet_faves_0': [55555],
      'p:222222:storylet_faves_keys': ['p:222222:storylet_faves_0'],
      'p:222222:storylet_faves_0': [7],
      'p:registry': { '111111': 'Alice', '222222': 'Bob' },
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);

    let release = (): void => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The mirror started by the registry write holds its snapshot until the
    // delete has finished, as a large payload does in a real browser.
    storage.sync.set = async (items: Record<string, unknown>) => {
      await gate;
      await realSet(items);
    };

    await setupListener(stub);

    const { deleteProfile } = await import('../multi-profile');

    await deleteProfile('222222');
    release();
    await vi.runAllTimersAsync();

    const local = stub.local._getData();
    const sync = stub.sync._getData();

    expect(Object.keys(sync).filter((k) => k.startsWith('p:222222:'))).toEqual([]);
    expect(Object.keys(local).filter((k) => k.startsWith('p:222222:'))).toEqual([]);
    expect(sync['p:registry']).toEqual({ '111111': 'Alice' });
    expect(unpack(sync, 'p:111111:storylet_faves')).toEqual([55555]);
  });

  // Firefox counts the area a little larger than the estimate, so the
  // browser's own refusal can come first; the messages are the browsers' own.
  it.each([
    ['Firefox', 'QuotaExceededError: storage.sync API call exceeded its quota limitations.', true],
    ['Chrome, bytes', 'Resource::kQuotaBytes quota exceeded', true],
    ['Chrome, items', 'Resource::kMaxItems quota exceeded', true],
    [
      'Chrome, write rate',
      'This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.',
      undefined,
    ],
  ])(
    'a mirror refused by the browser (%s) sets the storage-full flag only for size',
    async (_name, message, flag) => {
      const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });
      const storage = stub.browserStub.storage as {
        sync: { set(items: Record<string, unknown>): Promise<void> };
      };

      storage.sync.set = async () => {
        throw new Error(message);
      };

      vi.spyOn(console, 'error').mockImplementation(() => {});
      await setupListener(stub);
      await stub.local.set({ click_protection: 'shift' });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(stub.local._getData()['dev:sync_full']).toBe(flag);
      expect(stub.local._getData().click_protection).toBe('shift');
    },
  );

  it('retries the mirror after a transient sync.set failure', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });
    const sync = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = sync.sync.set.bind(sync.sync);
    let failures = 1;

    sync.sync.set = async (items: Record<string, unknown>) => {
      if (failures > 0) {
        failures--;
        throw new Error('transient');
      }

      await realSet(items);
    };

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.runAllTimersAsync();

    expect(stub.sync._getData().click_protection).toBe('shift');
    expect(stub.local._getData()).not.toHaveProperty('dev:sync_full');
  });

  it('gives up retrying a persistently failing mirror after a bounded number of attempts', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });
    const sync = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    let attempts = 0;

    sync.sync.set = async () => {
      attempts++;
      throw new Error('persistent');
    };

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(attempts).toBe(4);
  });

  it('sends an edit the browser refused for size once another device frees the space', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);
    let full = true;

    storage.sync.set = async (items: Record<string, unknown>) => {
      if (full) {
        throw new Error('QuotaExceededError: storage.sync is full');
      }

      await realSet(items);
    };

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stub.local._getData()['dev:sync_full']).toBe(true);

    full = false;
    await realSet({ switch_mode: 'modifier_click' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stub.sync._getData().click_protection).toBe('shift');
    expect(stub.local._getData().switch_mode).toBe('modifier_click');
    expect(stub.local._getData()['dev:sync_full']).toBeUndefined();
  });

  it('tries once for several remote changes in a row while the area is full', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);
    let attempts = 0;

    storage.sync.set = async () => {
      attempts++;
      throw new Error('QuotaExceededError: storage.sync is full');
    };

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(60_000);

    attempts = 0;
    await realSet({ switch_mode: 'modifier_click' });
    await realSet({ switch_mode: 'click_through' });
    await realSet({ switch_mode: 'modifier_click' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(attempts).toBe(1);
  });

  it('gives a later run of failures the full number of retries after a mirror succeeds', async () => {
    const stub = createEventfulBrowser({ storage_schema: 5 }, { storage_schema: 5 });
    const sync = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = sync.sync.set.bind(sync.sync);
    let failures = 3;
    let attempts = 0;

    sync.sync.set = async (items: Record<string, unknown>) => {
      attempts++;

      if (failures > 0) {
        failures--;
        throw new Error('transient');
      }

      await realSet(items);
    };

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stub.sync._getData().click_protection).toBe('shift');

    failures = Infinity;
    attempts = 0;
    await stub.local.set({ click_protection: 'off' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(attempts).toBe(4);
  });
});

describe('change events for unchanged values (Firefox)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pre = {
    storage_schema: 5,
    switch_mode: 'click_through',
    storylet_faves_keys: ['storylet_faves_0'],
    storylet_faves_0: [1, 2],
  };

  it('one write is mirrored once, not in an endless mirror and pull loop', async () => {
    const stub = createEventfulBrowser({ ...pre }, { ...pre }, { reportUnchanged: true });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);
    let mirrors = 0;

    storage.sync.set = async (items: Record<string, unknown>) => {
      mirrors++;
      await realSet(items);
    };

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mirrors).toBe(1);
    expect(stub.sync._getData().click_protection).toBe('shift');
  });

  it('a change from another device survives on a device that has written before', async () => {
    const stub = createEventfulBrowser({ ...pre }, { ...pre }, { reportUnchanged: true });

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(10_000);

    await stub.sync.set({ switch_mode: 'modifier_click', storylet_faves_0: [1, 2, 3] });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stub.local._getData().storylet_faves_0).toEqual([1, 2, 3]);
    expect(stub.sync._getData().storylet_faves_0).toEqual([1, 2, 3]);
    expect(stub.local._getData().switch_mode).toBe('modifier_click');
    expect(stub.sync._getData().switch_mode).toBe('modifier_click');
  });

  // The mirror uploads such a chunk and its cleanup removes it again, so each
  // mirror changes sync twice.
  it('a chunk no registry refers to does not keep the mirror going or lose a remote change', async () => {
    const stub = createEventfulBrowser(
      { ...pre, storylet_faves_7: [9] },
      { ...pre },
      { reportUnchanged: true },
    );
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);
    let mirrors = 0;

    storage.sync.set = async (items: Record<string, unknown>) => {
      mirrors++;
      await realSet(items);
    };

    await setupListener(stub);
    await stub.local.set({ click_protection: 'shift' });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mirrors).toBe(1);

    await stub.sync.set({ storylet_faves_0: [1, 2, 3] });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stub.local._getData().storylet_faves_0).toEqual([1, 2, 3]);
    expect(stub.sync._getData().storylet_faves_0).toEqual([1, 2, 3]);
  });
});

describe('pulls followed by more changes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pre = {
    storage_schema: 5,
    storylet_faves_keys: ['storylet_faves_0'],
    storylet_faves_0: [1, 2],
  };

  it('counts an edit back to the pulled value as an edit while an earlier one is still being mirrored', async () => {
    const pre = {
      storage_schema: 5,
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [1],
    };
    const stub = createEventfulBrowser({ ...pre }, { ...pre });
    const storage = stub.browserStub.storage as {
      sync: { set(items: Record<string, unknown>): Promise<void> };
    };
    const realSet = storage.sync.set.bind(storage.sync);

    await setupListener(stub);
    // a pull that brings [1, 2] and is remembered as this device's own write
    await stub.sync.set({ storylet_faves_0: [1, 2] });
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(10_000);

    let release = (): void => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    storage.sync.set = async (items: Record<string, unknown>) => {
      await gate;
      await realSet(items);
    };

    await stub.local.set({ storylet_faves_0: [1, 2, 3] });
    await vi.advanceTimersByTimeAsync(0);
    await stub.local.set({ storylet_faves_0: [1, 2] });
    await vi.advanceTimersByTimeAsync(0);
    storage.sync.set = realSet;
    release();
    await vi.runAllTimersAsync();

    expect(stub.local._getData().storylet_faves_0).toEqual([1, 2]);
    expect(stub.sync._getData().storylet_faves_0).toEqual([1, 2]);
  });

  it.each([
    ['Chrome events', false],
    ['Firefox events', true],
  ])(
    'a second change from another device is not overwritten by the echo of the first (%s)',
    async (_, reportUnchanged) => {
      const stub = createEventfulBrowser({ ...pre }, { ...pre }, { reportUnchanged });

      await setupListener(stub);

      // This device mirrored a moment ago, so its next mirror is debounced.
      await stub.local.set({ click_protection: 'shift' });
      await vi.advanceTimersByTimeAsync(1000);

      await stub.sync.set({ storylet_faves_0: [1, 2, 3] });
      await vi.advanceTimersByTimeAsync(1000);
      await stub.sync.set({ storylet_faves_0: [1, 2, 3, 4] });
      await vi.advanceTimersByTimeAsync(20_000);

      expect(stub.sync._getData().storylet_faves_0).toEqual([1, 2, 3, 4]);
      expect(stub.local._getData().storylet_faves_0).toEqual([1, 2, 3, 4]);
    },
  );
});

describe('importData keeps the device settings a backup does not hold', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importInto(
    initialLocal: Record<string, unknown>,
    turnOn = false,
  ): Promise<Record<string, unknown>> {
    const local = createMockStorage(initialLocal);
    const sync = createMockStorage({});

    vi.stubGlobal('browser', {
      storage: { local, sync, onChanged: { addListener: vi.fn() } },
    });

    const { importData } = await import('../io');

    await importData(makeBackup([1]), { turnOn });

    return local._getData();
  }

  it('preserves multi_toggle=true across a restore', async () => {
    const data = await importInto({ multi_toggle: true });

    expect(data.multi_toggle).toBe(true);
  });

  it('preserves multi_toggle=false across a restore', async () => {
    const data = await importInto({ multi_toggle: false });

    expect(data.multi_toggle).toBe(false);
  });

  it('turns per-character favourites on when the user asked for it', async () => {
    const data = await importInto({ multi_toggle: false }, true);

    expect(data.multi_toggle).toBe(true);
  });

  it('preserves "start empty" across a restore', async () => {
    const data = await importInto({ multi_toggle: true, start_empty: true });

    expect(data.start_empty).toBe(true);
  });

  it('keeps the unseen-changelog flag across a restore', async () => {
    const data = await importInto({ [WHATS_NEW_FLAG]: true });

    expect(data[WHATS_NEW_FLAG]).toBe(true);
  });

  it('writes none of them when the device had none', async () => {
    const data = await importInto({});

    expect(data).not.toHaveProperty('multi_toggle');
    expect(data).not.toHaveProperty('start_empty');
    expect(data).not.toHaveProperty(WHATS_NEW_FLAG);
  });
});
