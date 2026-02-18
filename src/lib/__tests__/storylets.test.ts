// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseStorylets } from '../storylets';
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
      click_protection: 'off',
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
          click_protection: 'off',
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

  it('click_protection "shift" disables go button on avoided storylets', () => {
    main.appendChild(createStoryletElement(100, 'storylet'));

    parseStorylets(
      makeFaveData({
        storylet_avoids: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'shift',
        },
      }),
    );

    const goButton = main.querySelector('.button--go')!;

    expect(goButton.classList.contains('pf-disabled')).toBe(true);
    expect(goButton.classList.contains('button--disabled')).toBe(true);
    expect(goButton.classList.contains('pf-confirm')).toBe(false);
  });

  it('click_protection "confirm" adds pf-confirm without pf-disabled', () => {
    main.appendChild(createStoryletElement(100, 'storylet'));

    parseStorylets(
      makeFaveData({
        storylet_avoids: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'confirm',
        },
      }),
    );

    const goButton = main.querySelector('.button--go')!;

    expect(goButton.classList.contains('pf-confirm')).toBe(true);
    expect(goButton.classList.contains('pf-disabled')).toBe(false);
    expect(goButton.classList.contains('button--disabled')).toBe(false);
  });

  it('click_protection "off" does not add protection classes', () => {
    main.appendChild(createStoryletElement(100, 'storylet'));

    parseStorylets(
      makeFaveData({
        storylet_avoids: new Set([100]),
        options: {
          branch_reorder_mode: 'branch_no_reorder',
          switch_mode: 'click_through',
          click_protection: 'off',
        },
      }),
    );

    const goButton = main.querySelector('.button--go')!;

    expect(goButton.classList.contains('pf-disabled')).toBe(false);
    expect(goButton.classList.contains('button--disabled')).toBe(false);
    expect(goButton.classList.contains('pf-confirm')).toBe(false);
  });

  it('moves faved storylets before neutral ones', () => {
    const s1 = createStoryletElement(100, 'storylet');
    const s2 = createStoryletElement(101, 'storylet');
    const s3 = createStoryletElement(102, 'storylet');

    main.appendChild(s1);
    main.appendChild(s2);
    main.appendChild(s3);

    parseStorylets(
      makeFaveData({
        storylet_faves: new Set([102]),
        options: {
          branch_reorder_mode: 'branch_reorder_active',
          switch_mode: 'click_through',
          click_protection: 'off',
        },
      }),
      true,
    );

    const storylets = main.querySelectorAll('.storylet');

    expect(storylets[0].getAttribute('data-branch-id')).toBe('102');
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

  function fakeTouchEvent(type: string, x = 0, y = 0): Event {
    const event = new Event(type, { bubbles: true });

    Object.defineProperty(event, 'touches', {
      value: [{ clientX: x, clientY: y }],
    });

    return event;
  }

  it('long press sets avoid in modifier_click mode', () => {
    const el = createStoryletElement(100, 'storylet');

    main.appendChild(el);

    const data = makeFaveData({
      options: { ...makeFaveData().options, switch_mode: 'modifier_click' },
    });

    parseStorylets(data);

    const toggleBtn = main.querySelector('.fave_toggle_button') as HTMLInputElement;

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart'));
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

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart'));
    toggleBtn.dispatchEvent(fakeTouchEvent('touchend'));

    expect(data.storylet_faves.has(100)).toBe(true);
  });

  it('does not attach touch handlers in click_through mode', () => {
    const el = createStoryletElement(100, 'storylet');

    main.appendChild(el);

    const data = makeFaveData(); // click_through by default

    parseStorylets(data);

    const toggleBtn = main.querySelector('.fave_toggle_button') as HTMLInputElement;

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart'));
    vi.advanceTimersByTime(500);

    // No state change from touch — only click handler should work
    expect(data.storylet_faves.has(100)).toBe(false);
    expect(data.storylet_avoids.has(100)).toBe(false);
  });

  it('touchmove beyond threshold cancels long press', () => {
    const el = createStoryletElement(100, 'storylet');

    main.appendChild(el);

    const data = makeFaveData({
      options: { ...makeFaveData().options, switch_mode: 'modifier_click' },
    });

    parseStorylets(data);

    const toggleBtn = main.querySelector('.fave_toggle_button') as HTMLInputElement;

    toggleBtn.dispatchEvent(fakeTouchEvent('touchstart', 0, 0));
    toggleBtn.dispatchEvent(fakeTouchEvent('touchmove', 20, 0));
    vi.advanceTimersByTime(500);

    expect(data.storylet_faves.has(100)).toBe(false);
    expect(data.storylet_avoids.has(100)).toBe(false);
  });
});
