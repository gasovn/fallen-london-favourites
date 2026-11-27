import { JWT_DEGRADED_FLAG, SYNC_FULL_FLAG, WHATS_NEW_FLAG, setDeviceFlag } from '@/lib/flags';

const NAME = 'Fallen London Favourites';

interface Badge {
  text: string;
  title: string;
  colors?: { background: string; text: string };
}

// Options page colours: the danger button red, the accent gold, the page background for text.
const PROBLEM_COLORS = { background: '#991b1b', text: '#ffffff' };
const NEWS_COLORS = { background: '#d4a843', text: '#1c1917' };

export const SHOW_WHATS_NEW = 'show-whats-new';

/** Keys whose change can alter the badge. */
export const BADGE_KEYS = [
  SYNC_FULL_FLAG,
  JWT_DEGRADED_FLAG,
  WHATS_NEW_FLAG,
  'multi_toggle',
] as const;

function majorMinor(version: string): [number, number] {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);

  return [major, minor];
}

/** A new feature raises the middle number of the version; a fix raises the last one. */
export function isFeatureUpdate(previous: string, current: string): boolean {
  const [prevMajor, prevMinor] = majorMinor(previous);
  const [major, minor] = majorMinor(current);

  return major > prevMajor || (major === prevMajor && minor > prevMinor);
}

export function computeBadge(data: Record<string, unknown>, version: string): Badge {
  const syncFull = data[SYNC_FULL_FLAG] === true;
  // Same condition as the notice on the options page.
  const characterUnread = data[JWT_DEGRADED_FLAG] === true && data.multi_toggle === true;
  const whatsNew = data[WHATS_NEW_FLAG] === true;
  const lines: string[] = [];

  if (syncFull) {
    lines.push('Sync storage is full: changes are not syncing to other devices. Click for details');
  }

  if (characterUnread) {
    lines.push('Could not read your Fallen London character: marks are paused. Click for details');
  }

  if (whatsNew) {
    lines.push(`Updated to ${version}. Click to see what's new`);
  }

  const title = [NAME, ...lines].join('\n');

  if (syncFull || characterUnread) {
    return { text: '!', title, colors: PROBLEM_COLORS };
  }

  if (whatsNew) {
    return { text: '●', title, colors: NEWS_COLORS };
  }

  return { text: '', title };
}

export async function noteUpdate(previous: string | undefined, current: string): Promise<void> {
  if (previous !== undefined && isFeatureUpdate(previous, current)) {
    await setDeviceFlag(WHATS_NEW_FLAG, true);
  }
}

// Firefox builds are MV2: the same promise-based methods live under browserAction.
export function actionApi(): typeof browser.action {
  return browser.action ?? (browser.browserAction as unknown as typeof browser.action);
}

function tabIdOf(response: unknown): number | undefined {
  return typeof response === 'object' &&
    response !== null &&
    'tabId' in response &&
    typeof response.tabId === 'number'
    ? response.tabId
    : undefined;
}

async function focusOpenPage(): Promise<boolean> {
  try {
    const tabId = tabIdOf(await browser.runtime.sendMessage({ type: SHOW_WHATS_NEW }));

    if (tabId === undefined) {
      return false;
    }

    const tab = await browser.tabs.update(tabId, { active: true });

    // Firefox for Android has no windows API.
    if (browser.windows && tab?.windowId !== undefined) {
      await attempt(async () => {
        await browser.windows.update(tab.windowId, { focused: true });
      });
    }

    return true;
  } catch {
    // No page listening, or its tab closed meanwhile.
    return false;
  }
}

// openOptionsPage() opens a second tab on Firefox for Android, so an open page is brought
// forward by its own tab id.
export async function openOptions(): Promise<void> {
  if (!(await focusOpenPage())) {
    await browser.runtime.openOptionsPage();
  }
}

async function attempt(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch {
    // Not every method exists on every platform.
  }
}

async function renderBadge(): Promise<void> {
  const action = actionApi();
  const data = await browser.storage.local.get(null);
  const badge = computeBadge(data, browser.runtime.getManifest().version);
  const { colors } = badge;

  if (colors) {
    await attempt(() => action.setBadgeBackgroundColor({ color: colors.background }));
    await attempt(() => action.setBadgeTextColor({ color: colors.text }));
  }

  await action.setBadgeText({ text: badge.text });
  await action.setTitle({ title: badge.title });
}

let lastRender: Promise<void> = Promise.resolve();

/** Renders are queued: one that read an older state can never finish after a newer one. */
export function applyBadge(): Promise<void> {
  lastRender = lastRender
    .then(renderBadge)
    .catch((error) => console.error('Badge update failed:', error));

  return lastRender;
}
