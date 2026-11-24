export const STORAGE_SCHEMA_VERSION = 5;
export const MAX_PACK_ITEMS_PER_KEY = 512;

export type BranchReorderMode =
  | 'branch_no_reorder'
  | 'branch_reorder_active'
  | 'branch_reorder_all';
export type SwitchMode = 'click_through' | 'modifier_click';
export const CLICK_PROTECTIONS = ['off', 'shift', 'confirm'] as const;
export type ClickProtection = (typeof CLICK_PROTECTIONS)[number];

export type FaveState = 'fave' | 'avoid' | 'none';

type ProfileTarget = { kind: 'profile'; charId: string };

/**
 * default: the flat keys shared with old clients. profile: `p:<charId>:<category>`.
 */
export type ReadTarget = { kind: 'default' } | ProfileTarget;

/**
 * blocked: per-character mode is on but no character resolved, so no favourites
 * are shown and nothing is written.
 */
export type WriteTarget = ReadTarget | { kind: 'blocked' };

export interface Options {
  branch_reorder_mode: BranchReorderMode;
  switch_mode: SwitchMode;
  click_protection: ClickProtection;
}

export interface DefaultStorageOptions {
  branch_reorder_mode: BranchReorderMode;
  switch_mode: SwitchMode;
  click_protection: ClickProtection;
  multi_toggle: boolean;
  start_empty: boolean;
  branch_faves_keys: string[];
  branch_avoids_keys: string[];
  storylet_faves_keys: string[];
  storylet_avoids_keys: string[];
  card_faves_keys: string[];
  card_avoids_keys: string[];
  storage_schema: number;
}

export const DEFAULT_OPTIONS: DefaultStorageOptions = {
  branch_reorder_mode: 'branch_reorder_active',
  switch_mode: 'click_through',
  click_protection: 'off',
  multi_toggle: false,
  start_empty: false,
  branch_faves_keys: [],
  branch_avoids_keys: [],
  storylet_faves_keys: [],
  storylet_avoids_keys: [],
  card_faves_keys: [],
  card_avoids_keys: [],
  storage_schema: STORAGE_SCHEMA_VERSION,
};

export interface FaveData {
  branch_faves: Set<number>;
  branch_avoids: Set<number>;
  storylet_faves: Set<number>;
  storylet_avoids: Set<number>;
  card_faves: Set<number>;
  card_avoids: Set<number>;
  options: Options;
  // Resolved each time the page loads its data; a profile write is refused if the
  // character has changed since.
  loadedCharId: string | null;
  readTarget: ReadTarget;
  writeTarget: WriteTarget;
}

export type FaveSets = Omit<FaveData, 'options' | 'loadedCharId' | 'readTarget' | 'writeTarget'>;

export const EXPORT_FORMAT = 'fallen-london-favourites' as const;
// v3 adds profiles and the name registry.
export const EXPORT_VERSION = 3;

export const DATA_KEYS = [
  'branch_faves',
  'branch_avoids',
  'storylet_faves',
  'storylet_avoids',
  'card_faves',
  'card_avoids',
] as const;

export interface ExportData {
  branch_faves: number[];
  branch_avoids: number[];
  storylet_faves: number[];
  storylet_avoids: number[];
  card_faves: number[];
  card_avoids: number[];
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exported_at: string;
  data: ExportData;
  options: Options;
  // Absent in v1 and v2 backups.
  profiles?: Record<string, ExportData>;
  registry?: Record<string, string>;
}

export type ImportResult = { valid: true; data: ExportFile } | { valid: false; error: string };
