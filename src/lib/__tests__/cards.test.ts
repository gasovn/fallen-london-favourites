// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCards } from '../cards';
import { isMobile } from '../platform';
import type { FaveData } from '@/types';

vi.mock('../platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform')>(); // eslint-disable-line @typescript-eslint/consistent-type-imports

  return {
    ...actual,
    isMobile: vi.fn(() => false),
  };
});

vi.stubGlobal('browser', {
  runtime: {
    getURL: (path: string) => `chrome-extension://test${path}`,
  },
  storage: {
    local: {
      set: vi.fn(() => Promise.resolve()),
    },
  },
});

function makeFaveData(overrides: Partial<FaveData> = {}): FaveData {
  return {
    branch_faves: new Set(),
    branch_avoids: new Set(),
    storylet_faves: new Set(),
    storylet_avoids: new Set(),
    card_faves: new Set(),
    card_avoids: new Set(),
    options: {
      branch_reorder_mode: 'branch_no_reorder',
      switch_mode: 'click_through',
      click_protection: 'off',
    },
    ...overrides,
  };
}

function createHandCard(id: number): HTMLElement {
  const card = document.createElement('div');

  card.className = 'hand__card-container';
  card.dataset.eventId = String(id);
  Object.defineProperty(card, 'offsetParent', { value: document.body, configurable: true });

  for (const cls of [
    'hand__card',
    'card__discard-button',
    'button--margin',
    'buttonlet-container',
  ]) {
    const child = document.createElement('div');

    child.className = cls;
    card.appendChild(child);
  }

  return card;
}

function createSmallCard(id: number): HTMLElement {
  const card = document.createElement('div');

  card.className = 'small-card-container';
  card.dataset.eventId = String(id);
  Object.defineProperty(card, 'offsetParent', { value: document.body, configurable: true });

  const buttons = document.createElement('div');

  buttons.className = 'buttons';
  card.appendChild(buttons);

  for (const cls of ['card__discard-button', 'buttonlet-container']) {
    const child = document.createElement('div');

    child.className = cls;
    card.appendChild(child);
  }

  return card;
}

