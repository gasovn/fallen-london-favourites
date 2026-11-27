import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import { SYNC_FULL_FLAG, JWT_DEGRADED_FLAG, WHATS_NEW_FLAG } from '../flags';
import {
  isFeatureUpdate,
  computeBadge,
  noteUpdate,
  applyBadge,
  openOptions,
  BADGE_KEYS,
} from '../badge';

describe('isFeatureUpdate', () => {
  it.each([
    ['0.8.0', '0.9.0', true],
    ['0.8.3', '0.9.0', true],
    ['0.7.3', '0.9.1', true],
    ['0.9.0', '0.10.0', true],
    ['0.9.4', '1.0.0', true],
    ['0.8.0', '0.8.1', false],
    ['0.9.0', '0.9.0', false],
    ['0.9.1', '0.8.5', false],
    ['1.0.0', '0.9.0', false],
    ['1.2.0', '2.0.0', true],
  ])('%s -> %s: %s', (previous, current, expected) => {
    expect(isFeatureUpdate(previous, current)).toBe(expected);
  });
});

const NAME = 'Fallen London Favourites';
const SYNC_LINE =
  'Sync storage is full: changes are not syncing to other devices. Click for details';
const CHARACTER_LINE =
  'Could not read your Fallen London character: marks are paused. Click for details';
const NEWS_LINE = "Updated to 0.9.0. Click to see what's new";
const RED = { background: '#991b1b', text: '#ffffff' };
const GOLD = { background: '#d4a843', text: '#1c1917' };

describe('computeBadge', () => {
  it('shows no badge and the plain name when nothing is wrong', () => {
    expect(computeBadge({}, '0.9.0')).toEqual({ text: '', title: NAME });
  });

  it('shows a gold dot after a feature update', () => {
    expect(computeBadge({ [WHATS_NEW_FLAG]: true }, '0.9.0')).toEqual({
      text: '●',
      title: `${NAME}\n${NEWS_LINE}`,
      colors: GOLD,
    });
  });

  it('shows ! in red when sync storage is full', () => {
    expect(computeBadge({ [SYNC_FULL_FLAG]: true }, '0.9.0')).toEqual({
      text: '!',
      title: `${NAME}\n${SYNC_LINE}`,
      colors: RED,
    });
  });

  it('shows ! when the character cannot be read with per-character favourites on', () => {
    expect(computeBadge({ [JWT_DEGRADED_FLAG]: true, multi_toggle: true }, '0.9.0')).toEqual({
      text: '!',
      title: `${NAME}\n${CHARACTER_LINE}`,
      colors: RED,
    });
  });

  it('ignores an unread character while per-character favourites are off', () => {
    expect(computeBadge({ [JWT_DEGRADED_FLAG]: true }, '0.9.0')).toEqual({ text: '', title: NAME });
    expect(computeBadge({ [JWT_DEGRADED_FLAG]: true, multi_toggle: false }, '0.9.0')).toEqual({
      text: '',
      title: NAME,
    });
  });

  it('puts a problem above the news but keeps both in the tooltip', () => {
    expect(computeBadge({ [SYNC_FULL_FLAG]: true, [WHATS_NEW_FLAG]: true }, '0.9.0')).toEqual({
      text: '!',
      title: `${NAME}\n${SYNC_LINE}\n${NEWS_LINE}`,
      colors: RED,
    });
  });

  it('lists every signal, one per line', () => {
    const data = {
      [SYNC_FULL_FLAG]: true,
      [JWT_DEGRADED_FLAG]: true,
      multi_toggle: true,
      [WHATS_NEW_FLAG]: true,
    };

    expect(computeBadge(data, '0.9.0').title).toBe(
      `${NAME}\n${SYNC_LINE}\n${CHARACTER_LINE}\n${NEWS_LINE}`,
    );
  });

  it('names the running version in the news', () => {
    expect(computeBadge({ [WHATS_NEW_FLAG]: true }, '1.2.0').title).toBe(
      `${NAME}\nUpdated to 1.2.0. Click to see what's new`,
    );
  });
});

