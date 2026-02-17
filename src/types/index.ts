export const STORAGE_SCHEMA_VERSION = 3;
export const MAX_PACK_ITEMS_PER_KEY = 512;

export type BranchReorderMode =
  | 'branch_no_reorder'
  | 'branch_reorder_active'
  | 'branch_reorder_all';
export type SwitchMode = 'click_through' | 'modifier_click';

export type FaveState = 'fave' | 'avoid' | 'none';

export interface Options {
  branch_reorder_mode: BranchReorderMode;
  switch_mode: SwitchMode;
  block_action: boolean;
}

export interface DefaultStorageOptions {
  branch_reorder_mode: BranchReorderMode;
  switch_mode: SwitchMode;
  block_action: boolean;
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
  block_action: false,
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
}
