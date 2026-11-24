import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Browser } from 'wxt/browser';
import {
  validateImport,
  exportData,
  importData,
  convertRawDump,
  SyncQuotaExceededError,
} from '../io';
import { packSet, unpackSet } from '../storage';
import { cleanupStorage } from '../cleanup';
import { migrate } from '../migration';
import { createMockStorage } from '../../../tests/helpers/mock-storage';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  DEFAULT_OPTIONS,
  STORAGE_SCHEMA_VERSION,
  type ExportData,
  type ExportFile,
} from '@/types';

const mockGet = vi.fn<() => Promise<Record<string, unknown>>>();
const mockSet = vi.fn<(items: Record<string, unknown>) => Promise<void>>();
const mockClear = vi.fn<() => Promise<void>>();
const mockRemove = vi.fn<(keys: string[]) => Promise<void>>(() => Promise.resolve());
const mockSyncGet = vi.fn<() => Promise<Record<string, unknown>>>(() => Promise.resolve({}));
const mockSyncRemove = vi.fn<(keys: string[]) => Promise<void>>(() => Promise.resolve());

vi.stubGlobal('browser', {
  runtime: { requestUpdateCheck: vi.fn() },
  storage: {
    local: { get: mockGet, set: mockSet, clear: mockClear, remove: mockRemove },
    sync: { get: mockSyncGet, remove: mockSyncRemove },
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
        expect(result.error).toBe('Unrecognized file format');
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

  describe('profiles and names', () => {
    it('rejects a profile whose character id is not a number', () => {
      const result = validateImport(validExport({ profiles: { abc: validExport().data } }));

      expect(result.valid).toBe(false);
    });

    it('rejects a profile whose favourites are not lists of numbers', () => {
      const broken = { ...validExport().data, branch_faves: ['12'] };
      const result = validateImport(validExport({ profiles: { '900001': broken } }));

      expect(result.valid).toBe(false);
    });

    it('keeps only character names filed under a numeric id', () => {
      const result = validateImport(
        validExport({ registry: { '900001': 'Jane', abc: 'x', '1000002': { a: 1 } } }),
      );

      expect(result.valid && result.data.registry).toEqual({ '900001': 'Jane' });
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
    expect(result.version).toBe(EXPORT_VERSION);
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
    mockGet.mockResolvedValue({});
    mockSyncGet.mockResolvedValue({});
  });

  it('writes packed data with options', async () => {
    const input = validExport();

    await importData(input);

    expect(mockSet).toHaveBeenCalledOnce();

    const written = mockSet.mock.calls[0][0];

    expect(written.storage_schema).toBe(STORAGE_SCHEMA_VERSION);
    expect(written.branch_reorder_mode).toBe('branch_reorder_active');
    expect(written.switch_mode).toBe('click_through');
    expect(written.click_protection).toBe('off');

    const branchFaves = unpackSet(written, 'branch_faves');

    expect(branchFaves).toEqual(new Set([101, 202]));
  });
});

describe('convertRawDump', () => {
  it('converts v2 legacy dump to ExportFile', () => {
    const dump: Record<string, unknown> = {
      storage_schema: 2,
      block_action: 'true',
      branch_reorder_mode: 'branch_reorder_all',
      switch_mode: 'modifier_click',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101, 202],
      branch_avoids_keys: [],
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [10],
      storylet_avoids_keys: [],
      card_protects_keys: ['card_protects_0'],
      card_protects_0: [1, 2],
      card_discards_keys: ['card_discards_0'],
      card_discards_0: [5],
    };

    const result = convertRawDump(dump);

    expect(result.format).toBe(EXPORT_FORMAT);
    expect(result.version).toBe(EXPORT_VERSION);
    expect(typeof result.exported_at).toBe('string');
    expect(result.data.branch_faves).toEqual([101, 202]);
    expect(result.data.branch_avoids).toEqual([]);
    expect(result.data.storylet_faves).toEqual([10]);
    expect(result.data.storylet_avoids).toEqual([]);
    expect(result.data.card_faves).toEqual([1, 2]);
    expect(result.data.card_avoids).toEqual([5]);
    expect(result.options.branch_reorder_mode).toBe('branch_reorder_all');
    expect(result.options.switch_mode).toBe('modifier_click');
    expect(result.options.click_protection).toBe('shift');
  });

  it('converts v0 dump with plain arrays', () => {
    const dump: Record<string, unknown> = {
      branch_faves: [101, 202],
    };

    const result = convertRawDump(dump);

    expect(result.format).toBe(EXPORT_FORMAT);
    expect(result.data.branch_faves).toEqual([101, 202]);
    expect(result.data.branch_avoids).toEqual([]);
  });

  it('applies default options when dump has none', () => {
    const dump: Record<string, unknown> = {
      storage_schema: 2,
      branch_faves_keys: [],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_protects_keys: [],
      card_discards_keys: [],
    };

    const result = convertRawDump(dump);

    expect(result.options).toEqual({
      branch_reorder_mode: DEFAULT_OPTIONS.branch_reorder_mode,
      switch_mode: DEFAULT_OPTIONS.switch_mode,
      click_protection: 'off',
    });
  });

  it('produces output that passes validateImport', () => {
    const dump: Record<string, unknown> = {
      storage_schema: 2,
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [42],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_protects_keys: [],
      card_discards_keys: [],
    };

    const result = convertRawDump(dump);
    const validated = validateImport(result);

    expect(validated.valid).toBe(true);
  });
});

describe('validateImport with raw dumps', () => {
  it('accepts a v2 raw storage dump', () => {
    const dump = {
      storage_schema: 2,
      block_action: 'true',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101, 202],
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_protects_keys: ['card_protects_0'],
      card_protects_0: [1, 2],
      card_discards_keys: [],
    };

    const result = validateImport(dump);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.data.format).toBe(EXPORT_FORMAT);
      expect(result.data.data.branch_faves).toEqual([101, 202]);
      expect(result.data.data.card_faves).toEqual([1, 2]);
      expect(result.data.options.click_protection).toBe('shift');
    }
  });

  it('accepts a v0 raw storage dump', () => {
    const dump = { branch_faves: [101, 202] };

    const result = validateImport(dump);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.data.data.branch_faves).toEqual([101, 202]);
    }
  });

  it('accepts a legacy master dump (no storage_schema, has _keys)', () => {
    const dump = {
      block_action: 'false',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101],
      card_faves_keys: [],
      card_avoids_keys: [],
    };

    const result = validateImport(dump);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.data.data.branch_faves).toEqual([101]);
    }
  });

  it('rejects unrecognized JSON object', () => {
    const result = validateImport({ foo: 'bar', baz: 123 });

    expect(result.valid).toBe(false);

    if (!result.valid) {
      expect(result.error).toMatch(/unrecognized/i);
    }
  });

  it('accepts a v4 raw storage dump (our own extension)', () => {
    const dump = {
      storage_schema: 4,
      click_protection: 'off',
      branch_faves_keys: [],
      branch_avoids_keys: [],
      storylet_faves_keys: ['storylet_faves_0'],
      storylet_faves_0: [343882],
      storylet_avoids_keys: [],
      card_faves_keys: ['card_faves_0'],
      card_faves_0: [324583],
      card_avoids_keys: ['card_avoids_0'],
      card_avoids_0: [22270],
    };

    const result = validateImport(dump);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.data.data.storylet_faves).toEqual([343882]);
      expect(result.data.data.card_faves).toEqual([324583]);
      expect(result.data.data.card_avoids).toEqual([22270]);
    }
  });

  it('rejects raw dump from a newer schema version', () => {
    const dump = {
      storage_schema: 99,
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101],
    };

    const result = validateImport(dump);

    expect(result.valid).toBe(false);

    if (!result.valid) {
      expect(result.error).toMatch(/newer version/i);
    }
  });

  it('still accepts native ExportFile format', () => {
    const input = {
      format: 'fallen-london-favourites',
      version: 2,
      exported_at: '2026-02-17T12:00:00Z',
      data: {
        branch_faves: [101],
        branch_avoids: [],
        storylet_faves: [],
        storylet_avoids: [],
        card_faves: [],
        card_avoids: [],
      },
      options: {
        branch_reorder_mode: 'branch_reorder_active',
        switch_mode: 'click_through',
        click_protection: 'off',
      },
    };

    const result = validateImport(input);

    expect(result.valid).toBe(true);
  });
});

