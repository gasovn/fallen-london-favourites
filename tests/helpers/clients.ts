import { vi } from 'vitest';
import type { FaveSets } from '@/types';
import { packSet, unpackSet } from '../../src/lib/storage';
import { detectVersion } from '../../src/lib/migration';
import { findOrphanedChunks, findZombieKeys } from '../../src/lib/cleanup';
import type { MockStorage } from './mock-storage';

export interface Device {
  local: MockStorage;
  sync: MockStorage;
}

function browserStub(device: Device): Record<string, unknown> {
  return {
    runtime: { requestUpdateCheck: vi.fn() },
    storage: { local: device.local, sync: device.sync, onChanged: { addListener: vi.fn() } },
  };
}

export function useDevice(device: Device): void {
  vi.stubGlobal('browser', browserStub(device));
}

export function sets(overrides: Partial<Record<keyof FaveSets, number[]>> = {}): FaveSets {
  const make = (key: keyof FaveSets): Set<number> => new Set(overrides[key] ?? []);

  return {
    branch_faves: make('branch_faves'),
    branch_avoids: make('branch_avoids'),
    storylet_faves: make('storylet_faves'),
    storylet_avoids: make('storylet_avoids'),
    card_faves: make('card_faves'),
    card_avoids: make('card_avoids'),
  };
}

export function sorted(set: Set<number>): number[] {
  return Array.from(set).sort((a, b) => a - b);
}

// The v4 client (0.7.3): flat keys only, a whole-area mirror with no quota
// check, pulls that go ahead even while local edits are unmirrored, and a
// migrate() that leaves data with a newer marker alone. storage.ts and
// cleanup.ts have the same code as in 0.7.3, so the real functions stand in
// for the old ones.

async function legacyMigrate(area: MockStorage): Promise<void> {
  const version = detectVersion(await area.get(null));

  if (version < 4) {
    throw new Error(`legacy client model covers v4+ data only (got v${version})`);
  }
}

export async function legacyPull(device: Device): Promise<void> {
  await legacyMigrate(device.sync);
  await device.local.set(await device.sync.get(null));
}

export async function legacyPush(device: Device): Promise<void> {
  await device.sync.set(await device.local.get(null));

  const syncData = await device.sync.get(null);
  const stale = [...findOrphanedChunks(syncData), ...findZombieKeys(syncData)];

  if (stale.length > 0) {
    await device.sync.remove(stale);
  }
}

export async function legacySaveFaves(
  device: Device,
  category: string,
  set: number[],
): Promise<void> {
  await device.local.set(packSet(new Set(set), category));

  const orphans = findOrphanedChunks(await device.local.get(null));

  if (orphans.length > 0) {
    await device.local.remove(orphans);
  }
}

export async function legacyRead(device: Device, category: string): Promise<number[]> {
  return sorted(unpackSet(await device.local.get(null), category));
}
