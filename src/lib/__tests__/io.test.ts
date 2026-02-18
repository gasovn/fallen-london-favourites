import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateImport, exportData, importData } from '../io';
import { packSet, unpackSet } from '../storage';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  DEFAULT_OPTIONS,
  STORAGE_SCHEMA_VERSION,
  type ExportFile,
} from '@/types';

const mockGet = vi.fn<() => Promise<Record<string, unknown>>>();
const mockSet = vi.fn<(items: Record<string, unknown>) => Promise<void>>();
const mockClear = vi.fn<() => Promise<void>>();

vi.stubGlobal('browser', {
  runtime: { requestUpdateCheck: vi.fn() },
  storage: {
    local: { get: mockGet, set: mockSet, clear: mockClear },
  },
});

function validExport(overrides: Record<string, unknown> = {}): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: '2026-02-17T12:00:00Z',
    data: {
      branch_faves: [101, 202],
      branch_avoids: [],
      storylet_faves: [10],
      storylet_avoids: [],
      card_faves: [1, 2],
      card_avoids: [5],
    },
    options: {
      branch_reorder_mode: 'branch_reorder_active',
      switch_mode: 'click_through',
      click_protection: 'off',
    },
    ...overrides,
  };
}

describe('validateImport', () => {
  describe('valid input', () => {
    it('accepts a valid export file', () => {
      const input = validExport();
      const result = validateImport(input);

      expect(result.valid).toBe(true);

      if (result.valid) {
        expect(result.data.format).toBe(EXPORT_FORMAT);
        expect(result.data.version).toBe(EXPORT_VERSION);
        expect(result.data.exported_at).toBe('2026-02-17T12:00:00Z');
        expect(result.data.data.branch_faves).toEqual([101, 202]);
        expect(result.data.data.branch_avoids).toEqual([]);
        expect(result.data.data.storylet_faves).toEqual([10]);
        expect(result.data.data.storylet_avoids).toEqual([]);
        expect(result.data.data.card_faves).toEqual([1, 2]);
        expect(result.data.data.card_avoids).toEqual([5]);
        expect(result.data.options).toEqual({
          branch_reorder_mode: 'branch_reorder_active',
          switch_mode: 'click_through',
          click_protection: 'off',
        });
      }
    });
  });

  describe('non-object input', () => {
    it('rejects null', () => {
      const result = validateImport(null);

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('Invalid file format');
      }
    });

    it('rejects primitives', () => {
      const result = validateImport(42);

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('Invalid file format');
      }
    });
  });

  describe('format marker', () => {
    it('rejects wrong format value', () => {
      const result = validateImport(validExport({ format: 'wrong-format' }));

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('Not a Fallen London Favourites export file');
      }
    });

    it('rejects missing format', () => {
      const input = validExport();

      delete (input as unknown as Record<string, unknown>).format;

      const result = validateImport(input);

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('Not a Fallen London Favourites export file');
      }
    });
  });

  describe('version', () => {
    it('rejects unsupported version', () => {
      const result = validateImport(validExport({ version: 99 }));

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe(
          'This file was created by a newer version. Please update the extension',
        );
      }
    });

    it('rejects non-numeric version', () => {
      const result = validateImport(validExport({ version: 'abc' }));

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('Invalid file format');
      }
    });

    it('accepts old v1 format', () => {
      const result = validateImport(validExport({ version: 1 }));

      expect(result.valid).toBe(true);
    });
  });

  describe('data section', () => {
    it('rejects missing data', () => {
      const result = validateImport(validExport({ data: null }));

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('File data is corrupted');
      }
    });

    it('rejects missing data keys', () => {
      const result = validateImport(
        validExport({
          data: {
            branch_faves: [1],
            // missing the rest
          },
        }),
      );

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('File data is corrupted');
      }
    });

    it('rejects non-array data values', () => {
      const result = validateImport(
        validExport({
          data: {
            branch_faves: 'not an array',
            branch_avoids: [],
            storylet_faves: [],
            storylet_avoids: [],
            card_faves: [],
            card_avoids: [],
          },
        }),
      );

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('File data is corrupted');
      }
    });

    it('rejects arrays with non-number elements', () => {
      const result = validateImport(
        validExport({
          data: {
            branch_faves: [1, 'two', 3],
            branch_avoids: [],
            storylet_faves: [],
            storylet_avoids: [],
            card_faves: [],
            card_avoids: [],
          },
        }),
      );

      expect(result.valid).toBe(false);

      if (!result.valid) {
        expect(result.error).toBe('File data is corrupted');
      }
    });
  });

  describe('options sanitization', () => {
    it('replaces invalid option values with defaults', () => {
      const result = validateImport(
        validExport({
          options: {
            branch_reorder_mode: 'invalid_mode',
            switch_mode: 'invalid_switch',
            click_protection: 'invalid_value',
          },
        }),
      );

      expect(result.valid).toBe(true);

      if (result.valid) {
        expect(result.data.options).toEqual({
          branch_reorder_mode: DEFAULT_OPTIONS.branch_reorder_mode,
          switch_mode: DEFAULT_OPTIONS.switch_mode,
          click_protection: DEFAULT_OPTIONS.click_protection,
        });
      }
    });

    it('applies all defaults when options are missing', () => {
      const input = validExport();

      delete (input as unknown as Record<string, unknown>).options;

      const result = validateImport(input);

      expect(result.valid).toBe(true);

      if (result.valid) {
        expect(result.data.options).toEqual({
          branch_reorder_mode: DEFAULT_OPTIONS.branch_reorder_mode,
          switch_mode: DEFAULT_OPTIONS.switch_mode,
          click_protection: DEFAULT_OPTIONS.click_protection,
        });
      }
    });

    it('converts old v1 format with block_action to click_protection', () => {
      const result = validateImport(
        validExport({
          version: 1,
          options: {
            branch_reorder_mode: 'branch_reorder_active',
            switch_mode: 'click_through',
            block_action: true,
          },
        }),
      );

      expect(result.valid).toBe(true);

      if (result.valid) {
        expect(result.data.options.click_protection).toBe('shift');
      }
    });

    it('converts old v1 format with block_action false to "off"', () => {
      const result = validateImport(
        validExport({
          version: 1,
          options: {
            branch_reorder_mode: 'branch_reorder_active',
            switch_mode: 'click_through',
            block_action: false,
          },
        }),
      );

      expect(result.valid).toBe(true);

      if (result.valid) {
        expect(result.data.options.click_protection).toBe('off');
      }
    });
  });
});

