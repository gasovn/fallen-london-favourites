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
import { packSet, unpackSet } from './storage';

const VALID_REORDER_MODES: BranchReorderMode[] = [
  'branch_no_reorder',
  'branch_reorder_active',
  'branch_reorder_all',
];
const VALID_SWITCH_MODES: SwitchMode[] = ['click_through', 'modifier_click'];

function sanitizeOptions(raw: Record<string, unknown>): Options {
  return {
    branch_reorder_mode: VALID_REORDER_MODES.includes(raw.branch_reorder_mode as BranchReorderMode)
      ? (raw.branch_reorder_mode as BranchReorderMode)
      : DEFAULT_OPTIONS.branch_reorder_mode,
    switch_mode: VALID_SWITCH_MODES.includes(raw.switch_mode as SwitchMode)
      ? (raw.switch_mode as SwitchMode)
      : DEFAULT_OPTIONS.switch_mode,
    block_action:
      typeof raw.block_action === 'boolean' ? raw.block_action : DEFAULT_OPTIONS.block_action,
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
    block_action:
      typeof raw.block_action === 'boolean' ? raw.block_action : DEFAULT_OPTIONS.block_action,
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
    block_action: file.options.block_action,
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

  if (obj.format !== EXPORT_FORMAT) {
    return { valid: false, error: 'Not a Fallen London Favourites export file' };
  }

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