let storage: Record<string, unknown>;

function useStatefulMocks(initial: Record<string, unknown>): void {
  storage = { ...initial };
  mockGet.mockImplementation(() => Promise.resolve({ ...storage }));
  mockSet.mockImplementation((items) => {
    Object.assign(storage, items);

    return Promise.resolve();
  });
  mockRemove.mockImplementation((keys) => {
    for (const key of keys) {
      delete storage[key];
    }

    return Promise.resolve();
  });
}

describe('round-trip: export → import → export', () => {
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

  it('v1 import then export produces the current format without block_action', async () => {
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

describe('round-trip: raw dump → import → export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('v2 legacy dump survives full round-trip', async () => {
    useStatefulMocks({});

    const dump = {
      storage_schema: 2,
      block_action: 'true',
      branch_reorder_mode: 'branch_reorder_all',
      switch_mode: 'modifier_click',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101, 202],
      branch_avoids_keys: ['branch_avoids_0'],
      branch_avoids_0: [301],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_protects_keys: ['card_protects_0'],
      card_protects_0: [1, 2],
      card_discards_keys: ['card_discards_0'],
      card_discards_0: [5],
    };

    const validated = validateImport(dump);

    expect(validated.valid).toBe(true);

    if (validated.valid) {
      await importData(validated.data);
    }

    const exported = await exportData();

    expect(exported.data.branch_faves).toEqual([101, 202]);
    expect(exported.data.branch_avoids).toEqual([301]);
    expect(exported.data.card_faves).toEqual([1, 2]);
    expect(exported.data.card_avoids).toEqual([5]);
    expect(exported.options.click_protection).toBe('shift');
    expect(exported.options.branch_reorder_mode).toBe('branch_reorder_all');
    expect(exported.options.switch_mode).toBe('modifier_click');
  });
});

