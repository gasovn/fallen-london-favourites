import { MAX_PACK_ITEMS_PER_KEY, DEFAULT_OPTIONS, type DefaultStorageOptions } from '@/types';

export function packSet(set: Set<number>, storageKey: string): Record<string, unknown> {
  const source = Array.from(set).sort((a, b) => a - b);
  const total = source.length;
  const keys: string[] = [];
  const result: Record<string, unknown> = {};

  for (let index = 0; index * MAX_PACK_ITEMS_PER_KEY < total; index++) {
    result[`${storageKey}_${index}`] = source.slice(
      index * MAX_PACK_ITEMS_PER_KEY,
      (index + 1) * MAX_PACK_ITEMS_PER_KEY,
    );
    keys.push(`${storageKey}_${index}`);
  }

  result[`${storageKey}_keys`] = keys;

  return result;
}

export function unpackSet(data: Record<string, unknown>, storageKey: string): Set<number> {
  const result = new Set<number>();
  const keys = data[`${storageKey}_keys`];

  if (Array.isArray(keys)) {
    for (const key of keys) {
      const values = data[key];

      if (Array.isArray(values)) {
        for (const v of values) {
          result.add(v);
        }
      }
    }
  }

  return result;
}

export async function getOption<K extends keyof DefaultStorageOptions>(
  key: K,
): Promise<DefaultStorageOptions[K]> {
  const defaults = { [key]: DEFAULT_OPTIONS[key] };
  const data = await browser.storage.local.get(defaults);

  return data[key] as DefaultStorageOptions[K];
}

export async function setOption<K extends keyof DefaultStorageOptions>(
  key: K,
  value: DefaultStorageOptions[K],
): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function getOptions(): Promise<Record<string, unknown>> {
  const allData = await browser.storage.local.get(null);

  for (const [key, defaultValue] of Object.entries(DEFAULT_OPTIONS)) {
    if (!(key in allData)) {
      allData[key] = defaultValue;
    }
  }

  return allData;
}

export async function setOptions(data: Record<string, unknown>): Promise<void> {
  await browser.storage.local.set(data);
}
