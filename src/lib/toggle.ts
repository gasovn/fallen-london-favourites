import type { FaveData, FaveState, FaveSets, ReadTarget, SwitchMode } from '@/types';
import { DATA_KEYS, STORAGE_SCHEMA_VERSION } from '@/types';
import { packSet, setOptions } from '@/lib/storage';
import { findOrphanedChunks } from '@/lib/cleanup';
import { detectVersion } from '@/lib/migration';
import {
  keyFor,
  findProfileOrphans,
  profileExists,
  isComplete,
  readSets,
  emptySets,
  startsEmpty,
  REGISTRY_KEY,
} from '@/lib/profiles';
import { resolveCurrentIdentity } from '@/lib/identity';
import { readCharacterName } from '@/lib/character-name';
import { syncPayload, setDeviceFlag, SYNC_FULL_FLAG } from '@/lib/flags';
import { projectArea, wouldExceed } from '@/lib/quota';

export const ICON_SUFFIX: Record<FaveState, string> = {
  fave: 'filled',
  avoid: 'avoid',
  none: 'empty',
};

export function getCurrentState(id: number, faves: Set<number>, avoids: Set<number>): FaveState {
  if (faves.has(id)) {
    return 'fave';
  }

  if (avoids.has(id)) {
    return 'avoid';
  }

  return 'none';
}

/**
 * Compute the next state for branches and storylets.
 *
 * click_through cycle: none -> fave -> avoid -> none
 * modifier_click:
 *   normal click  — toggles fave (fave -> none, else -> fave)
 *   modifier click — toggles avoid (avoid -> none, else -> avoid)
 */
export function getNextState(
  currentState: FaveState,
  switchMode: SwitchMode,
  isModifierClick: boolean,
): FaveState {
  if (switchMode === 'click_through') {
    switch (currentState) {
      case 'fave':
        return 'avoid';
      case 'avoid':
        return 'none';
      case 'none':
        return 'fave';
    }
  }

  // modifier_click
  if (isModifierClick) {
    return currentState === 'avoid' ? 'none' : 'avoid';
  }

  return currentState === 'fave' ? 'none' : 'fave';
}

/**
 * Compute the next state for cards.
 *
 * The click_through cycle is identical to branches (none -> fave -> avoid -> none)
 * but the original code checks avoids before faves, preserving that order here.
 * modifier_click behavior is the same as branches/storylets.
 */
export function getNextCardState(
  currentState: FaveState,
  switchMode: SwitchMode,
  isModifierClick: boolean,
): FaveState {
  if (switchMode === 'click_through') {
    switch (currentState) {
      case 'avoid':
        return 'none';
      case 'fave':
        return 'avoid';
      case 'none':
        return 'fave';
    }
  }

  // modifier_click
  if (isModifierClick) {
    return currentState === 'avoid' ? 'none' : 'avoid';
  }

  return currentState === 'fave' ? 'none' : 'fave';
}

export function applyState(
  id: number,
  state: FaveState,
  faves: Set<number>,
  avoids: Set<number>,
): void {
  switch (state) {
    case 'fave':
      faves.add(id);
      avoids.delete(id);
      break;
    case 'avoid':
      faves.delete(id);
      avoids.add(id);
      break;
    case 'none':
      faves.delete(id);
      avoids.delete(id);
      break;
  }
}

export function packTarget(sets: FaveSets, target: ReadTarget): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const category of DATA_KEYS) {
    Object.assign(data, packSet(sets[category], keyFor(target, category)));
  }

  return data;
}

export async function saveFaves(
  sets: FaveSets,
  target: ReadTarget = { kind: 'default' },
  name: string | null = null,
): Promise<void> {
  const data = packTarget(sets, target);

  // Without the marker, packed keys alone read as the legacy v2 format and get
  // migrated on the next pull. Only a fresh store is stamped: legacy data
  // still waiting for its migration must keep reading as legacy.
  const stored = await browser.storage.local.get(null);

  if (
    typeof stored.storage_schema !== 'number' &&
    detectVersion(stored) === STORAGE_SCHEMA_VERSION
  ) {
    data.storage_schema = STORAGE_SCHEMA_VERSION;
  }

  await setOptions(data);

  // Name capture and orphan cleanup — best effort, never break the save
  try {
    const current = await browser.storage.local.get(null);

    if (target.kind === 'profile' && name) {
      const names = (current[REGISTRY_KEY] as Record<string, string> | undefined) ?? {};

      if (names[target.charId] !== name) {
        await browser.storage.local.set({
          [REGISTRY_KEY]: { ...names, [target.charId]: name },
        });
      }
    }

    // Race condition check: verify our _keys are still in place
    const keysMatch = DATA_KEYS.every((category) => {
      const key = `${keyFor(target, category)}_keys`;
      const written = data[key] as string[];
      const kept = current[key];

      return Array.isArray(kept) && JSON.stringify(kept) === JSON.stringify(written);
    });

    if (!keysMatch) {
      return;
    }

    const orphans =
      target.kind === 'profile'
        ? findProfileOrphans(current, target.charId)
        : findOrphanedChunks(current);

    if (orphans.length > 0) {
      // In sync they go with the mirror, after the `_keys` list that stops naming them.
      await browser.storage.local.remove(orphans);
    }
  } catch {
    // Non-critical — the next save removes what is left
  }
}