describe('exportData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports storage data as a clean ExportFile', async () => {
    const storageData: Record<string, unknown> = {
      storage_schema: 4,
      branch_reorder_mode: 'branch_reorder_all',
      switch_mode: 'modifier_click',
      click_protection: 'shift',
      ...packSet(new Set([101, 202]), 'branch_faves'),
      ...packSet(new Set([301]), 'branch_avoids'),
      ...packSet(new Set([10, 20]), 'storylet_faves'),
      storylet_avoids_keys: [],
      ...packSet(new Set([1, 2, 3]), 'card_faves'),
      card_avoids_keys: [],
    };

    mockGet.mockResolvedValue(storageData);

    const result = await exportData();

    expect(result.format).toBe('fallen-london-favourites');
    expect(result.version).toBe(2);
    expect(typeof result.exported_at).toBe('string');
    expect(result.data).toEqual({
      branch_faves: [101, 202],
      branch_avoids: [301],
      storylet_faves: [10, 20],
      storylet_avoids: [],
      card_faves: [1, 2, 3],
      card_avoids: [],
    });
    expect(result.options).toEqual({
      branch_reorder_mode: 'branch_reorder_all',
      switch_mode: 'modifier_click',
      click_protection: 'shift',
    });
  });

  it('uses default options when storage has none', async () => {
    const storageData: Record<string, unknown> = {
      storage_schema: 4,
      branch_faves_keys: [],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_faves_keys: [],
      card_avoids_keys: [],
    };

    mockGet.mockResolvedValue(storageData);

    const result = await exportData();

    expect(result.options).toEqual({
      branch_reorder_mode: 'branch_reorder_active',
      switch_mode: 'click_through',
      click_protection: 'off',
    });
  });

  it('produces output that passes validateImport', async () => {
    const storageData: Record<string, unknown> = {
      storage_schema: 4,
      ...packSet(new Set([42]), 'branch_faves'),
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_faves_keys: [],
      card_avoids_keys: [],
    };

    mockGet.mockResolvedValue(storageData);

    const exported = await exportData();
    const validated = validateImport(exported);

    expect(validated.valid).toBe(true);
  });
});

