import type { FaveData, FaveSets, FaveState, ClickProtection } from '@/types';
import type { PublicPath } from 'wxt/browser';
import {
  getCurrentState,
  getNextState,
  applyState,
  commitFaveChange,
  ICON_SUFFIX,
} from '@/lib/toggle';
import { isMobile, attachLongPressHandler } from '@/lib/platform';
import { queryLast } from '@/lib/dom';

export function shiftHandler(e: KeyboardEvent): void {
  const shiftPressed = e.shiftKey;
  const main = document.getElementById('main');

  if (!main) {
    return;
  }

  const disabled = main.querySelectorAll<HTMLElement>('.pf-disabled');

  disabled.forEach((el) => {
    if (shiftPressed) {
      el.classList.add('shift-pressed');
    } else {
      el.classList.remove('shift-pressed');
    }
  });
}

function getToggleImageUrl(state: FaveState): string {
  const path = `/img/button_${ICON_SUFFIX[state]}.png` as PublicPath;

  return browser.runtime.getURL(path);
}

function applyElementStyling(
  element: HTMLElement,
  state: FaveState,
  clickProtection: ClickProtection,
): void {
  element.classList.toggle('storylet_favourite', state === 'fave');
  element.classList.toggle('storylet_avoid', state === 'avoid');

  const goButton = queryLast(element, '.button--go');

  if (!goButton) {
    return;
  }

  const isAvoid = state === 'avoid';

  goButton.classList.toggle('pf-disabled', isAvoid && clickProtection === 'shift');
  goButton.classList.toggle('button--disabled', isAvoid && clickProtection === 'shift');
  goButton.classList.toggle('pf-confirm', isAvoid && clickProtection === 'confirm');
}

function createToggleButton(id: number, state: FaveState, isLocked: boolean): HTMLInputElement {
  const btn = document.createElement('input');

  btn.type = 'image';
  btn.className = 'fave_toggle_button';
  btn.title = 'Toggle favourite';
  btn.src = getToggleImageUrl(state);
  btn.dataset.active = String(isLocked);
  btn.dataset.toggleId = String(id);

  return btn;
}

async function doToggle(
  id: number,
  isModifier: boolean,
  faveData: FaveData,
  favesKey: keyof FaveSets,
  avoidsKey: keyof FaveSets,
): Promise<void> {
  // The step is taken from the stored state, so a second click that arrives
  // before the first is saved still moves one step further.
  await commitFaveChange(faveData, (sets) => {
    const currentState = getCurrentState(id, sets[favesKey], sets[avoidsKey]);
    const nextState = getNextState(currentState, faveData.options.switch_mode, isModifier);

    applyState(id, nextState, sets[favesKey], sets[avoidsKey]);
  });
}

function makeToggleHandler(
  faveData: FaveData,
  favesKey: keyof FaveSets,
  avoidsKey: keyof FaveSets,
): (e: MouseEvent) => Promise<void> {
  return async (e: MouseEvent) => {
    e.preventDefault();

    const target = e.currentTarget as HTMLInputElement;
    const id = parseInt(target.dataset.toggleId ?? '', 10);

    if (isNaN(id)) {
      return;
    }

    const isModifier = e.metaKey || e.ctrlKey;

    await doToggle(id, isModifier, faveData, favesKey, avoidsKey);
  };
}

// Shared inner loop for branches and storylets. The only differences are:
//   - which faves/avoids sets are used
//   - branches use last .button--go for insertAfter (there can be 2 when
//     actions are insufficient), storylets use the first/only .button--go
function processElements(
  elements: NodeListOf<HTMLElement>,
  favesKey: keyof FaveSets,
  avoidsKey: keyof FaveSets,
  faveData: FaveData,
  useLast: boolean,
): void {
  const faves = faveData[favesKey];
  const avoids = faveData[avoidsKey];
  const toggleHandler = makeToggleHandler(faveData, favesKey, avoidsKey);

  elements.forEach((el) => {
    const match = el.dataset.branchId;

    if (!match) {
      return;
    }

    const id = parseInt(match, 10);

    if (isNaN(id)) {
      return;
    }

    const isLocked = el.classList.contains('media--locked');

    el.querySelectorAll('.fave_toggle_button').forEach((btn) => btn.remove());

    // Protector extensions fix: skip elements where .button--go is hidden.
    // The Protector check always uses the first .button--go (jQuery .prop() behaviour).
    const goButtons = el.querySelectorAll<HTMLElement>('.button--go');

    if (goButtons.length === 0) {
      return;
    }

    if (goButtons[0].offsetParent === null) {
      return;
    }

    // Branches use last .button--go (can be 2), storylets use first/only
    const insertAfterButton = useLast ? goButtons[goButtons.length - 1] : goButtons[0];

    const state = getCurrentState(id, faves, avoids);

    const toggleButton = createToggleButton(id, state, isLocked);

    toggleButton.addEventListener('click', toggleHandler);

    if (isMobile() && faveData.options.switch_mode === 'modifier_click') {
      attachLongPressHandler(
        toggleButton,
        () => doToggle(id, false, faveData, favesKey, avoidsKey),
        () => doToggle(id, true, faveData, favesKey, avoidsKey),
      );
    }

    insertAfterButton.after(toggleButton);

    applyElementStyling(el, state, faveData.options.click_protection);
  });
}

