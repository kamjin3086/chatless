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
    expect(invoke).toHaveBeenCalledWith('inventory_android_directory', {
      conversationId: 'chat-a',
      root: null,
    });
  });

  it('sends the cleaned name when there is one', async () => {
    invoke.mockResolvedValue(authorized);
    await call({ root: '“整理测试”' });
    expect(invoke).toHaveBeenCalledWith('inventory_android_directory', {
      conversationId: 'chat-a',
      root: '整理测试',
    });
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
