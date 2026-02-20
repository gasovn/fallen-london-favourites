import { DATA_KEYS } from '@/types';

const CHUNK_CATEGORIES = [...DATA_KEYS, 'card_protects', 'card_discards'] as const;

/**
 * Find orphaned _N chunk keys not referenced by their _keys registry.
 * Pure function — does not touch storage.
 */
export function findOrphanedChunks(data: Record<string, unknown>): string[] {
  const orphans: string[] = [];

  for (const category of CHUNK_CATEGORIES) {
    const registry = data[`${category}_keys`];
    const validChunks = new Set(Array.isArray(registry) ? registry : []);

    const chunkPattern = new RegExp(`^${category}_(\\d+)$`);

    for (const key of Object.keys(data)) {
      if (chunkPattern.test(key) && !validChunks.has(key)) {
        orphans.push(key);
      }
    }
  }

  return orphans;
}

const ZOMBIE_KEYS = [
  'block_action',
  'branch_fave_array',
  'branch_faves',
  'storylet_fave_array',
  'card_protect_array',
  'card_discard_array',
  'card_protects_keys',
  'card_discards_keys',
] as const;

/**
 * Find known legacy keys that should have been removed by migration
 * but persist due to merge-based sync writes.
 * Pure function — does not touch storage.
 */
export function findZombieKeys(data: Record<string, unknown>): string[] {
  return ZOMBIE_KEYS.filter((key) => key in data);
}

interface StorageArea {
  get(keys: null): Promise<Record<string, unknown>>;
  remove(keys: string[]): Promise<void>;
}

/**
 * Remove orphaned chunks and zombie keys from a storage area.
 * Safe to call on both storage.local and storage.sync.
 */
export async function cleanupStorage(storage: StorageArea): Promise<void> {
  const data = await storage.get(null);
  const keysToRemove = [...findOrphanedChunks(data), ...findZombieKeys(data)];

  if (keysToRemove.length > 0) {
    await storage.remove(keysToRemove);
  }
}
