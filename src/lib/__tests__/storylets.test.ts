// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseStorylets, fillClickHandlers } from '../storylets';
import { isMobile } from '../platform';
import type { FaveData } from '@/types';

vi.mock('../platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform')>(); // eslint-disable-line @typescript-eslint/consistent-type-imports

  return {
    ...actual,
    isMobile: vi.fn(() => false),
  };
});

// Mock WXT's browser global
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
      block_action: false,
      protectInterval: 5000,
    },
    ...overrides,
  };
}

function createStoryletElement(id: number, className: string): HTMLElement {
  const el = document.createElement('div');

  el.className = `media ${className}`;
  el.dataset.branchId = String(id);

  const goButton = document.createElement('button');

  goButton.className = 'button--go';
  // Make offsetParent non-null (jsdom returns null by default for detached elements,
  // but we need to override the Protector check in processElements)
  Object.defineProperty(goButton, 'offsetParent', { value: document.body });
  el.appendChild(goButton);

  return el;
}

describe('parseStorylets', () => {
  let main: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    main = document.createElement('div');
    main.id = 'main';
    document.body.appendChild(main);
  });

  it('adds toggle button to .storylet elements', () => {
    main.appendChild(createStoryletElement(100, 'storylet'));

    parseStorylets(makeFaveData());

    expect(main.querySelector('.fave_toggle_button')).not.toBeNull();
  });

  it('adds toggle button to .persistent elements', () => {
    main.appendChild(createStoryletElement(200, 'persistent'));

    parseStorylets(makeFaveData());

    expect(main.querySelector('.fave_toggle_button')).not.toBeNull();
  });

  it('applies fave styling to persistent storylets', () => {
    main.appendChild(createStoryletElement(200, 'persistent'));

    parseStorylets(makeFaveData({ storylet_faves: new Set([200]) }));

    const el = main.querySelector('[data-branch-id="200"]')!;

    expect(el.classList.contains('storylet_favourite')).toBe(true);
  });

  it('applies avoid styling to persistent storylets', () => {
    main.appendChild(createStoryletElement(200, 'persistent'));

    parseStorylets(makeFaveData({ storylet_avoids: new Set([200]) }));

    const el = main.querySelector('[data-branch-id="200"]')!;

    expect(el.classList.contains('storylet_avoid')).toBe(true);
  });

  it('processes both .storylet and .persistent in the same page', () => {
    main.appendChild(createStoryletElement(100, 'storylet'));
    main.appendChild(createStoryletElement(200, 'persistent'));

    parseStorylets(makeFaveData());

    const toggles = main.querySelectorAll('.fave_toggle_button');

    expect(toggles.length).toBe(2);
  });

  it('reorders persistent storylets within their own container', () => {
    // Simulate the real DOM: storylets at top level, persistent inside a disclosure wrapper
    const storylet1 = createStoryletElement(100, 'storylet');
    const storylet2 = createStoryletElement(101, 'storylet');

    main.appendChild(storylet1);
    main.appendChild(storylet2);

    const disclosure = document.createElement('div');

    disclosure.className = 'disclosure-children';

    const persistent1 = createStoryletElement(200, 'persistent');
    const persistent2 = createStoryletElement(201, 'persistent');

    disclosure.appendChild(persistent1);
    disclosure.appendChild(persistent2);
    main.appendChild(disclosure);

    // Mark storylet 101 as avoided and persistent 200 as avoided — both should reorder within their group
    parseStorylets(
      makeFaveData({
        storylet_avoids: new Set([101, 200]),
        options: {
          branch_reorder_mode: 'branch_reorder_active',
          switch_mode: 'click_through',
          block_action: false,
          protectInterval: 5000,
        },
      }),
      true,
    );

    // Persistent elements must stay inside their disclosure container
    expect(persistent1.parentElement).toBe(disclosure);
    expect(persistent2.parentElement).toBe(disclosure);

    // Regular storylets must stay outside the disclosure container
    expect(storylet1.parentElement).toBe(main);
    expect(storylet2.parentElement).toBe(main);
  });
});

describe('fillClickHandlers', () => {
  let main: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    main = document.createElement('div');
    main.id = 'main';
    document.body.appendChild(main);
  });

  it('sets originalValue on .storylet .button--go', () => {
    const el = createStoryletElement(100, 'storylet');
    const btn = el.querySelector('.button--go') as HTMLButtonElement;

    btn.value = 'Go';
    main.appendChild(el);

    fillClickHandlers();

    expect(btn.dataset.originalValue).toBe('Go');
  });

  it('sets originalValue on .persistent .button--go', () => {
    const el = createStoryletElement(200, 'persistent');
    const btn = el.querySelector('.button--go') as HTMLButtonElement;

    btn.value = 'Go';
    main.appendChild(el);

    fillClickHandlers();

    expect(btn.dataset.originalValue).toBe('Go');
  });
});

describe('mobile long press on toggle button', () => {
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

  it('long press sets avoid in modifier_click mode', () => {
    const el = createStoryletElement(100, 'storylet');

    main.appendChild(el);

    const data = makeFaveData({
      options: { ...makeFaveData().options, switch_mode: 'modifier_click' },
    });

    parseStorylets(data);

    const toggleBtn = main.querySelector('.fave_toggle_button') as HTMLInputElement;

    toggleBtn.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(500);

    expect(data.storylet_avoids.has(100)).toBe(true);
  });

  it('short press sets fave in modifier_click mode', () => {
    const el = createStoryletElement(100, 'storylet');

    main.appendChild(el);

    const data = makeFaveData({
      options: { ...makeFaveData().options, switch_mode: 'modifier_click' },
    });

    parseStorylets(data);

    const toggleBtn = main.querySelector('.fave_toggle_button') as HTMLInputElement;

    toggleBtn.dispatchEvent(new Event('touchstart'));
    toggleBtn.dispatchEvent(new Event('touchend'));

    expect(data.storylet_faves.has(100)).toBe(true);
  });

  it('does not attach touch handlers in click_through mode', () => {
    const el = createStoryletElement(100, 'storylet');

    main.appendChild(el);

    const data = makeFaveData(); // click_through by default

    parseStorylets(data);

    const toggleBtn = main.querySelector('.fave_toggle_button') as HTMLInputElement;

    toggleBtn.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(500);

    // No state change from touch — only click handler should work
    expect(data.storylet_faves.has(100)).toBe(false);
    expect(data.storylet_avoids.has(100)).toBe(false);
  });
});
