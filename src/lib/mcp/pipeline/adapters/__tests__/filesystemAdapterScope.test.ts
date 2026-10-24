import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  readFile: vi.fn(async () => ({ ok: true })),
  writeFile: vi.fn(async () => ({ ok: true })),
  editFile: vi.fn(async () => ({ ok: true })),
  searchFiles: vi.fn(async () => ({ ok: true })),
  listDirectory: vi.fn(async () => ({ ok: true })),
  createDirectory: vi.fn(async () => ({ ok: true })),
  deleteFile: vi.fn(async () => ({ ok: true })),
  deleteMany: vi.fn(async () => ({ ok: true })),
  deleteByPattern: vi.fn(async () => ({ ok: true })),
  renameFile: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/tauri/filesystemCommands', () => ({
  readFile: io.readFile,
  writeFile: io.writeFile,
  editFile: io.editFile,
  searchFiles: io.searchFiles,
  listDirectory: io.listDirectory,
  createDirectory: io.createDirectory,
  deleteFile: io.deleteFile,
  deleteMany: io.deleteMany,
  deleteByPattern: io.deleteByPattern,
  renameFile: io.renameFile,
}));

import { FilesystemAdapter } from '../FilesystemAdapter';
import { ToolInvocation } from '../../ToolInvocation';

const invocation = (tool: string, args: Record<string, unknown>) =>
  new ToolInvocation({
    provider: 'openai-compatible',
    model: 'gpt-fixture',
    historyForLlm: [],
    originalUserContent: 'x',
    assistantMessageId: 'run-scope',
    conversationId: 'conversation',
    server: 'fs',
    tool,
    args,
    callId: 'call-7',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FilesystemAdapter call identity', () => {
  it('passes the run and call ids to a read', async () => {
    await new FilesystemAdapter().execute(
      invocation('read_file', { path: '/fixture/a.txt' }),
    );
    expect(io.readFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/fixture/a.txt',
        runId: 'run-scope',
        callId: 'call-7',
      }),
    );
  });

  it.each([
    ['list_directory', { path: '/fixture/items' }, 'listDirectory'],
    ['create_directory', { path: '/fixture/new' }, 'createDirectory'],
    ['delete_file', { path: '/fixture/a.txt' }, 'deleteFile'],
    ['delete', { dir: '/fixture', pattern: '*.tmp' }, 'deleteByPattern'],
    [
      'rename_file',
      { oldPath: '/fixture/a.txt', newPath: '/fixture/b.txt' },
      'renameFile',
    ],
  ])('passes the same ids through %s', async (tool, args, backend) => {
    await new FilesystemAdapter().execute(invocation(tool, args));

    expect(io[backend as keyof typeof io]).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-scope', callId: 'call-7' }),
    );
  });

  it('passes the same ids to a write and a batched delete', async () => {
    const adapter = new FilesystemAdapter();
    await adapter.execute(
      invocation('write_file', { path: '/fixture/a.txt', content: 'x' }),
    );
    await adapter.execute(invocation('rm', { paths: ['/fixture/a.txt'] }));

    expect(io.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-scope', callId: 'call-7' }),
    );
    expect(io.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        paths: ['/fixture/a.txt'],
        runId: 'run-scope',
        callId: 'call-7',
      }),
    );
  });
});
