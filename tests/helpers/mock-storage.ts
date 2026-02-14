import { vi } from 'vitest';

export interface MockStorage {
  get(keys: string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
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