describe('parseCards', () => {
  let main: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    main = document.createElement('div');
    main.id = 'main';
    document.body.appendChild(main);
  });

  it('creates toggle button in hand__card-container', () => {
    main.appendChild(createHandCard(100));

    parseCards(makeFaveData());

    const card = main.querySelector('.hand__card-container')!;

    expect(card.querySelector('.card_toggle_button')).not.toBeNull();
  });

  it('creates toggle button in small-card-container inside .buttons', () => {
    main.appendChild(createSmallCard(200));

    parseCards(makeFaveData());

    const buttons = main.querySelector('.small-card-container .buttons')!;

    expect(buttons.querySelector('.card_toggle_button')).not.toBeNull();
  });

  it('applies fave styling', () => {
    main.appendChild(createHandCard(100));

    parseCards(makeFaveData({ card_faves: new Set([100]) }));

    const card = main.querySelector('.hand__card-container')!;

    expect(card.classList.contains('card_fave')).toBe(true);
    expect(card.querySelector('.card__discard-button')!.classList.contains('button_avoid')).toBe(
      true,
    );
  });

  it('applies avoid styling', () => {
    main.appendChild(createHandCard(100));

    parseCards(makeFaveData({ card_avoids: new Set([100]) }));

    const card = main.querySelector('.hand__card-container')!;

    expect(card.classList.contains('card_avoid')).toBe(true);
    expect(card.querySelector('.card__discard-button')!.classList.contains('button_fave')).toBe(
      true,
    );
  });

  it('processes both hand and small cards', () => {
    main.appendChild(createHandCard(100));
    main.appendChild(createSmallCard(200));

    parseCards(makeFaveData());

    const toggles = main.querySelectorAll('.card_toggle_button');

    expect(toggles.length).toBe(2);
  });

  it('fave + shift protection disables discard and buttonlet', () => {
    main.appendChild(createHandCard(100));

    parseCards(
      makeFaveData({
        card_faves: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'shift',
        },
      }),
    );

    const card = main.querySelector('.hand__card-container')!;

    expect(card.querySelector('.card__discard-button')!.classList.contains('pf-disabled')).toBe(
      true,
    );
    expect(card.querySelector('.buttonlet-container')!.classList.contains('pf-disabled')).toBe(
      true,
    );
    expect(card.querySelector('.button--margin')!.classList.contains('pf-disabled')).toBe(false);
    expect(card.querySelector('.hand__card')!.classList.contains('pf-disabled')).toBe(false);
  });

  it('avoid + shift protection disables margin and hand card', () => {
    main.appendChild(createHandCard(100));

    parseCards(
      makeFaveData({
        card_avoids: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'shift',
        },
      }),
    );

    const card = main.querySelector('.hand__card-container')!;

    expect(card.querySelector('.button--margin')!.classList.contains('pf-disabled')).toBe(true);
    expect(card.querySelector('.hand__card')!.classList.contains('pf-disabled')).toBe(true);
    expect(card.querySelector('.card__discard-button')!.classList.contains('pf-disabled')).toBe(
      false,
    );
    expect(card.querySelector('.buttonlet-container')!.classList.contains('pf-disabled')).toBe(
      false,
    );
  });

  it('fave + confirm protection adds pf-confirm without pf-disabled', () => {
    main.appendChild(createHandCard(100));

    parseCards(
      makeFaveData({
        card_faves: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'confirm',
        },
      }),
    );

    const card = main.querySelector('.hand__card-container')!;

    expect(card.querySelector('.card__discard-button')!.classList.contains('pf-confirm')).toBe(
      true,
    );
    expect(card.querySelector('.buttonlet-container')!.classList.contains('pf-confirm')).toBe(true);
    expect(card.querySelector('.card__discard-button')!.classList.contains('pf-disabled')).toBe(
      false,
    );
    expect(card.querySelector('.buttonlet-container')!.classList.contains('pf-disabled')).toBe(
      false,
    );
  });

  it('avoid + confirm protection adds pf-confirm to margin and hand card', () => {
    main.appendChild(createHandCard(100));

    parseCards(
      makeFaveData({
        card_avoids: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'confirm',
        },
      }),
    );

    const card = main.querySelector('.hand__card-container')!;

    expect(card.querySelector('.button--margin')!.classList.contains('pf-confirm')).toBe(true);
    expect(card.querySelector('.hand__card')!.classList.contains('pf-confirm')).toBe(true);
    expect(card.querySelector('.button--margin')!.classList.contains('pf-disabled')).toBe(false);
    expect(card.querySelector('.hand__card')!.classList.contains('pf-disabled')).toBe(false);
  });

  it('click_protection "off" does not add protection classes', () => {
    main.appendChild(createHandCard(100));

    parseCards(
      makeFaveData({
        card_avoids: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'off',
        },
      }),
    );

    const card = main.querySelector('.hand__card-container')!;

    expect(card.querySelector('.button--margin')!.classList.contains('pf-disabled')).toBe(false);
    expect(card.querySelector('.hand__card')!.classList.contains('pf-disabled')).toBe(false);
    expect(card.querySelector('.button--margin')!.classList.contains('pf-confirm')).toBe(false);
    expect(card.querySelector('.hand__card')!.classList.contains('pf-confirm')).toBe(false);
  });

  it('skips hidden cards', () => {
    const card = document.createElement('div');

    card.className = 'hand__card-container';
    card.dataset.eventId = '100';
    Object.defineProperty(card, 'offsetParent', { value: null });
    main.appendChild(card);

    parseCards(makeFaveData());

    expect(card.querySelector('.card_toggle_button')).toBeNull();
  });

  it('uses card_*.png for hand cards, button_*.png for small cards', () => {
    main.appendChild(createHandCard(100));
    main.appendChild(createSmallCard(200));

    parseCards(makeFaveData());

    const handToggle = main.querySelector(
      '.hand__card-container .card_toggle_button',
    ) as HTMLElement;
    const smallToggle = main.querySelector(
      '.small-card-container .card_toggle_button',
    ) as HTMLElement;

    expect(handToggle.style.backgroundImage).toContain('card_empty');
    expect(smallToggle.style.backgroundImage).toContain('button_empty');
  });
});

describe('mobile long press on card toggle', () => {
  let main: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    main = document.createElement('div');
    main.id = 'main';
    document.body.appendChild(main);
    vi.mocked(isMobile).mockReturnValue(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.mocked(isMobile).mockReturnValue(false);
    vi.useRealTimers();
  });

  function fakeTouchEvent(type: string, x = 0, y = 0): Event {
    const event = new Event(type, { bubbles: true });

    Object.defineProperty(event, 'touches', {
      value: [{ clientX: x, clientY: y }],
    });

    return event;
  }

  it('long press sets avoid in modifier_click mode', () => {
    main.appendChild(createHandCard(100));

    const data = makeFaveData({
      options: { ...makeFaveData().options, switch_mode: 'modifier_click' },
    });

    parseCards(data);

    const toggleBtn = main.querySelector('.card_toggle_button') as HTMLElement;

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart'));
    vi.advanceTimersByTime(500);

    expect(data.card_avoids.has(100)).toBe(true);
  });

  it('short press sets fave in modifier_click mode', () => {
    main.appendChild(createHandCard(100));

    const data = makeFaveData({
      options: { ...makeFaveData().options, switch_mode: 'modifier_click' },
    });

    parseCards(data);

    const toggleBtn = main.querySelector('.card_toggle_button') as HTMLElement;

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart'));
    toggleBtn.dispatchEvent(fakeTouchEvent('touchend'));

    expect(data.card_faves.has(100)).toBe(true);
  });

  it('does not attach touch handlers in click_through mode', () => {
    main.appendChild(createHandCard(100));

    const data = makeFaveData(); // click_through by default

    parseCards(data);

    const toggleBtn = main.querySelector('.card_toggle_button') as HTMLElement;

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart'));
    vi.advanceTimersByTime(500);

    expect(data.card_faves.has(100)).toBe(false);
    expect(data.card_avoids.has(100)).toBe(false);
  });
});