describe('noteUpdate', () => {
  let mock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mock = createMockStorage();
    vi.stubGlobal('browser', { storage: { local: mock } });
  });

  it('raises the flag on a feature update', async () => {
    await noteUpdate('0.8.0', '0.9.0');

    expect(mock._getData()[WHATS_NEW_FLAG]).toBe(true);
  });

  it('leaves the flag alone on a fix, a reload of the same version and a rollback', async () => {
    await noteUpdate('0.9.0', '0.9.1');
    await noteUpdate('0.9.1', '0.9.1');
    await noteUpdate('0.9.1', '0.8.5');

    expect(mock._getData()).not.toHaveProperty(WHATS_NEW_FLAG);
  });

  it('leaves the flag alone when the previous version is unknown', async () => {
    await noteUpdate(undefined, '0.9.0');

    expect(mock._getData()).not.toHaveProperty(WHATS_NEW_FLAG);
  });
});

describe('applyBadge', () => {
  function fakeAction() {
    return {
      setBadgeText: vi.fn(async (_details: { text: string }) => {}),
      setBadgeBackgroundColor: vi.fn(async (_details: { color: string }) => {}),
      setBadgeTextColor: vi.fn(async (_details: { color: string }) => {}),
      setTitle: vi.fn(async (_details: { title: string }) => {}),
    };
  }

  let action: ReturnType<typeof fakeAction>;

  function stub(data: Record<string, unknown>, api: 'action' | 'browserAction' = 'action') {
    const storage = createMockStorage(data);

    action = fakeAction();
    vi.stubGlobal('browser', {
      storage: { local: storage },
      runtime: { getManifest: () => ({ version: '0.9.0' }) },
      [api]: action,
    });

    return storage;
  }

  it('sets text, colours and tooltip of the news', async () => {
    stub({ [WHATS_NEW_FLAG]: true });

    await applyBadge();

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '●' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: GOLD.background });
    expect(action.setBadgeTextColor).toHaveBeenCalledWith({ color: GOLD.text });
    expect(action.setTitle).toHaveBeenCalledWith({ title: `${NAME}\n${NEWS_LINE}` });
  });

  it('clears the text and restores the name when there is no signal', async () => {
    stub({});

    await applyBadge();

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(action.setBadgeBackgroundColor).not.toHaveBeenCalled();
    expect(action.setTitle).toHaveBeenCalledWith({ title: NAME });
  });

  it('uses browserAction where action does not exist (Firefox, MV2)', async () => {
    stub({ [SYNC_FULL_FLAG]: true }, 'browserAction');

    await applyBadge();

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
  });

  it('still sets the tooltip when a colour call is missing', async () => {
    stub({ [WHATS_NEW_FLAG]: true });
    (action as Partial<ReturnType<typeof fakeAction>>).setBadgeTextColor = undefined;

    await applyBadge();

    expect(action.setTitle).toHaveBeenCalledWith({ title: `${NAME}\n${NEWS_LINE}` });
  });

  it('still sets the tooltip when a colour call is rejected', async () => {
    stub({ [WHATS_NEW_FLAG]: true });
    action.setBadgeBackgroundColor.mockRejectedValueOnce(new Error('unsupported'));

    await applyBadge();

    expect(action.setTitle).toHaveBeenCalledWith({ title: `${NAME}\n${NEWS_LINE}` });
  });

  it('keeps rendering after a failed render', async () => {
    const storage = stub({ [WHATS_NEW_FLAG]: true });
    const realGet = storage.get.bind(storage);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    storage.get = vi
      .fn<typeof realGet>()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockImplementation(realGet);

    await applyBadge();
    await applyBadge();

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '●' });
    errorSpy.mockRestore();
  });

  it('applies overlapping calls in order, so the last state wins', async () => {
    const storage = stub({ [WHATS_NEW_FLAG]: true });
    const realGet = storage.get.bind(storage);

    let release: () => void = () => {};

    let markBlocked: () => void = () => {};

    const blocked = new Promise<void>((res) => {
      markBlocked = res;
    });

    storage.get = vi.fn(async (keys: Parameters<typeof realGet>[0]) => {
      const snapshot = await realGet(keys);

      if (snapshot[WHATS_NEW_FLAG] === true) {
        markBlocked();
        await new Promise<void>((res) => {
          release = res;
        });
      }

      return snapshot;
    });

    const first = applyBadge();

    await blocked;
    await storage.remove(WHATS_NEW_FLAG);

    const second = applyBadge();

    await new Promise((res) => setTimeout(res, 0));
    release();
    await Promise.all([first, second]);

    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});