describe('cleanup integration', () => {
  it('cleanupStorage keeps every chunk a registry names', async () => {
    const storage = createMockStorage();
    const data: Record<string, unknown> = {};

    Object.assign(data, packSet(new Set([100, 200]), 'branch_faves'));
    Object.assign(data, packSet(new Set([300]), 'branch_avoids'));
    Object.assign(data, packSet(new Set(), 'storylet_faves'));
    Object.assign(data, packSet(new Set(), 'storylet_avoids'));
    Object.assign(data, packSet(new Set([400, 500]), 'card_faves'));
    Object.assign(data, packSet(new Set(), 'card_avoids'));
    await storage.set(data);

    await cleanupStorage(storage);

    const stored = await storage.get(null);

    expect(unpackSet(stored, 'branch_faves')).toEqual(new Set([100, 200]));
    expect(unpackSet(stored, 'branch_avoids')).toEqual(new Set([300]));
    expect(unpackSet(stored, 'storylet_faves')).toEqual(new Set());
    expect(unpackSet(stored, 'card_faves')).toEqual(new Set([400, 500]));
  });

  it('migration then cleanup produces clean storage', async () => {
    const storage = createMockStorage({
      storage_schema: 2,
      block_action: 'true',
      branch_faves_keys: ['branch_faves_0'],
      branch_faves_0: [101],
      card_protects_keys: ['card_protects_0'],
      card_protects_0: [701],
      card_discards_keys: [],
    });

    await migrate(storage as unknown as Browser.storage.StorageArea);
    await cleanupStorage(storage);

    const data = storage._getData();

    // Migrated correctly
    expect(data.storage_schema).toBe(STORAGE_SCHEMA_VERSION);
    expect(data.click_protection).toBe('shift');
    // Zombies cleaned
    expect(data).not.toHaveProperty('block_action');
    expect(data).not.toHaveProperty('card_protects_keys');
    expect(data).not.toHaveProperty('card_protects_0');
    expect(data).not.toHaveProperty('card_discards_keys');
    // Data preserved
    expect(unpackSet(data, 'branch_faves')).toEqual(new Set([101]));
    expect(unpackSet(data, 'card_faves')).toEqual(new Set([701]));
  });
});

