/**
 * What a model passes as `root`, and what it gets back when that name matches nothing.
 *
 * The name comes from a chat, so it arrives quoted, spaced, or empty. An empty string is "no
 * name", not "match this", and a wrong name has to teach the model the real list in one round.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/lib/utils/runtimePlatform', () => ({
  isAndroidRuntime: () => true,
  isAndroidTauri: () => true,
  getRuntimePlatform: () => 'android',
}));

import {
  AndroidDirectoryAdapter,
  normalizeRootName,
  normalizeUnderName,
} from '../adapters/AndroidDirectoryAdapter';

const authorized = {
  status: 'ready',
  folder: { name: '整理测试' },
  entries: [],
};

function call(args: Record<string, unknown>) {
  return new AndroidDirectoryAdapter().execute({
    args,
    conversationId: 'chat-a',
  } as never);
}

describe('the folder name a model passes', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('keeps a plain name and cleans the chat decoration off the ones that need it', () => {
    expect(normalizeRootName('整理测试')).toBe('整理测试');
    expect(normalizeRootName('  整理测试 \n')).toBe('整理测试');
    expect(normalizeRootName('“整理测试”')).toBe('整理测试');
    expect(normalizeRootName('Download “备份”')).toBe('Download 备份');
  });

  it('reads an empty value as no name at all', () => {
    expect(normalizeRootName('')).toBe('');
    expect(normalizeRootName('   ')).toBe('');
    expect(normalizeRootName(undefined)).toBe('');
    expect(normalizeRootName(null)).toBe('');
    expect(normalizeRootName(12)).toBeUndefined();
    expect(normalizeRootName('x'.repeat(121))).toBeUndefined();
  });

  it('sends no filter when the model had no name to give', async () => {
    invoke.mockResolvedValue(authorized);
    expect(await call({ root: '' })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith(
      'inventory_android_directory',
      expect.objectContaining({
        conversationId: 'chat-a',
        root: null,
        under: null,
      }),
    );
  });

  it('sends the cleaned name when there is one', async () => {
    invoke.mockResolvedValue(authorized);
    await call({ root: '“整理测试”' });
    expect(invoke).toHaveBeenCalledWith(
      'inventory_android_directory',
      expect.objectContaining({
        conversationId: 'chat-a',
        root: '整理测试',
        under: null,
      }),
    );
  });

  it('answers a name that matches nothing with the names that do exist', async () => {
    invoke.mockResolvedValue({
      status: 'root_not_found',
      roots: ['整理测试', '照片备份'],
    });
    const result = (await call({ root: '下载' })) as {
      error?: { message?: string };
    };
    const message = result.error?.message ?? '';
    expect(message).toContain('整理测试, 照片备份');
    expect(message).toContain('/sdcard/Download');
    expect(message).toContain('with no `root`');
  });
});

describe('naming one subfolder of an authorized folder', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('keeps the path separators a name path needs', () => {
    expect(normalizeUnderName(' 合同 / 2024 ')).toBe('合同/2024');
    expect(normalizeUnderName('合同\\2024')).toBe('合同/2024');
    expect(normalizeUnderName('合同／')).toBe('合同');
    expect(normalizeUnderName('“合同”')).toBe('合同');
    expect(normalizeUnderName('   ')).toBe('');
    expect(normalizeUnderName(undefined)).toBe('');
    expect(normalizeUnderName(7)).toBeUndefined();
    expect(normalizeUnderName('x'.repeat(241))).toBeUndefined();
  });

  it('carries the path down to the command', async () => {
    invoke.mockResolvedValue(authorized);
    await call({ root: '整理测试', under: '合同' });
    expect(invoke).toHaveBeenCalledWith(
      'inventory_android_directory',
      expect.objectContaining({
        conversationId: 'chat-a',
        root: '整理测试',
        under: '合同',
      }),
    );
  });

  it('refuses a path that is not a name path', async () => {
    invoke.mockResolvedValue(authorized);
    const result = (await call({ under: 7 })) as {
      ok: boolean;
      error?: { code?: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_UNDER');
  });

  it('answers a wrong subfolder with the ones that exist', async () => {
    invoke.mockResolvedValue({
      status: 'subfolder_not_found',
      under: '合同',
      choices: [
        {
          folder: '整理测试',
          segment: '合同',
          available: ['证件', '发票2024'],
        },
      ],
    });
    const result = (await call({ under: '“合同”' })) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SUBFOLDER_NOT_FOUND');
    const message = result.error?.message ?? '';
    expect(message).toContain('证件, 发票2024');
    expect(message).toContain('omit it to read the folder as a whole');
  });

  it('points at one subfolder at a time when the listing hits its cap', async () => {
    invoke.mockResolvedValue({
      status: 'ready',
      folder: { handle: 'root', name: 'Download' },
      entries: [],
      omissions: [],
      // The walk says where it stopped; the adapter turns that into what to do next.
      totals: {
        scanned: 20000,
        matched: 1200,
        files: 19000,
        directories: 1000,
        bytes: 9,
        unknownMetadata: 0,
        stopped: 'row_limit',
        elapsedMs: 8000,
      },
    });
    const result = (await call({})) as Record<string, unknown>;
    expect(String(result.hint)).toContain('under');
  });
});