describe('openOptions', () => {
  interface Stub {
    answer?: () => Promise<unknown>;
    update?: () => Promise<{ windowId?: number } | undefined>;
    open?: () => Promise<void>;
    windows?: boolean;
  }

  function stub({ answer, update, open, windows = true }: Stub) {
    const sendMessage = vi.fn(async (_message: unknown) => answer?.());
    const tabsUpdate = vi.fn(
      async (_tabId: number, _props: { active: boolean }) => (await update?.()) ?? { windowId: 7 },
    );
    const openOptionsPage = vi.fn(async () => open?.());
    const windowsUpdate = vi.fn(async (_windowId: number, _info: { focused: boolean }) => {});

    vi.stubGlobal('browser', {
      runtime: { openOptionsPage, sendMessage },
      tabs: { update: tabsUpdate },
      ...(windows ? { windows: { update: windowsUpdate } } : {}),
    });

    return { sendMessage, tabsUpdate, openOptionsPage, windowsUpdate };
  }

  function expectOpenedAfterAsking(
    sendMessage: ReturnType<typeof vi.fn>,
    openOptionsPage: ReturnType<typeof vi.fn>,
  ) {
    expect(openOptionsPage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      openOptionsPage.mock.invocationCallOrder[0],
    );
  }

  it('brings an open page forward instead of opening another one', async () => {
    const { sendMessage, tabsUpdate, openOptionsPage, windowsUpdate } = stub({
      answer: async () => ({ tabId: 42 }),
    });

    await openOptions();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'show-whats-new' });
    expect(tabsUpdate).toHaveBeenCalledWith(42, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(7, { focused: true });
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it('brings the page forward where there are no windows (Firefox for Android)', async () => {
    const { tabsUpdate, openOptionsPage } = stub({
      answer: async () => ({ tabId: 42 }),
      windows: false,
    });

    await expect(openOptions()).resolves.toBeUndefined();
    expect(tabsUpdate).toHaveBeenCalledWith(42, { active: true });
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it('keeps the page in front when its window cannot be focused', async () => {
    const { windowsUpdate, openOptionsPage } = stub({ answer: async () => ({ tabId: 42 }) });

    windowsUpdate.mockRejectedValueOnce(new Error('no window'));

    await expect(openOptions()).resolves.toBeUndefined();
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it('opens the options page when no page is listening', async () => {
    const { sendMessage, tabsUpdate, openOptionsPage } = stub({
      answer: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    });

    await openOptions();

    expect(tabsUpdate).not.toHaveBeenCalled();
    expectOpenedAfterAsking(sendMessage, openOptionsPage);
  });

  it.each([undefined, {}, { tabId: '42' }, 'ok'])(
    'opens the options page when the answer has no tab id: %j',
    async (response) => {
      const { sendMessage, tabsUpdate, openOptionsPage } = stub({ answer: async () => response });

      await openOptions();

      expect(tabsUpdate).not.toHaveBeenCalled();
      expectOpenedAfterAsking(sendMessage, openOptionsPage);
    },
  );

  it('opens the options page when the answering tab is gone', async () => {
    const { tabsUpdate, openOptionsPage } = stub({
      answer: async () => ({ tabId: 42 }),
      update: async () => {
        throw new Error('Invalid tab ID: 42');
      },
    });

    await openOptions();

    expect(tabsUpdate).toHaveBeenCalledWith(42, { active: true });
    expect(openOptionsPage).toHaveBeenCalledOnce();
    expect(tabsUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      openOptionsPage.mock.invocationCallOrder[0],
    );
  });

  it('rejects when the page cannot be opened', async () => {
    stub({
      open: async () => {
        throw new Error('no options page');
      },
    });

    await expect(openOptions()).rejects.toThrow('no options page');
  });
});

describe('BADGE_KEYS', () => {
  it('lists every key the badge reads', () => {
    expect([...BADGE_KEYS].sort()).toEqual(
      [JWT_DEGRADED_FLAG, SYNC_FULL_FLAG, WHATS_NEW_FLAG, 'multi_toggle'].sort(),
    );
  });
});
