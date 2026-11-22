import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInitialPrompt } from '@/lib/mcp/injection/promptBuilder';
import { createDefaultAdapters } from '../adapters';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  platform: vi.fn(),
  ask: vi.fn(),
  connectRemote: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()),
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: mocks.platform }));
vi.mock('@/lib/mcp/chatIntegration', () => ({
  getEnabledConfiguredServers: async () => [],
}));
vi.mock('@/lib/mcp/executor/ConnectionManager', () => ({
  ensureServerConnected: mocks.connectRemote,
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => false,
}));
vi.mock('../approvalWait', () => ({ waitForCallApproval: mocks.ask }));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: async () => {},
}));

const folder = { handle: 'opaque-root', name: 'Inbox' };
const image = {
  handle: 'opaque-image',
  parentHandle: folder.handle,
  name: 'holiday.png',
  kind: 'file',
  mimeType: 'image/png',
  sizeBytes: 800,
  modifiedAt: 1767230000000,
};
const unknownSize = {
  ...image,
  handle: 'opaque-unknown',
  name: 'camera.png',
  sizeBytes: null,
};
const text = {
  ...image,
  handle: 'opaque-text',
  name: 'notes.txt',
  mimeType: 'text/plain',
};
const omission = {
  reason: 'unreadable',
  parentHandle: folder.handle,
  handle: 'opaque-locked',
  name: 'Locked',
};
const snapshot = {
  status: 'ready',
  folder,
  entries: [image, unknownSize, text],
  omissions: [omission],
};
const selectedChat = 'with-directory';
let turn = 0;

function run({
  conversationId = selectedChat,
  server = 'android_directory',
  tool = 'inventory',
  args = {},
  planOnly = false,
}: {
  conversationId?: string;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  planOnly?: boolean;
} = {}) {
  const id = `directory-${++turn}`;
  return new ToolExecutionPipeline({ adapters: createDefaultAdapters() }).run(
    new ToolInvocation({
      server,
      tool,
      args,
      planOnly,
      conversationId,
      assistantMessageId: id,
      callId: id,
      provider: 'OpenAI',
      model: 'gpt-4o',
      historyForLlm: [],
      originalUserContent: 'Organize my folder.',
    }),
  );
}

function buildCatalog(conversationId: string) {
  return buildInitialPrompt(
    {
      userContent: 'Organize my folder.',
      phase: 'initial',
      providerName: 'OpenAI',
      modelName: 'gpt-4o',
      conversationId,
    },
    {
      hasExplicitMention: false,
      mentionedServers: [],
      webSearchEnabled: false,
      hasToolKeywords: false,
      hasPreviousToolUse: false,
      isTimeRelated: false,
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.mockReturnValue('android');
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'android_directory_selection') {
      return args?.conversationId === selectedChat
        ? { status: 'ready', folder }
        : { status: 'none' };
    }
    if (command === 'inventory_android_directory') {
      return args?.conversationId === selectedChat
        ? snapshot
        : { status: 'none' };
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
});

describe('Android directory tool scope', () => {
  it('discovers inventory in the active Android chat, not in another chat or on desktop', async () => {
    const search = (conversationId: string) =>
      run({
        conversationId,
        server: 'tools',
        tool: 'search',
        args: { query: 'android_directory' },
      });
    const { nativeTools } = await buildCatalog(selectedChat);
    expect(nativeTools).toContainEqual(
      expect.objectContaining({
        name: 'android_directory__inventory',
        description: expect.stringMatching(/proposal.*omissions/i),
      }),
    );
    expect(await search(selectedChat)).toMatchObject({
      results: [
        { server: 'android_directory', name: 'inventory', source: 'builtin' },
      ],
    });
    expect((await buildCatalog('other')).nativeTools).not.toContainEqual(
      expect.objectContaining({ name: 'android_directory__inventory' }),
    );
    expect(await search('other')).toMatchObject({ results: [] });
    mocks.platform.mockReturnValue('linux');
    mocks.invoke.mockClear();
    expect(await search(selectedChat)).toMatchObject({ results: [] });
    expect(await run()).toMatchObject({ error: 'NO_ADAPTER' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('filters and groups only metadata from the conversation selection and reports omissions in plan mode', async () => {
    expect(
      await run({
        args: { mimeType: 'image/', minBytes: 100, groupBy: 'type' },
        planOnly: true,
      }),
    ).toMatchObject({
      ok: true,
      folder,
      entries: [image],
      groups: [{ label: 'image/png', handles: [image.handle] }],
      omissions: [omission],
      excludedForUnknownMetadata: [
        expect.objectContaining({
          handle: unknownSize.handle,
          name: unknownSize.name,
        }),
      ],
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'inventory_android_directory',
      { conversationId: selectedChat },
    );
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('groups by size band or UTC month without mislabeling missing metadata', async () => {
    const missing = { ...unknownSize, modifiedAt: null };
    const newer = {
      ...text,
      sizeBytes: 10 * 1024 * 1024,
      modifiedAt: Date.UTC(2026, 1, 1),
    };
    mocks.invoke.mockResolvedValue({
      ...snapshot,
      entries: [image, missing, newer],
    });
    expect(await run({ args: { groupBy: 'size' } })).toMatchObject({
      groups: [
        { label: 'Under 1 MiB', handles: [image.handle] },
        { label: 'Unknown size', handles: [missing.handle] },
        { label: '10 MiB or more', handles: [newer.handle] },
      ],
    });
    expect(
      await run({ args: { groupBy: 'date', modifiedFrom: newer.modifiedAt } }),
    ).toMatchObject({
      groups: [{ label: '2026-02', handles: [newer.handle] }],
      filteredOut: 1,
      excludedForUnknownMetadata: [
        expect.objectContaining({ handle: missing.handle }),
      ],
    });
  });

  it.each([
    { path: '/sdcard/Downloads' },
    { uri: 'content://external/tree/elsewhere' },
    { handle: 'forged' },
    { conversationId: selectedChat },
  ])('rejects invented scope arguments: %o', async (args) => {
    expect(await run({ conversationId: 'other', args })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FILTER' },
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not resolve another conversation, approve a stale grant, or route mutations', async () => {
    expect(await run({ conversationId: 'other' })).toMatchObject({
      ok: false,
      error: { code: 'DIRECTORY_NOT_SELECTED' },
    });
    mocks.invoke.mockResolvedValue({ status: 'revoked' });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'DIRECTORY_ACCESS_LOST' },
    });
    expect(await run({ tool: 'move' })).toMatchObject({ error: 'NO_ADAPTER' });
    expect(await run({ tool: 'forget' })).toMatchObject({
      error: 'NO_ADAPTER',
    });
    expect(mocks.connectRemote).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
