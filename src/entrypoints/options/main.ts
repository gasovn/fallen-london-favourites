import { getOption, setOption } from '@/lib/storage';
import { type DefaultStorageOptions, type ExportFile } from '@/types';
import { isMobile } from '@/lib/platform';
import { exportData, validateImport, importData, SyncQuotaExceededError } from '@/lib/io';
import {
  enableMultiProfile,
  disableMultiProfile,
  deleteProfile,
  listProfilesWithNames,
} from '@/lib/multi-profile';
import { setDeviceFlag, SYNC_FULL_FLAG, JWT_DEGRADED_FLAG, WHATS_NEW_FLAG } from '@/lib/flags';
import { SHOW_WHATS_NEW } from '@/lib/badge';

document.addEventListener('DOMContentLoaded', async () => {
  const radios = document.querySelectorAll<HTMLInputElement>('input[type=radio]');

  for (const radio of radios) {
    const key = radio.name as keyof DefaultStorageOptions;
    const value = await getOption(key);

    radio.checked = String(value) === radio.value;
  }

  for (const radio of radios) {
    radio.addEventListener('change', async () => {
      if (radio.checked) {
        const key = radio.name as keyof DefaultStorageOptions;
        const newValue = radio.value;

        await setOption(key, newValue as DefaultStorageOptions[typeof key]);
      }
    });
  }

  if (isMobile()) {
    const mobileElements = document.querySelectorAll<HTMLElement>('[data-mobile-text]');

    for (const el of mobileElements) {
      const mobileText = el.dataset.mobileText ?? '';

      el.textContent = mobileText;
    }
  }

  const changelogUrl = browser.runtime.getURL('/changelog.txt');

  try {
    const response = await fetch(changelogUrl);
    const text = await response.text();
    const changelogText = document.getElementById('changelogText');

    if (changelogText) {
      changelogText.textContent = text;
    }
  } catch {
    // Silently ignore changelog load failures
  }

  const versionEl = document.getElementById('extensionVersion');

  if (versionEl) {
    versionEl.textContent = `v${browser.runtime.getManifest().version}`;
  }

  const reviewLink = document.getElementById('reviewLink');

  if (reviewLink) {
    const isFirefox = browser.runtime.getURL('').startsWith('moz-extension://');

    reviewLink.setAttribute(
      'href',
      isFirefox
        ? 'https://addons.mozilla.org/firefox/addon/fallen-london-favourites/reviews/'
        : 'https://chromewebstore.google.com/detail/fallen-london-favourites/jkaoljkdjoecocmlnncdljoeeijlcjao/reviews',
    );
  }

  // --- Import/Export ---

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile') as HTMLInputElement | null;
  const importPreview = document.getElementById('importPreview');
  const importError = document.getElementById('importError');
  const confirmImportBtn = document.getElementById('confirmImportBtn');
  const importTurnOnRow = document.getElementById('importTurnOnRow');
  const importTurnOn = document.getElementById('importTurnOn') as HTMLInputElement | null;
  const cancelImportBtn = document.getElementById('cancelImportBtn');

  let pendingImport: ExportFile | null = null;

  function hideImportUI(): void {
    if (importPreview) {
      importPreview.hidden = true;
    }

    if (importError) {
      importError.hidden = true;
    }

    pendingImport = null;
  }

  function showError(message: string): void {
    hideImportUI();

    if (importError) {
      importError.textContent = message;
      importError.hidden = false;
    }
  }

  async function showPreview(data: ExportFile): Promise<void> {
    hideImportUI();
    pendingImport = data;

    const off = (await getOption('multi_toggle')) !== true;
    const hasProfiles = Object.keys(data.profiles ?? {}).length > 0;

    if (importTurnOnRow && importTurnOn) {
      importTurnOn.checked = false;
      importTurnOnRow.hidden = !(off && hasProfiles);
    }

    const date = data.exported_at ? new Date(data.exported_at).toLocaleDateString() : 'Unknown';

    const setPreviewText = (id: string, text: string) => {
      const el = document.getElementById(id);

      if (el) {
        el.textContent = text;
      }
    };

    setPreviewText('previewDate', date);
    setPreviewText('previewBranchFaves', String(data.data.branch_faves.length));
    setPreviewText('previewBranchAvoids', String(data.data.branch_avoids.length));
    setPreviewText('previewStoryletFaves', String(data.data.storylet_faves.length));
    setPreviewText('previewStoryletAvoids', String(data.data.storylet_avoids.length));
    setPreviewText('previewCardFaves', String(data.data.card_faves.length));
    setPreviewText('previewCardAvoids', String(data.data.card_avoids.length));
    setPreviewText('previewProfiles', String(Object.keys(data.profiles ?? {}).length));

    if (importPreview) {
      importPreview.hidden = false;
    }
  }

  exportBtn?.addEventListener('click', async () => {
    const data = await exportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');

    a.href = url;
    a.download = `fl-favourites-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importBtn?.addEventListener('click', () => {
    hideImportUI();
    importFile?.click();
  });

  importFile?.addEventListener('change', async () => {
    const file = importFile.files?.[0];

    if (!file) {
      return;
    }

    importFile.value = '';

    let parsed: unknown;

    try {
      const text = await file.text();

      parsed = JSON.parse(text);
    } catch {
      showError('Invalid file format');

      return;
    }

    const result = validateImport(parsed);

    if (!result.valid) {
      showError(result.error);

      return;
    }

    await showPreview(result.data);
  });

  confirmImportBtn?.addEventListener('click', async () => {
    const file = pendingImport;

    if (!file) {
      return;
    }

    // Taken once: a second click must not start another import, which the
    // reload below could cut off half way.
    pendingImport = null;

    try {
      await importData(file, { turnOn: importTurnOn?.checked === true });
      location.reload();
    } catch (error) {
      if (error instanceof SyncQuotaExceededError) {
        showError('This backup is too large for sync storage and cannot be imported.');
      } else {
        showError('Import failed. Please try again.');
      }
    }
  });

  cancelImportBtn?.addEventListener('click', hideImportUI);

  await setupNotices();
  await setupMultiProfile();
  await showWhatsNew();

  // The toolbar button asks an open page first and brings forward the tab that answers.
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: { tabId?: number }) => void) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== SHOW_WHATS_NEW
      ) {
        return false;
      }

      showWhatsNew();
      browser.tabs.getCurrent().then(
        (tab) => sendResponse({ tabId: tab?.id }),
        () => sendResponse({}),
      );

      // Keeps the channel open for the asynchronous answer, in Chrome as well as Firefox.
      return true;
    },
  );
});

function makeNotice(text: string, onDismiss: () => void): HTMLElement {
  const notice = document.createElement('div');

  notice.className = 'notice';

  const message = document.createElement('p');

  message.textContent = text;

  const dismiss = document.createElement('button');

  dismiss.type = 'button';
  dismiss.className = 'notice-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', onDismiss);

  notice.append(message, dismiss);

  return notice;
}

async function setupNotices(): Promise<void> {
  const noticesEl = document.getElementById('notices');

  if (!noticesEl) {
    return;
  }

  const clearFlag = async (flag: string): Promise<void> => {
    await setDeviceFlag(flag, false);
    await render();
  };

  const render = async (): Promise<void> => {
    const flags = await browser.storage.local.get(null);

    noticesEl.replaceChildren();

    if (flags[SYNC_FULL_FLAG] === true) {
      noticesEl.appendChild(
        makeNotice(
          listProfilesWithNames(flags).length > 0
            ? 'Sync storage is full. Delete a character profile below to free space.'
            : 'Sync storage is full. Remove some favourites to free space.',
          () => clearFlag(SYNC_FULL_FLAG),
        ),
      );
    }

    // Only while the feature is on: turned off, the advice no longer applies.
    if (flags[JWT_DEGRADED_FLAG] === true && flags.multi_toggle === true) {
      noticesEl.appendChild(
        makeNotice(
          'Per-character favourites could not read your character — Fallen London may have changed. While it cannot, Fallen London pages show and save no marks; turn the feature off below to go back to one shared list.',
          () => clearFlag(JWT_DEGRADED_FLAG),
        ),
      );
    }
  };

  await render();

  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') {
      render();
    }
  });
}

async function showWhatsNew(): Promise<void> {
  const flags = await browser.storage.local.get([WHATS_NEW_FLAG]);
  const changelog = document.querySelector<HTMLDetailsElement>('.changelog-details');

  if (flags[WHATS_NEW_FLAG] !== true || !changelog) {
    return;
  }

  changelog.open = true;

  // A notice outranks the news: the flag stays until the changelog is shown without one.
  if ((document.getElementById('notices')?.childElementCount ?? 0) > 0) {
    return;
  }

  // A tab restored in the background has not been seen yet.
  if (document.visibilityState !== 'visible') {
    document.addEventListener('visibilitychange', () => showWhatsNew(), { once: true });

    return;
  }

  changelog.scrollIntoView();
  await setDeviceFlag(WHATS_NEW_FLAG, false);
}

async function setupMultiProfile(): Promise<void> {
  const multiToggle = document.getElementById('multiToggle') as HTMLInputElement | null;
  const enabledSection = document.getElementById('multiEnabledSection');
  const enableNote = document.getElementById('enableNote');
  const startEmpty = document.getElementById('startEmpty') as HTMLInputElement | null;
  const profileListEl = document.getElementById('profileList');
  const disablePanel = document.getElementById('disablePanel');
  const survivorPicker = document.getElementById('survivorPicker');
  const confirmDisableBtn = document.getElementById('confirmDisableBtn');
  const cancelDisableBtn = document.getElementById('cancelDisableBtn');
  const multiMessage = document.getElementById('multiMessage');

  if (
    !multiToggle ||
    !enabledSection ||
    !startEmpty ||
    !profileListEl ||
    !disablePanel ||
    !survivorPicker
  ) {
    return;
  }

  const showMessage = (text: string): void => {
    if (multiMessage) {
      multiMessage.textContent = text;
      multiMessage.hidden = false;
    }
  };

  const clearMessage = (): void => {
    if (multiMessage) {
      multiMessage.hidden = true;
    }
  };

  const setEnabledUI = (enabled: boolean): void => {
    multiToggle.checked = enabled;
    enabledSection.hidden = !enabled;

    if (!enabled && enableNote) {
      enableNote.hidden = true;
    }
  };

  let listed = '';

  const renderProfiles = async (): Promise<void> => {
    const data = await browser.storage.local.get(null);
    const profiles = listProfilesWithNames(data);
    const next = JSON.stringify([data.multi_toggle === true, profiles]);

    // Left alone while nothing in it changed: a rebuild would drop a pending
    // "Delete <name>?".
    if (next === listed) {
      return;
    }

    listed = next;
    profileListEl.replaceChildren();

    if (profiles.length === 0) {
      return;
    }

    const heading = document.createElement('p');

    heading.className = 'option-hint';
    heading.textContent =
      data.multi_toggle === true
        ? 'Saved character profiles'
        : 'Saved character profiles — not in use while this is off';
    profileListEl.appendChild(heading);

    for (const { charId, name } of profiles) {
      const row = document.createElement('div');

      row.className = 'profile-row';

      const label = document.createElement('span');

      label.textContent = name;

      const remove = document.createElement('button');

      remove.type = 'button';
      remove.className = 'data-btn data-btn--danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        const confirm = document.createElement('button');

        confirm.type = 'button';
        confirm.className = 'data-btn data-btn--danger';
        confirm.textContent = `Delete ${name}?`;
        confirm.addEventListener('click', async () => {
          await deleteProfile(charId);
          await renderProfiles();
        });

        // Cancel lands where Delete was, so a double click deletes nothing.
        const cancel = document.createElement('button');
        const actions = document.createElement('div');

        cancel.type = 'button';
        cancel.className = 'data-btn';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => actions.replaceWith(remove));

        actions.className = 'profile-row-actions';
        actions.append(confirm, cancel);
        remove.replaceWith(actions);
      });

      row.append(label, remove);
      profileListEl.appendChild(row);
    }
  };

  const shownSurvivors = (): HTMLInputElement[] =>
    Array.from(survivorPicker.querySelectorAll<HTMLInputElement>('input[name="survivor"]'));

  // Keeps the current choice when it is rebuilt after a refused turn-off.
  const renderSurvivorPicker = async (): Promise<number> => {
    const data = await browser.storage.local.get(null);
    const profiles = listProfilesWithNames(data);
    const chosen = shownSurvivors().find((radio) => radio.checked)?.value;
    const keep = profiles.some(({ charId }) => charId === chosen);

    survivorPicker.replaceChildren();

    const legend = document.createElement('legend');

    legend.textContent = "Use this character's favourites as your shared list:";
    survivorPicker.appendChild(legend);

    profiles.forEach(({ charId, name }, index) => {
      const wrap = document.createElement('label');

      wrap.className = 'option';

      const radio = document.createElement('input');

      radio.type = 'radio';
      radio.name = 'survivor';
      radio.value = charId;
      radio.checked = keep ? charId === chosen : index === 0;

      const content = document.createElement('span');

      content.className = 'option-content';

      const labelText = document.createElement('span');

      labelText.className = 'option-label';
      labelText.textContent = name;
      content.appendChild(labelText);

      wrap.append(radio, content);
      survivorPicker.appendChild(wrap);
    });

    return profiles.length;
  };

  const openDisablePanel = async (): Promise<void> => {
    if ((await renderSurvivorPicker()) === 0) {
      if ((await disableMultiProfile(null, [])).status === 'disabled') {
        disablePanel.hidden = true;
        setEnabledUI(false);

        return;
      }

      await renderSurvivorPicker();
    }

    disablePanel.hidden = false;
  };

  multiToggle.addEventListener('change', async () => {
    clearMessage();

    if (multiToggle.checked) {
      await enableMultiProfile();
      setEnabledUI(true);

      if (enableNote) {
        enableNote.hidden = false;
      }

      await renderProfiles();
    } else {
      // Stays checked until the turn-off is confirmed.
      multiToggle.checked = true;
      await openDisablePanel();
    }
  });

  startEmpty.addEventListener('change', async () => {
    await setOption('start_empty', startEmpty.checked);
  });

  confirmDisableBtn?.addEventListener('click', async () => {
    const shown = shownSurvivors();
    const selected = shown.find((radio) => radio.checked);
    const result = await disableMultiProfile(
      selected ? selected.value : null,
      shown.map((radio) => radio.value),
    );

    if (result.status === 'incomplete') {
      showMessage('Still syncing this character — try again in a moment.');

      return;
    }

    if (result.status === 'no-survivor' || result.status === 'changed') {
      await renderSurvivorPicker();
      showMessage('The list of characters changed — check your choice.');

      return;
    }

    disablePanel.hidden = true;
    clearMessage();
    setEnabledUI(false);
  });

  cancelDisableBtn?.addEventListener('click', () => {
    disablePanel.hidden = true;
    clearMessage();
  });

  const enabled = (await getOption('multi_toggle')) === true;

  startEmpty.checked = (await getOption('start_empty')) === true;
  setEnabledUI(enabled);

  await renderProfiles();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      // Fires for this page's own writes too, and for pulls from other devices.
      // Firefox also reports keys written with the value they already had.
      const changed = (key: string): boolean =>
        key in changes && changes[key].oldValue !== changes[key].newValue;

      if (changed('multi_toggle')) {
        disablePanel.hidden = true;
        clearMessage();
        setEnabledUI(changes.multi_toggle.newValue === true);
      }

      if (changed('start_empty')) {
        startEmpty.checked = changes.start_empty.newValue === true;
      }

      renderProfiles();
    }
  });
}
