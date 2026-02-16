import type { FaveData, FaveState, SwitchMode } from '@/types';
import { packSet, setOptions } from '@/lib/storage';

export const ICON_SUFFIX: Record<FaveState, string> = {
  fave: 'filled',
  avoid: 'avoid',
  none: 'empty',
};

export interface FaveSets {
  branch_faves: Set<number>;
  branch_avoids: Set<number>;
  storylet_faves: Set<number>;
  storylet_avoids: Set<number>;
  card_faves: Set<number>;
  card_avoids: Set<number>;
}

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

export function toFaveSets(faveData: FaveData): FaveSets {
  return {
    branch_faves: faveData.branch_faves,
    branch_avoids: faveData.branch_avoids,
    storylet_faves: faveData.storylet_faves,
    storylet_avoids: faveData.storylet_avoids,
    card_faves: faveData.card_faves,
    card_avoids: faveData.card_avoids,
  };
}

export async function saveFaves(sets: FaveSets): Promise<void> {
  const data: Record<string, unknown> = {};

  Object.assign(data, packSet(sets.branch_faves, 'branch_faves'));
  Object.assign(data, packSet(sets.branch_avoids, 'branch_avoids'));
  Object.assign(data, packSet(sets.storylet_faves, 'storylet_faves'));
  Object.assign(data, packSet(sets.storylet_avoids, 'storylet_avoids'));
  Object.assign(data, packSet(sets.card_faves, 'card_faves'));
  Object.assign(data, packSet(sets.card_avoids, 'card_avoids'));

  await setOptions(data);
}
