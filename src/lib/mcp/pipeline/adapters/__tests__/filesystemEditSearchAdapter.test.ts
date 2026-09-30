import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesystemAdapter } from '../FilesystemAdapter';
import { ToolInvocation } from '../../ToolInvocation';

const mocks = vi.hoisted(() => ({
  editFile: vi.fn(),
  searchFiles: vi.fn(),
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  readFile: vi.fn(), writeFile: vi.fn(), listDirectory: vi.fn(), createDirectory: vi.fn(),
  deleteFile: vi.fn(), deleteMany: vi.fn(), deleteByPattern: vi.fn(), renameFile: vi.fn(),
  editFile: mocks.editFile,
  searchFiles: mocks.searchFiles,
}));

beforeEach(() => vi.clearAllMocks());

const invocation = (tool: string, args: Record<string, unknown>) => new ToolInvocation({
  assistantMessageId: 'run-1', conversationId: 'conv-1', server: 'fs', tool, args, callId: 'call-1',
});

describe('fs__edit adapter', () => {
  it('returns the applied result unchanged', async () => {
    mocks.editFile.mockResolvedValue({ ok: true, path: 'D:/site/a.ts', replacements: 1, line: 3, candidates: [] });

    const result: any = await new FilesystemAdapter().execute(
      invocation('edit', { path: 'D:/site/a.ts', find: 'old', replace: 'new' }),
    );

    expect(mocks.editFile).toHaveBeenCalledWith({
      path: 'D:/site/a.ts', find: 'old', replace: 'new', all: false, expectedHash: undefined,
    });
    expect(result).toMatchObject({ ok: true, replacements: 1 });
  });

  it('refuses an edit that omits replace instead of deleting the match', async () => {
    const result: any = await new FilesystemAdapter().execute(
      invocation('edit', { path: 'D:/site/a.ts', find: 'keep this' }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
    expect(mocks.editFile).not.toHaveBeenCalled();
  });

  it('passes the read hash so a stale edit is refused', async () => {
    mocks.editFile.mockResolvedValue({
      ok: false, path: 'D:/site/a.ts', replacements: 0, reason: 'FILE_CHANGED',
      candidates: ['文件已变化：请重新读取后再编辑。'],
    });

    const result: any = await new FilesystemAdapter().execute(
      invocation('edit', { path: 'D:/site/a.ts', find: 'a', replace: 'b', expectedHash: 'abc' }),
    );

    expect(mocks.editFile).toHaveBeenCalledWith({
      path: 'D:/site/a.ts', find: 'a', replace: 'b', all: false, expectedHash: 'abc',
    });
    expect(result.error.code).toBe('FILE_CHANGED');
    expect(String(result.error.message)).toContain('已被修改');
  });

  it('turns an ambiguous match into an actionable tool error', async () => {
    mocks.editFile.mockResolvedValue({
      ok: false, path: 'D:/site/a.ts', replacements: 0, reason: 'EDIT_MATCH_NOT_UNIQUE',
      candidates: ['第 1 行: useEffect();', '第 9 行: useEffect();'],
    });

    const result: any = await new FilesystemAdapter().execute(
      invocation('edit', { path: 'D:/site/a.ts', find: 'useEffect();', replace: 'effect();' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('EDIT_MATCH_NOT_UNIQUE');
    expect(String(result.error.message)).toContain('唯一');
    expect(result.error.candidates).toHaveLength(2);
  });

  it('explains a miss and refuses to write', async () => {
    mocks.editFile.mockResolvedValue({
      ok: false, path: 'D:/site/a.ts', replacements: 0, reason: 'EDIT_NO_MATCH', candidates: ['第 1 行: import x'],
    });

    const result: any = await new FilesystemAdapter().execute(
      invocation('edit', { path: 'D:/site/a.ts', find: 'nope', replace: 'x' }),
    );

    expect(result.error.code).toBe('EDIT_NO_MATCH');
    expect(String(result.error.message)).toContain('未找到');
  });
});

describe('fs__search adapter', () => {
  it('passes regex, glob and limit through', async () => {
    mocks.searchFiles.mockResolvedValue({
      ok: true, root: 'D:/site', matches: [{ path: 'D:/site/a.ts', line: 2, text: 'port 3000' }],
      truncated: false, filesScanned: 1, limit: 20,
    });

    const result: any = await new FilesystemAdapter().execute(
      invocation('search', { root: 'D:/site', query: 'port\\s+\\d+', glob: '*.ts', limit: 20, regex: true }),
    );

    expect(mocks.searchFiles).toHaveBeenCalledWith({
      root: 'D:/site', query: 'port\\s+\\d+', glob: '*.ts', limit: 20, regex: true, mode: 'both',
    });
    expect(result.matches).toHaveLength(1);
  });

  it('requires a query', async () => {
    const result: any = await new FilesystemAdapter().execute(invocation('search', { root: 'D:/site' }));
    expect(result.ok).toBe(false);
    expect(mocks.searchFiles).not.toHaveBeenCalled();
  });

  it('rejects an unknown search mode', async () => {
    const result: any = await new FilesystemAdapter().execute(
      invocation('search', { root: 'D:/site', query: 'x', mode: 'names' }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
    expect(mocks.searchFiles).not.toHaveBeenCalled();
  });

  it('passes the filename mode through', async () => {
    mocks.searchFiles.mockResolvedValue({
      ok: true, root: 'D:/site', mode: 'filename', matches: [], truncated: false,
      partial: false, filesScanned: 0, skippedCount: 0, skipped: [], limit: 50,
    });

    await new FilesystemAdapter().execute(invocation('search', { root: 'D:/site', query: 'checkout', mode: 'filename' }));
    expect(mocks.searchFiles).toHaveBeenCalledWith({
      root: 'D:/site', query: 'checkout', glob: undefined, limit: undefined, regex: false, mode: 'filename',
    });
  });
});