function assignSets(faveData: FaveData, sets: FaveSets): void {
  for (const category of DATA_KEYS) {
    faveData[category].clear();

    for (const value of sets[category]) {
      faveData[category].add(value);
    }
  }
}

/**
 * The stored set an edit builds on. A profile created after the page last
 * loaded its data, by an earlier edit here or by another tab, takes over from
 * the set the page was rendered from.
 */
function sourceOf(faveData: FaveData, snapshot: Record<string, unknown>): ReadTarget {
  const target = faveData.writeTarget;

  return target.kind === 'profile' && profileExists(snapshot, target.charId)
    ? target
    : faveData.readTarget;
}

/**
 * False when the source set is still syncing or, for a profile write, when no
 * character resolves or it differs from the one the data was loaded for.
 */
function guardAndComplete(
  faveData: FaveData,
  writeCharId: string | null,
  snapshot: Record<string, unknown>,
): boolean {
  if (faveData.writeTarget.kind === 'profile') {
    if (
      faveData.loadedCharId === null ||
      writeCharId === null ||
      faveData.loadedCharId !== writeCharId
    ) {
      return false;
    }
  }

  return isComplete(snapshot, sourceOf(faveData, snapshot));
}

function quotaRefuses(
  snapshot: Record<string, unknown>,
  newData: Record<string, unknown>,
): boolean {
  const current = projectArea(syncPayload(snapshot));
  const projected = projectArea(syncPayload({ ...snapshot, ...newData }));

  return wouldExceed(projected, current);
}

let lastCommit: Promise<void> = Promise.resolve();

/**
 * Apply one edit and save it. The base set is re-read from the snapshot the
 * checks ran against rather than taken from faveData, which may hold a partial
 * read. A refused write leaves faveData untouched. Edits run one at a time, so
 * each builds on what the one before it stored.
 */
export function commitFaveChange(
  faveData: FaveData,
  applyEdit: (sets: FaveSets) => void,
): Promise<void> {
  const commit = lastCommit.then(() => commitNow(faveData, applyEdit));

  lastCommit = commit.catch(() => undefined);

  return commit;
}

async function commitNow(faveData: FaveData, applyEdit: (sets: FaveSets) => void): Promise<void> {
  const target = faveData.writeTarget;

  if (target.kind === 'blocked') {
    return;
  }

  const writeCharId = resolveCurrentIdentity().charId;
  const snapshot = await browser.storage.local.get(null);

  if (!guardAndComplete(faveData, writeCharId, snapshot)) {
    return;
  }

  const base = startsEmpty(snapshot, target)
    ? emptySets()
    : readSets(snapshot, sourceOf(faveData, snapshot));

  applyEdit(base);

  const newData = packTarget(base, target);
  const name = readCharacterName();

  // Everything saveFaves will write: the sets, the marker of a fresh store and
  // a new or changed name.
  if (
    typeof snapshot.storage_schema !== 'number' &&
    detectVersion(snapshot) === STORAGE_SCHEMA_VERSION
  ) {
    newData.storage_schema = STORAGE_SCHEMA_VERSION;
  }

  if (target.kind === 'profile' && name) {
    const names = (snapshot[REGISTRY_KEY] as Record<string, string> | undefined) ?? {};

    if (names[target.charId] !== name) {
      newData[REGISTRY_KEY] = { ...names, [target.charId]: name };
    }
  }

  if (quotaRefuses(snapshot, newData)) {
    await setDeviceFlag(SYNC_FULL_FLAG, true);

    return;
  }

  await saveFaves(base, target, name);
  assignSets(faveData, base);
}
