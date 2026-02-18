import { getOption, setOption } from '@/lib/storage';
import { DEFAULT_OPTIONS, type DefaultStorageOptions, type ExportFile } from '@/types';
import { isMobile } from '@/lib/platform';
import { exportData, validateImport, importData } from '@/lib/io';

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

  // --- Import/Export ---

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile') as HTMLInputElement | null;
  const importPreview = document.getElementById('importPreview');
  const importError = document.getElementById('importError');
  const confirmImportBtn = document.getElementById('confirmImportBtn');
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

  function showPreview(data: ExportFile): void {
    hideImportUI();
    pendingImport = data;

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

    showPreview(result.data);
  });

  confirmImportBtn?.addEventListener('click', async () => {
    if (!pendingImport) {
      return;
    }

    try {
      await importData(pendingImport);
      location.reload();
    } catch {
      showError('Import failed. Please try again.');
    }
  });

  cancelImportBtn?.addEventListener('click', hideImportUI);
});
