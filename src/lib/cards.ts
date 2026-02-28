import type { PublicPath } from 'wxt/browser';
import type { FaveData, FaveState, ClickProtection } from '@/types';
import {
  getCurrentState,
  getNextCardState,
  applyState,
  saveFaves,
  toFaveSets,
  ICON_SUFFIX,
} from '@/lib/toggle';
import { isMobile, attachLongPressHandler } from '@/lib/platform';
import { queryLast } from '@/lib/dom';

// Hand cards use card_*.png (16x16) on desktop, button_*.png (30x30) on mobile
// Small cards always use button_*.png (30x30)
function getCardButtonImageUrl(container: Element, state: FaveState): string {
  const isHandCard = container.classList.contains('hand__card-container');
  const prefix = isHandCard && !isMobile() ? 'card' : 'button';
  const path = `/img/${prefix}_${ICON_SUFFIX[state]}.png` as PublicPath;

  return browser.runtime.getURL(path);
}

function applyClickProtection(
  container: Element,
  state: FaveState,
  clickProtection: ClickProtection,
): void {
  const discardButton = queryLast(container, '.card__discard-button');
  const marginButton = queryLast(container, '.button--margin');
  const handCard = queryLast(container, '.hand__card');
  const buttonletContainer = queryLast(container, '.buttonlet-container');

  const isShift = clickProtection === 'shift';
  const isConfirm = clickProtection === 'confirm';

  // Faved cards: shield discard/delete buttons (prevent removing)
  const shieldFave = state === 'fave';
  // Avoided cards: shield margin/hand card (prevent playing)
  const shieldAvoid = state === 'avoid';

  if (discardButton) {
    discardButton.classList.toggle('pf-disabled', shieldFave && isShift);
    discardButton.classList.toggle('button--disabled', shieldFave && isShift);
    discardButton.classList.toggle('pf-confirm', shieldFave && isConfirm);
  }

  if (marginButton) {
    marginButton.classList.toggle('pf-disabled', shieldAvoid && isShift);
    marginButton.classList.toggle('pf-confirm', shieldAvoid && isConfirm);
  }

  if (handCard) {
    handCard.classList.toggle('pf-disabled', shieldAvoid && isShift);
    handCard.classList.toggle('pf-confirm', shieldAvoid && isConfirm);
  }

  if (buttonletContainer) {
    buttonletContainer.classList.toggle('pf-disabled', shieldFave && isShift);
    buttonletContainer.classList.toggle('button--disabled', shieldFave && isShift);
    buttonletContainer.classList.toggle('pf-confirm', shieldFave && isConfirm);
  }
}

function applyCardStyling(container: Element, state: FaveState): void {
  const discardButtons = container.querySelectorAll<HTMLElement>(
    '.card__discard-button, .buttonlet-container',
  );

  switch (state) {
    case 'avoid':
      container.classList.remove('card_fave');
      container.classList.add('card_avoid');

      for (const btn of discardButtons) {
        btn.classList.add('button_fave');
        btn.classList.remove('button_avoid');
      }

      break;

    case 'fave':
      container.classList.add('card_fave');
      container.classList.remove('card_avoid');

      for (const btn of discardButtons) {
        btn.classList.remove('button_fave');
        btn.classList.add('button_avoid');
      }

      break;

    case 'none':
      container.classList.remove('card_fave');
      container.classList.remove('card_avoid');

      for (const btn of discardButtons) {
        btn.classList.remove('button_fave');
        btn.classList.remove('button_avoid');
      }

      break;
  }
}

async function doCardToggle(
  cardId: number,
  isModifier: boolean,
  faveData: FaveData,
): Promise<void> {
  const currentState = getCurrentState(cardId, faveData.card_faves, faveData.card_avoids);
  const nextState = getNextCardState(currentState, faveData.options.switch_mode, isModifier);

  applyState(cardId, nextState, faveData.card_faves, faveData.card_avoids);
  await saveFaves(toFaveSets(faveData));
  parseCards(faveData);
}

function createCardToggleHandler(faveData: FaveData): (e: MouseEvent) => void {
  return async (e: MouseEvent) => {
    e.preventDefault();

    const button = e.currentTarget as HTMLElement;
    const cardId = parseInt(button.dataset.toggleId ?? '', 10);

    if (isNaN(cardId)) {
      return;
    }

    const isModifier = e.metaKey || e.ctrlKey;

    await doCardToggle(cardId, isModifier, faveData);
  };
}

export function parseCards(faveData: FaveData): void {
  const cards = document.querySelectorAll<HTMLElement>(
    '#main .hand__card-container, #main .small-card-container',
  );

  const toggleHandler = createCardToggleHandler(faveData);

  for (const card of cards) {
    const match = card.dataset.eventId;

    if (!match) {
      continue;
    }

    const cardId = parseInt(match, 10);

    if (isNaN(cardId)) {
      continue;
    }

    const existingButtons = card.querySelectorAll('.card_toggle_button');

    for (const btn of existingButtons) {
      btn.remove();
    }

    // Protector extensions fix: skip hidden cards
    if (card.offsetParent === null) {
      continue;
    }

    const toggleButton = document.createElement('button');

    toggleButton.className = 'card_toggle_button';
    toggleButton.title = 'Toggle favourite';
    toggleButton.dataset.toggleId = String(cardId);
    toggleButton.addEventListener('click', toggleHandler);

    if (isMobile() && faveData.options.switch_mode === 'modifier_click') {
      attachLongPressHandler(
        toggleButton,
        () => doCardToggle(cardId, false, faveData),
        () => doCardToggle(cardId, true, faveData),
      );
    }

    if (card.classList.contains('hand__card-container')) {
      card.appendChild(toggleButton);
    } else {
      const buttonsContainer = card.querySelector('.buttons');

      if (buttonsContainer) {
        buttonsContainer.appendChild(toggleButton);
      }
    }

    const state = getCurrentState(cardId, faveData.card_faves, faveData.card_avoids);

    applyCardStyling(card, state);
    applyClickProtection(card, state, faveData.options.click_protection);

    const imageUrl = getCardButtonImageUrl(card, state);

    toggleButton.style.backgroundImage = `url('${imageUrl}')`;
  }
}
