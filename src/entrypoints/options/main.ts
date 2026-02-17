import { getOption, setOption } from '@/lib/storage';
import { DEFAULT_OPTIONS, type DefaultStorageOptions } from '@/types';
import { isMobile } from '@/lib/platform';

document.addEventListener('DOMContentLoaded', async () => {
  const radios = document.querySelectorAll<HTMLInputElement>('input[type=radio]');

  for (const radio of radios) {
    const key = radio.name as keyof DefaultStorageOptions;
    const value = await getOption(key);

    // Compare as strings to handle both string and boolean storage values
    radio.checked = String(value) === radio.value;
  }

  for (const radio of radios) {
    radio.addEventListener('change', async () => {
      if (radio.checked) {
        const key = radio.name as keyof DefaultStorageOptions;
        const defaultValue = DEFAULT_OPTIONS[key];
        const newValue = typeof defaultValue === 'boolean' ? radio.value === 'true' : radio.value;

        await setOption(key, newValue as DefaultStorageOptions[typeof key]);
      }
    });
  }

  const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type=checkbox]');

  for (const checkbox of checkboxes) {
    const key = checkbox.value as keyof DefaultStorageOptions;
    const checked = await getOption(key);

    checkbox.checked = Boolean(checked);
  }

  for (const checkbox of checkboxes) {
    checkbox.addEventListener('change', async () => {
      const key = checkbox.value as keyof DefaultStorageOptions;

      await setOption(key, checkbox.checked as unknown as DefaultStorageOptions[typeof key]);
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
});
