import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  DATA_KEYS,
  DEFAULT_OPTIONS,
  STORAGE_SCHEMA_VERSION,
  type ExportData,
  type ExportFile,
  type ImportResult,
  type Options,
  type ReadTarget,
  type BranchReorderMode,
  type SwitchMode,
} from '@/types';
import { packSet, unpackSet, parseClickProtection } from './storage';
import { keyFor, listProfileCharIds, keysForProfile, REGISTRY_KEY } from './profiles';
import { syncPayload } from './flags';
import { projectArea, wouldExceed } from './quota';
import { migrateData, detectVersion } from './migration';

export class SyncQuotaExceededError extends Error {
  constructor() {
    super('Sync storage is full');
    this.name = 'SyncQuotaExceededError';
  }
}

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

function sanitizeRegistry(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') {
    return {};
  }

  const out: Record<string, string> = {};

  for (const [charId, name] of Object.entries(value as Record<string, unknown>)) {
    if (/^[0-9]+$/.test(charId) && typeof name === 'string') {
      out[charId] = name;
    }
  }

  return out;
}

function extractSets(raw: Record<string, unknown>, target: ReadTarget): ExportData {
  return Object.fromEntries(
    DATA_KEYS.map((key) => {
      const set = unpackSet(raw, keyFor(target, key));

      return [key, Array.from(set).sort((a, b) => a - b)];
    }),
  ) as unknown as ExportData;
}

function extractProfiles(raw: Record<string, unknown>): Record<string, ExportData> {
  const profiles: Record<string, ExportData> = {};

  for (const charId of listProfileCharIds(raw)) {
    profiles[charId] = extractSets(raw, { kind: 'profile', charId });
  }

  return profiles;
}

function buildExport(raw: Record<string, unknown>): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    data: extractSets(raw, { kind: 'default' }),
    options: sanitizeOptions(raw),
    profiles: extractProfiles(raw),
    registry: sanitizeRegistry(raw[REGISTRY_KEY]),
  };
}

export function convertRawDump(raw: Record<string, unknown>): ExportFile {
  return buildExport(migrateData(raw));
}

export async function exportData(): Promise<ExportFile> {
  const raw = await browser.storage.local.get(null);

  return buildExport(raw);
}

export async function importData(
  file: ExportFile,
  { turnOn = false }: { turnOn?: boolean } = {},
): Promise<void> {
  const storageData: Record<string, unknown> = {
    storage_schema: STORAGE_SCHEMA_VERSION,
    branch_reorder_mode: file.options.branch_reorder_mode,
    switch_mode: file.options.switch_mode,
    click_protection: file.options.click_protection,
  };

  for (const key of DATA_KEYS) {
    Object.assign(storageData, packSet(new Set(file.data[key]), key));
  }

  const profiles = file.profiles ?? {};

  for (const [charId, sets] of Object.entries(profiles)) {
    for (const key of DATA_KEYS) {
      Object.assign(
        storageData,
        packSet(new Set(sets[key]), keyFor({ kind: 'profile', charId }, key)),
      );
    }
  }

  const registry = file.registry ?? {};

  if (Object.keys(registry).length > 0) {
    storageData[REGISTRY_KEY] = registry;
  }

  const snapshot = await browser.storage.local.get(null);

  // The backup omits these two; dropping the toggle would point open tabs at
  // the shared default until the next pull from sync brings it back.
  for (const key of ['multi_toggle', 'start_empty']) {
    if (typeof snapshot[key] === 'boolean') {
      storageData[key] = snapshot[key];
    }
  }

  // The user chose to use the backup's profiles.
  if (turnOn) {
    storageData.multi_toggle = true;
  }

  // A backup no larger than what this device holds always restores.
  const current = projectArea(syncPayload(snapshot));

  if (wouldExceed(projectArea(syncPayload(storageData)), current)) {
    throw new SyncQuotaExceededError();
  }

  // Written before the old keys go, so a mark made in a game tab meanwhile
  // never reads an empty store, which would pass as complete.
  await browser.storage.local.set(storageData);

  const leftover = Object.keys(snapshot).filter((key) => !(key in storageData));

  if (leftover.length > 0) {
    await browser.storage.local.remove(leftover);
  }

  // Profiles missing from the backup would come back from sync on the next
  // pull. Remove them there as well: only p:<id>:* keys, never the shared
  // flat ones.
  try {
    const keptIds = new Set(Object.keys(profiles));
    const syncData = await browser.storage.sync.get(null);
    const toRemove: string[] = [];

    for (const charId of listProfileCharIds(syncData)) {
      if (!keptIds.has(charId)) {
        toRemove.push(...keysForProfile(syncData, charId));
      }
    }

    if (toRemove.length > 0) {
      await browser.storage.sync.remove(toRemove);
    }
  } catch {
    // best effort
  }
}

function validateExportData(value: unknown): ExportData | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, number[]> = {};

  for (const key of DATA_KEYS) {
    const arr = obj[key];

    if (!Array.isArray(arr) || !arr.every((v) => typeof v === 'number')) {
      return null;
    }

    result[key] = arr as number[];
  }

  return result as unknown as ExportData;
}

function validateProfiles(value: unknown): Record<string, ExportData> | null {
  if (value === undefined) {
    return {};
  }

  if (value === null || typeof value !== 'object') {
    return null;
  }

  const out: Record<string, ExportData> = {};

  for (const [charId, sets] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[0-9]+$/.test(charId)) {
      return null;
    }

    const validated = validateExportData(sets);

    if (validated === null) {
      return null;
    }

    out[charId] = validated;
  }

  return out;
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

    const data = validateExportData(obj.data);

    if (data === null) {
      return { valid: false, error: 'File data is corrupted' };
    }

    const profiles = validateProfiles(obj.profiles);

    if (profiles === null) {
      return { valid: false, error: 'File data is corrupted' };
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
        data,
        options,
        profiles,
        registry: sanitizeRegistry(obj.registry),
      },
    };
  }

  // Wrong format marker — not our file
  if ('format' in obj) {
    return { valid: false, error: 'Not a Fallen London Favourites export file' };
  }

  // No format field — try as raw storage dump
  const version = detectVersion(obj);

  if (version >= STORAGE_SCHEMA_VERSION && !Object.keys(obj).some((k) => k.endsWith('_keys'))) {
    // detectVersion returns STORAGE_SCHEMA_VERSION for empty/unrecognized data,
    // but a real dump will have _keys fields (e.g. branch_faves_keys)
    return { valid: false, error: 'Unrecognized file format' };
  }

  if (version > STORAGE_SCHEMA_VERSION) {
    return {
      valid: false,
      error: 'This data was created by a newer version. Please update the extension',
    };
  }

  try {
    const converted = convertRawDump(obj);

    return { valid: true, data: converted };
  } catch {
    return { valid: false, error: 'Unrecognized file format' };
  }
}
