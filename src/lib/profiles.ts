import { DATA_KEYS, type ReadTarget, type WriteTarget, type FaveSets } from '@/types';
import { unpackSet } from './storage';

export const PROFILE_PREFIX = 'p:';

/** Character names by id, display-only. */
export const REGISTRY_KEY = 'p:registry';

export function keyFor(target: ReadTarget, category: string): string {
  return target.kind === 'profile' ? `${PROFILE_PREFIX}${target.charId}:${category}` : category;
}

/**
 * A profile exists when it has at least one `<cat>_keys` registry. The name
 * registry does not decide this: names and profiles are written separately and
 * need not match.
 */
export function profileExists(data: Record<string, unknown>, charId: string): boolean {
  return DATA_KEYS.some((category) =>
    Array.isArray(data[`${PROFILE_PREFIX}${charId}:${category}_keys`]),
  );
}

export function listProfileCharIds(data: Record<string, unknown>): string[] {
  const ids = new Set<string>();

  for (const category of DATA_KEYS) {
    const pattern = new RegExp(`^p:([0-9]+):${category}_keys$`);

    for (const key of Object.keys(data)) {
      const match = pattern.exec(key);

      if (match && Array.isArray(data[key])) {
        ids.add(match[1]);
      }
    }
  }

  return Array.from(ids).sort();
}

export function keysForProfile(data: Record<string, unknown>, charId: string): string[] {
  const prefix = `${PROFILE_PREFIX}${charId}:`;

  return Object.keys(data).filter((key) => key.startsWith(prefix));
}

/**
 * False when a registry references a chunk that has not arrived yet. A set
 * read in that state is partial and must not be written back.
 */
export function isComplete(data: Record<string, unknown>, target: ReadTarget): boolean {
  for (const category of DATA_KEYS) {
    const registry = data[`${keyFor(target, category)}_keys`];

    if (!Array.isArray(registry)) {
      continue;
    }

    for (const chunkKey of registry) {
      if (typeof chunkKey !== 'string' || !(chunkKey in data)) {
        return false;
      }
    }
  }

  return true;
}

export function readSets(data: Record<string, unknown>, target: ReadTarget): FaveSets {
  return {
    branch_faves: unpackSet(data, keyFor(target, 'branch_faves')),
    branch_avoids: unpackSet(data, keyFor(target, 'branch_avoids')),
    storylet_faves: unpackSet(data, keyFor(target, 'storylet_faves')),
    storylet_avoids: unpackSet(data, keyFor(target, 'storylet_avoids')),
    card_faves: unpackSet(data, keyFor(target, 'card_faves')),
    card_avoids: unpackSet(data, keyFor(target, 'card_avoids')),
  };
}

export interface WriteContext {
  loadedCharId: string | null;
  readTarget: ReadTarget;
  writeTarget: WriteTarget;
}

/**
 * Decided each time the page loads its data, not per edit. A character without
 * a profile reads the shared default while its writes go to a new profile.
 */
export function resolveContext(
  multi: boolean,
  charId: string | null,
  data: Record<string, unknown>,
): WriteContext {
  if (!multi) {
    return {
      loadedCharId: charId,
      readTarget: { kind: 'default' },
      writeTarget: { kind: 'default' },
    };
  }

  if (charId === null) {
    return {
      loadedCharId: null,
      readTarget: { kind: 'default' },
      writeTarget: { kind: 'blocked' },
    };
  }

  const readTarget: ReadTarget = profileExists(data, charId)
    ? { kind: 'profile', charId }
    : { kind: 'default' };

  return { loadedCharId: charId, readTarget, writeTarget: { kind: 'profile', charId } };
}

export function emptySets(): FaveSets {
  return {
    branch_faves: new Set(),
    branch_avoids: new Set(),
    storylet_faves: new Set(),
    storylet_avoids: new Set(),
    card_faves: new Set(),
    card_avoids: new Set(),
  };
}

/** True when a character's first edit starts its profile empty, not from the shared default. */
export function startsEmpty(data: Record<string, unknown>, target: WriteTarget): boolean {
  return (
    target.kind === 'profile' && data.start_empty === true && !profileExists(data, target.charId)
  );
}

/**
 * Empty while blocked (the character is unknown and may have its own
 * profile) and for a character whose profile will start empty.
 */
export function renderSets(data: Record<string, unknown>, context: WriteContext): FaveSets {
  return context.writeTarget.kind === 'blocked' || startsEmpty(data, context.writeTarget)
    ? emptySets()
    : readSets(data, context.readTarget);
}

/**
 * Chunks of one profile that its registries no longer reference. Matched by
 * prefix; the id is never put into a RegExp.
 */
export function findProfileOrphans(data: Record<string, unknown>, charId: string): string[] {
  const prefix = `${PROFILE_PREFIX}${charId}:`;
  const orphans: string[] = [];

  for (const category of DATA_KEYS) {
    const registry = data[`${prefix}${category}_keys`];
    const valid = new Set(Array.isArray(registry) ? registry : []);
    const tail = new RegExp(`^${category}_(\\d+)$`);

    for (const key of Object.keys(data)) {
      if (!key.startsWith(prefix)) {
        continue;
      }

      if (tail.test(key.slice(prefix.length)) && !valid.has(key)) {
        orphans.push(key);
      }
    }
  }

  return orphans;
}