function reorderElements(
  elements: NodeListOf<HTMLElement>,
  reorderActive: boolean,
  reorderLocked: boolean,
): void {
  if (elements.length === 0) {
    return;
  }

  const firstMarker = document.createElement('div');

  firstMarker.className = 'first_reorder_marker';
  elements[0].before(firstMarker);

  const lastMarker = document.createElement('div');

  lastMarker.className = 'last_reorder_marker';
  elements[elements.length - 1].after(lastMarker);

  let lastActiveMarker: HTMLElement;
  const activeElements = Array.from(elements).filter(
    (el) => !el.classList.contains('media--locked'),
  );

  if (activeElements.length > 0) {
    const lastActiveElement = activeElements[activeElements.length - 1];
    const marker = document.createElement('div');

    marker.className = 'last_active_reorder_marker';
    lastActiveElement.after(marker);
    lastActiveMarker = marker;
  } else {
    lastActiveMarker = lastMarker;
  }

  const faves = Array.from(elements).filter((el) => el.classList.contains('storylet_favourite'));

  if (faves.length > 0) {
    if (reorderLocked) {
      faves
        .filter((el) => el.classList.contains('media--locked'))
        .forEach((el) => firstMarker.before(el));
    }

    if (reorderActive) {
      faves
        .filter((el) => !el.classList.contains('media--locked'))
        .forEach((el) => firstMarker.before(el));
    }
  }

  // jQuery's insertAfter preserves DOM order. Using .after() in a loop would
  // reverse the order, so we advance the insertion point after each insert.
  const avoidsEls = Array.from(elements).filter((el) => el.classList.contains('storylet_avoid'));

  if (avoidsEls.length > 0) {
    let insertionPoint: HTMLElement = lastActiveMarker;

    if (reorderLocked) {
      avoidsEls
        .filter((el) => el.classList.contains('media--locked'))
        .forEach((el) => {
          insertionPoint.after(el);
          insertionPoint = el;
        });
    }

    if (reorderActive) {
      avoidsEls
        .filter((el) => !el.classList.contains('media--locked'))
        .forEach((el) => {
          insertionPoint.after(el);
          insertionPoint = el;
        });
    }
  }

  document
    .querySelectorAll('.first_reorder_marker, .last_active_reorder_marker, .last_reorder_marker')
    .forEach((el) => el.remove());
}

export function parseStorylets(faveData: FaveData, reorder: boolean = false): void {
  const branches = document.querySelectorAll<HTMLElement>('#main .media--branch');
  const storylets = document.querySelectorAll<HTMLElement>('#main .storylet');
  const persistent = document.querySelectorAll<HTMLElement>('#main .persistent');

  let reorderActive = false;
  let reorderLocked = false;

  if (reorder) {
    switch (faveData.options.branch_reorder_mode) {
      case 'branch_no_reorder':
        break;
      case 'branch_reorder_active':
        reorderActive = true;
        break;
      case 'branch_reorder_all':
        reorderActive = true;
        reorderLocked = true;
        break;
    }
  }

  if (branches.length) {
    processElements(branches, 'branch_faves', 'branch_avoids', faveData, true);
    reorderElements(branches, reorderActive, reorderLocked);
  } else if (storylets.length) {
    processElements(storylets, 'storylet_faves', 'storylet_avoids', faveData, false);
    reorderElements(storylets, reorderActive, reorderLocked);
  }

  // Persistent storylets (Fifth City Stories) are processed separately
  // so reordering stays within the disclosure container
  if (persistent.length) {
    processElements(persistent, 'storylet_faves', 'storylet_avoids', faveData, false);
    reorderElements(persistent, reorderActive, reorderLocked);
  }
}