describe('importData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears storage and writes packed data with options', async () => {
    const input = validExport();

    await importData(input);

    expect(mockClear).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();

    const written = mockSet.mock.calls[0][0];

    expect(written.storage_schema).toBe(STORAGE_SCHEMA_VERSION);
    expect(written.branch_reorder_mode).toBe('branch_reorder_active');
    expect(written.switch_mode).toBe('click_through');
    expect(written.click_protection).toBe('off');

    const branchFaves = unpackSet(written, 'branch_faves');

    expect(branchFaves).toEqual(new Set([101, 202]));
  });

  it('calls clear before set', async () => {
    const callOrder: string[] = [];

    mockClear.mockImplementation(() => {
      callOrder.push('clear');

      return Promise.resolve();
    });
    mockSet.mockImplementation(() => {
      callOrder.push('set');

      return Promise.resolve();
    });

    await importData(validExport());

    expect(callOrder).toEqual(['clear', 'set']);
  });
});

describe('round-trip: export → import → export', () => {
  let storage: Record<string, unknown>;

  function useStatefulMocks(initial: Record<string, unknown>): void {
    storage = { ...initial };
    mockGet.mockImplementation(() => Promise.resolve({ ...storage }));
    mockSet.mockImplementation((items) => {
      Object.assign(storage, items);

      return Promise.resolve();
    });
    mockClear.mockImplementation(() => {
      storage = {};

      return Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces identical exports', async () => {
    useStatefulMocks({
      storage_schema: STORAGE_SCHEMA_VERSION,
      branch_reorder_mode: 'branch_reorder_all',
      switch_mode: 'modifier_click',
      click_protection: 'shift',
      ...packSet(new Set([101, 202, 303]), 'branch_faves'),
      ...packSet(new Set([401]), 'branch_avoids'),
      ...packSet(new Set([10, 20]), 'storylet_faves'),
      ...packSet(new Set([30]), 'storylet_avoids'),
      ...packSet(new Set([1, 2, 3]), 'card_faves'),
      ...packSet(new Set([5, 6]), 'card_avoids'),
    });

    const exported1 = await exportData();

    await importData(exported1);

    const exported2 = await exportData();

    expect({ ...exported2, exported_at: '' }).toEqual({ ...exported1, exported_at: '' });
  });

  it('preserves all data arrays through the cycle', async () => {
    useStatefulMocks({
      storage_schema: STORAGE_SCHEMA_VERSION,
      ...packSet(new Set([101, 202]), 'branch_faves'),
      ...packSet(new Set([301]), 'branch_avoids'),
      ...packSet(new Set([10]), 'storylet_faves'),
      ...packSet(new Set([20]), 'storylet_avoids'),
      ...packSet(new Set([1, 2]), 'card_faves'),
      ...packSet(new Set([5]), 'card_avoids'),
    });

    const exported = await exportData();

    await importData(exported);

    expect(unpackSet(storage, 'branch_faves')).toEqual(new Set([101, 202]));
    expect(unpackSet(storage, 'branch_avoids')).toEqual(new Set([301]));
    expect(unpackSet(storage, 'storylet_faves')).toEqual(new Set([10]));
    expect(unpackSet(storage, 'storylet_avoids')).toEqual(new Set([20]));
    expect(unpackSet(storage, 'card_faves')).toEqual(new Set([1, 2]));
    expect(unpackSet(storage, 'card_avoids')).toEqual(new Set([5]));
    expect(storage.storage_schema).toBe(STORAGE_SCHEMA_VERSION);
  });

  it('works with empty data sets', async () => {
    useStatefulMocks({
      storage_schema: STORAGE_SCHEMA_VERSION,
      branch_faves_keys: [],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_faves_keys: [],
      card_avoids_keys: [],
    });

    const exported1 = await exportData();

    await importData(exported1);

    const exported2 = await exportData();

    expect({ ...exported2, exported_at: '' }).toEqual({ ...exported1, exported_at: '' });
    expect(exported1.data.branch_faves).toEqual([]);
  });

  it('v1 import then export produces v2 format without block_action', async () => {
    useStatefulMocks({});

    const v1File = validExport({
      version: 1,
      options: {
        branch_reorder_mode: 'branch_reorder_active',
        switch_mode: 'click_through',
        block_action: true,
      },
    });

    const validated = validateImport(v1File);

    expect(validated.valid).toBe(true);

    if (validated.valid) {
      await importData(validated.data);
    }

    const exported = await exportData();

    expect(exported.version).toBe(EXPORT_VERSION);
    expect(exported.options.click_protection).toBe('shift');
    expect((exported.options as unknown as Record<string, unknown>).block_action).toBeUndefined();
  });
});
