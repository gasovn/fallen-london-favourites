import { vi } from 'vitest';

export interface MockStorage {
  get(keys: string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  _getData(): Record<string, unknown>;
}

export function createMockStorage(initialData: Record<string, unknown> = {}): MockStorage {
  const data = { ...initialData };

  return {
    async get(keys: string[] | Record<string, unknown> | null) {
      if (keys === null) {
        return { ...data };
      }

      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};

        for (const k of keys) {
          if (k in data) {
            result[k] = data[k];
          }
        }

        return result;
      }

      const result: Record<string, unknown> = {};

      for (const [k, defaultVal] of Object.entries(keys)) {
        result[k] = k in data ? data[k] : defaultVal;
      }

      return result;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
    async remove(keys: string | string[]) {
      const keyList = Array.isArray(keys) ? keys : [keys];

      for (const k of keyList) {
        delete data[k];
      }
    },
    async clear() {
      for (const k of Object.keys(data)) {
        delete data[k];
      }
    },
    _getData: () => ({ ...data }),
  };
}

export function stubBrowserGlobal(): void {
  vi.stubGlobal('browser', {
    runtime: {
      requestUpdateCheck: vi.fn(),
    },
  });
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type OnChangedListener = (
  changes: Record<string, StorageChange>,
  areaName: 'local' | 'sync',
) => void;

export interface EventfulBrowserStub {
  local: MockStorage;
  sync: MockStorage;
  browserStub: Record<string, unknown>;
  listeners: OnChangedListener[];
}

/**
 * Storage areas that dispatch browser.storage.onChanged like the real API:
 * events fire asynchronously (microtask), only for keys whose value actually
 * changed, and reach the writing context too — the property the sync-echo
 * races depend on.
 */
export function createEventfulBrowser(
  initialLocal: Record<string, unknown> = {},
  initialSync: Record<string, unknown> = {},
): EventfulBrowserStub {
  const listeners: OnChangedListener[] = [];

  const dispatch = (changes: Record<string, StorageChange>, areaName: 'local' | 'sync'): void => {
    if (Object.keys(changes).length === 0) {
      return;
    }

    queueMicrotask(() => {
      for (const listener of listeners) {
        listener(changes, areaName);
      }
    });
  };

  const eventful = (base: MockStorage, areaName: 'local' | 'sync'): MockStorage => ({
    get: (keys) => base.get(keys),
    async set(items: Record<string, unknown>) {
      const before = base._getData();
      const changes: Record<string, StorageChange> = {};

      for (const [k, v] of Object.entries(items)) {
        if (!(k in before) || JSON.stringify(before[k]) !== JSON.stringify(v)) {
          changes[k] = { oldValue: before[k], newValue: v };
        }
      }

      await base.set(items);
      dispatch(changes, areaName);
    },
    async remove(keys: string | string[]) {
      const before = base._getData();
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, StorageChange> = {};

      for (const k of keyList) {
        if (k in before) {
          changes[k] = { oldValue: before[k] };
        }
      }

      await base.remove(keys);
      dispatch(changes, areaName);
    },
    async clear() {
      const before = base._getData();
      const changes: Record<string, StorageChange> = {};

      for (const k of Object.keys(before)) {
        changes[k] = { oldValue: before[k] };
      }

      await base.clear();
      dispatch(changes, areaName);
    },
    _getData: () => base._getData(),
  });

  const local = eventful(createMockStorage(initialLocal), 'local');
  const sync = eventful(createMockStorage(initialSync), 'sync');

  const browserStub = {
    runtime: { requestUpdateCheck: vi.fn() },
    storage: {
      local,
      sync,
      onChanged: {
        addListener: (listener: OnChangedListener) => {
          listeners.push(listener);
        },
        removeListener: (listener: OnChangedListener) => {
          const index = listeners.indexOf(listener);

          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
      },
    },
  };

  return { local, sync, browserStub, listeners };
}