const EMPTY_DATA: ExportData = {
  branch_faves: [],
  branch_avoids: [],
  storylet_faves: [],
  storylet_avoids: [],
  card_faves: [],
  card_avoids: [],
};

const IMPORT_OPTIONS = {
  branch_reorder_mode: 'branch_reorder_active' as const,
  switch_mode: 'click_through' as const,
  click_protection: 'off' as const,
};

describe('profiles in export/import', () => {
  let local: ReturnType<typeof createMockStorage>;
  let sync: ReturnType<typeof createMockStorage>;

  function stub(
    localInit: Record<string, unknown> = {},
    syncInit: Record<string, unknown> = {},
  ): void {
    local = createMockStorage(localInit);
    sync = createMockStorage(syncInit);
    vi.stubGlobal('browser', {
      runtime: { requestUpdateCheck: vi.fn() },
      storage: { local, sync },
    });
  }

  it('exports the flat default, every profile, and the name registry', async () => {
    stub({
      storage_schema: STORAGE_SCHEMA_VERSION,
      ...packSet(new Set([1]), 'branch_faves'),
      ...packSet(new Set([10]), 'p:900001:branch_faves'),
      ...packSet(new Set([20]), 'p:1000002:branch_faves'),
      'p:registry': { '900001': 'Jane', '1000002': 'Mary' },
    });

    const exported = await exportData();

    expect(exported.version).toBe(EXPORT_VERSION);
    expect(exported.data.branch_faves).toEqual([1]);
    expect(exported.profiles?.['900001']?.branch_faves).toEqual([10]);
    expect(exported.profiles?.['1000002']?.branch_faves).toEqual([20]);
    expect(exported.registry).toEqual({ '900001': 'Jane', '1000002': 'Mary' });
  });

  it('round-trips profiles through export → import → export', async () => {
    stub({
      storage_schema: STORAGE_SCHEMA_VERSION,
      ...packSet(new Set([1]), 'branch_faves'),
      ...packSet(new Set([10]), 'p:900001:branch_faves'),
      'p:registry': { '900001': 'Jane' },
    });

    const exported1 = await exportData();

    await importData(exported1);

    const exported2 = await exportData();

    expect({ ...exported2, exported_at: '' }).toEqual({ ...exported1, exported_at: '' });
  });

  it('discards a profile absent from the backup, but never the shared flat keys', async () => {
    stub(
      { storage_schema: STORAGE_SCHEMA_VERSION, ...packSet(new Set([1]), 'branch_faves') },
      {
        storage_schema: STORAGE_SCHEMA_VERSION,
        ...packSet(new Set([1]), 'branch_faves'),
        ...packSet(new Set([10]), 'p:900001:branch_faves'),
        ...packSet(new Set([20]), 'p:1000002:branch_faves'),
      },
    );

    await importData({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exported_at: '',
      data: { ...EMPTY_DATA, branch_faves: [1] },
      options: IMPORT_OPTIONS,
      profiles: { '900001': { ...EMPTY_DATA, branch_faves: [10] } },
      registry: { '900001': 'Jane' },
    });

    const syncData = sync._getData();

    expect(syncData).not.toHaveProperty('p:1000002:branch_faves_keys');
    expect(syncData).not.toHaveProperty('p:1000002:branch_faves_0');
    expect(syncData['p:900001:branch_faves_0']).toEqual([10]);
    expect(syncData.branch_faves_0).toEqual([1]);
    expect(syncData.storage_schema).toBe(STORAGE_SCHEMA_VERSION);
  });

  it('replaces the data without ever leaving the store empty', async () => {
    stub({
      storage_schema: STORAGE_SCHEMA_VERSION,
      multi_toggle: true,
      ...packSet(new Set([9]), 'storylet_faves'),
      ...packSet(new Set([20]), 'p:1000002:branch_faves'),
    });

    const sizes: number[] = [];
    const record = <T>(call: Promise<T>): Promise<T> =>
      call.then((result) => {
        sizes.push(Object.keys(local._getData()).length);

        return result;
      });
    const realSet = local.set.bind(local);
    const realRemove = local.remove.bind(local);
    const realClear = local.clear.bind(local);

    local.set = ((items: Record<string, unknown>) => record(realSet(items))) as typeof local.set;
    local.remove = ((keys: string | string[]) => record(realRemove(keys))) as typeof local.remove;
    local.clear = (() => record(realClear())) as typeof local.clear;

    await importData({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exported_at: '',
      data: { ...EMPTY_DATA, branch_faves: [1] },
      options: IMPORT_OPTIONS,
      profiles: { '900001': { ...EMPTY_DATA, branch_faves: [10] } },
      registry: {},
    });

    const data = local._getData();

    expect(sizes.every((size) => size > 0)).toBe(true);
    expect(Object.keys(data).filter((key) => key.startsWith('p:1000002:'))).toEqual([]);
    expect(unpackSet(data, 'branch_faves')).toEqual(new Set([1]));
    expect(unpackSet(data, 'storylet_faves')).toEqual(new Set());
    expect(unpackSet(data, 'p:900001:branch_faves')).toEqual(new Set([10]));
    expect(data.multi_toggle).toBe(true);
  });

  it('an old flat-only backup discards all profiles', async () => {
    stub(
      {},
      {
        storage_schema: STORAGE_SCHEMA_VERSION,
        ...packSet(new Set([10]), 'p:900001:branch_faves'),
      },
    );

    await importData({
      format: EXPORT_FORMAT,
      version: 2,
      exported_at: '',
      data: EMPTY_DATA,
      options: IMPORT_OPTIONS,
    });

    expect(sync._getData()).not.toHaveProperty('p:900001:branch_faves_keys');
  });

  it('carries profiles through a raw storage dump', () => {
    const dump = {
      storage_schema: STORAGE_SCHEMA_VERSION,
      ...packSet(new Set([1]), 'branch_faves'),
      branch_avoids_keys: [],
      storylet_faves_keys: [],
      storylet_avoids_keys: [],
      card_faves_keys: [],
      card_avoids_keys: [],
      ...packSet(new Set([10]), 'p:900001:branch_faves'),
      'p:registry': { '900001': 'Jane' },
    };

    const result = validateImport(dump);

    expect(result.valid).toBe(true);

    if (result.valid) {
      expect(result.data.profiles?.['900001']?.branch_faves).toEqual([10]);
      expect(result.data.registry).toEqual({ '900001': 'Jane' });
    }
  });

  it('refuses a backup that would overflow the sync quota', async () => {
    stub();

    const profiles: Record<string, ExportData> = {};

    for (let i = 0; i < 80; i++) {
      profiles[String(1000000 + i)] = { ...EMPTY_DATA, branch_faves: [i] };
    }

    await expect(
      importData({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exported_at: '',
        data: EMPTY_DATA,
        options: IMPORT_OPTIONS,
        profiles,
        registry: {},
      }),
    ).rejects.toBeInstanceOf(SyncQuotaExceededError);

    expect(local._getData()).toEqual({});
  });

  it('restores a backup over the quota when the device already holds more', async () => {
    const held: Record<string, unknown> = {};
    const profiles: Record<string, ExportData> = {};

    for (let i = 0; i < 90; i++) {
      Object.assign(held, packSet(new Set([i]), `p:${1000000 + i}:branch_faves`));

      for (let filler = 0; filler < 5; filler++) {
        held[`p:${1000000 + i}:filler_${filler}`] = [];
      }
    }

    for (let i = 0; i < 80; i++) {
      profiles[String(1000000 + i)] = { ...EMPTY_DATA, branch_faves: [i] };
    }

    stub(held);

    await importData({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exported_at: '',
      data: EMPTY_DATA,
      options: IMPORT_OPTIONS,
      profiles,
      registry: {},
    });

    expect(local._getData()['p:1000079:branch_faves_0']).toEqual([79]);
    expect(local._getData()).not.toHaveProperty('p:1000089:branch_faves_0');
  });

  it('rejects a newer-format backup on an older client', () => {
    const result = validateImport({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION + 1,
      exported_at: '',
      data: EMPTY_DATA,
      options: IMPORT_OPTIONS,
    });

    expect(result.valid).toBe(false);
  });
});
