import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  DATA_KEYS,
  DEFAULT_OPTIONS,
  STORAGE_SCHEMA_VERSION,
  type ExportFile,
  type ImportResult,
  type Options,
  type BranchReorderMode,
  type SwitchMode,
} from '@/types';
import { packSet, unpackSet, parseClickProtection } from './storage';
import { migrateData, detectVersion } from './migration';

const VALID_REORDER_MODES: BranchReorderMode[] = [
  'branch_no_reorder',
  'branch_reorder_active',
  'branch_reorder_all',
];
const VALID_SWITCH_MODES: SwitchMode[] = ['click_through', 'modifier_click'];

function sanitizeOptions(raw: Record<string, unknown>): Options {
  let clickProtection = parseClickProtection(raw.click_protection);

  if (clickProtection === 'off' && 'block_action' in raw && !('click_protection' in raw)) {
    clickProtection = raw.block_action === true ? 'shift' : 'off';
  }

  return {
    branch_reorder_mode: VALID_REORDER_MODES.includes(raw.branch_reorder_mode as BranchReorderMode)
      ? (raw.branch_reorder_mode as BranchReorderMode)
      : DEFAULT_OPTIONS.branch_reorder_mode,
    switch_mode: VALID_SWITCH_MODES.includes(raw.switch_mode as SwitchMode)
      ? (raw.switch_mode as SwitchMode)
      : DEFAULT_OPTIONS.switch_mode,
    click_protection: clickProtection,
  };
}

export function convertRawDump(raw: Record<string, unknown>): ExportFile {
  const migrated = migrateData(raw);

  const data = Object.fromEntries(
    DATA_KEYS.map((key) => {
      const set = unpackSet(migrated, key);

      return [key, Array.from(set).sort((a, b) => a - b)];
    }),
  ) as unknown as ExportFile['data'];

  const options = sanitizeOptions(migrated);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    data,
    options,
  };
}

export async function exportData(): Promise<ExportFile> {
  const raw = await browser.storage.local.get(null);

  const data = Object.fromEntries(
    DATA_KEYS.map((key) => {
      const set = unpackSet(raw, key);

      return [key, Array.from(set).sort((a, b) => a - b)];
    }),
  ) as unknown as ExportFile['data'];

  const options: Options = {
    branch_reorder_mode:
      (raw.branch_reorder_mode as BranchReorderMode) ?? DEFAULT_OPTIONS.branch_reorder_mode,
    switch_mode: (raw.switch_mode as SwitchMode) ?? DEFAULT_OPTIONS.switch_mode,
    click_protection: parseClickProtection(raw.click_protection),
  };

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    data,
    options,
  };
}

export async function importData(file: ExportFile): Promise<void> {
  const storageData: Record<string, unknown> = {
    storage_schema: STORAGE_SCHEMA_VERSION,
    branch_reorder_mode: file.options.branch_reorder_mode,
    switch_mode: file.options.switch_mode,
    click_protection: file.options.click_protection,
  };

  for (const key of DATA_KEYS) {
    Object.assign(storageData, packSet(new Set(file.data[key]), key));
  }

  await browser.storage.local.clear();
  await browser.storage.local.set(storageData);
}

export function validateImport(raw: unknown): ImportResult {
  if (raw === null || typeof raw !== 'object') {
    return { valid: false, error: 'Invalid file format' };
  }

  const obj = raw as Record<string, unknown>;

  // Native ExportFile format — existing validation path
  if (obj.format === EXPORT_FORMAT) {
    if (typeof obj.version !== 'number') {
      return { valid: false, error: 'Invalid file format' };
    }

    if (obj.version > EXPORT_VERSION) {
      return {
        valid: false,
        error: 'This file was created by a newer version. Please update the extension',
      };
    }

    if (obj.data === null || typeof obj.data !== 'object') {
      return { valid: false, error: 'File data is corrupted' };
    }

    const data = obj.data as Record<string, unknown>;

    for (const key of DATA_KEYS) {
      const arr = data[key];

      if (!Array.isArray(arr)) {
        return { valid: false, error: 'File data is corrupted' };
      }

      if (!arr.every((v) => typeof v === 'number')) {
        return { valid: false, error: 'File data is corrupted' };
      }
    }

    const options = sanitizeOptions(
      typeof obj.options === 'object' && obj.options !== null
        ? (obj.options as Record<string, unknown>)
        : {},
    );

    return {
      valid: true,
      data: {
        format: EXPORT_FORMAT,
        version: obj.version,
        exported_at: typeof obj.exported_at === 'string' ? obj.exported_at : '',
        data: Object.fromEntries(
          DATA_KEYS.map((k) => [k, data[k] as number[]]),
        ) as unknown as ExportFile['data'],
        options,
      },
    };
  }

  // Wrong format marker — not our file
  if ('format' in obj) {
    return { valid: false, error: 'Not a Fallen London Favourites export file' };
  }

  // No format field — try as raw storage dump
  const version = detectVersion(obj);

  if (version >= STORAGE_SCHEMA_VERSION) {
    // detectVersion returns STORAGE_SCHEMA_VERSION for empty/unrecognized data
    return { valid: false, error: 'Unrecognized file format' };
  }

  try {
    const converted = convertRawDump(obj);

    return { valid: true, data: converted };
  } catch {
    return { valid: false, error: 'Unrecognized file format' };
  }
}
