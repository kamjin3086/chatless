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
const totals = {
  scanned: 3,
  matched: 3,
  files: 2,
  directories: 0,
  bytes: 1600,
  unknownMetadata: 1,
  stopped: '',
  elapsedMs: 12,
};
const snapshot = {
  status: 'ready',
  folder,
  entries: [image, unknownSize, text],
  omissions: [omission],
  totals,
  groups: [],
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
    if (command === 'android_directory_roots') {
      // Authorized folders are the app's, so every chat sees the same list (#228).
      return {
        roots: [
          {
            uri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload',
            name: '整理测试',
            agentEnabled: true,
          },
        ],
      };
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
  it('discovers inventory in every Android chat, never on desktop', async () => {
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
    expect(
      ((await search(selectedChat)) as { results: unknown }).results,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          server: 'android_directory',
          name: 'inventory',
        }),
        expect.objectContaining({
          server: 'android_directory',
          name: 'summarize',
        }),
        expect.objectContaining({
          server: 'android_directory',
          name: 'export',
        }),
      ]),
    );
    // Authorized folders belong to the app: another conversation reads them without picking
    // again, which is the whole point of #227/#228.
    expect((await buildCatalog('other')).nativeTools).toContainEqual(
      expect.objectContaining({ name: 'android_directory__inventory' }),
    );
    expect(((await search('other')) as { results: unknown }).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'inventory' }),
        expect.objectContaining({ name: 'summarize' }),
      ]),
    );
    mocks.platform.mockReturnValue('linux');
    mocks.invoke.mockClear();
    expect(await search(selectedChat)).toMatchObject({ results: [] });
    expect(await run()).toMatchObject({ error: 'NO_ADAPTER' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('sends the filters down and answers with what the device read', async () => {
    // Filtering belongs to the walk: a folder of thousands filtered after a row cap answers
    // "none" for matches sitting past the cap. TypeScript no longer filters anything itself.
    mocks.invoke.mockResolvedValue({
      status: 'ready',
      folder,
      entries: [image],
      omissions: [omission],
      groups: [
        { label: 'image/png', count: 1, bytes: 800, samples: ['holiday.png'] },
      ],
      totals: { ...totals, scanned: 4000, matched: 1, files: 4000 },
    });
    expect(
      await run({
        args: { mimeType: 'image/', minBytes: 100, groupBy: 'type' },
        planOnly: true,
      }),
    ).toMatchObject({
      ok: true,
      folder,
      entries: [{ handle: image.handle }],
      groups: [{ label: 'image/png', count: 1 }],
      omissions: [omission],
      totals: { scanned: 4000, matched: 1 },
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      'inventory_android_directory',
      expect.objectContaining({
        conversationId: selectedChat,
        root: null,
        under: null,
        mimeType: 'image/',
        minBytes: 100,
        groupBy: 'type',
        limit: 200,
        offset: 0,
      }),
    );
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('pages with the arguments it was given and says when a page is not the folder', async () => {
    mocks.invoke.mockResolvedValue({
      ...snapshot,
      totals: { ...totals, stopped: 'limit', matched: 200 },
    });
    const result = await run({ args: { limit: 200, offset: 200 } });
    expect(result).toMatchObject({ totals: { stopped: 'limit' } });
    expect(String((result as { hint?: string }).hint)).toContain('offset');
    expect(mocks.invoke).toHaveBeenCalledWith(
      'inventory_android_directory',
      expect.objectContaining({ limit: 200, offset: 200 }),
    );
  });

  it('answers a folder as counts when the chat asks for its shape', async () => {
    mocks.invoke.mockResolvedValue({
      status: 'ready',
      folder,
      entries: [],
      omissions: [],
      groups: [
        {
          label: 'jpg file',
          count: 2312,
          bytes: 1_200_000_000,
          samples: ['IMG_1.jpg'],
        },
        {
          label: 'png file',
          count: 1804,
          bytes: 900_000_000,
          samples: ['截图.png'],
        },
      ],
      largest: [
        {
          handle: image.handle,
          path: '录像/旅行.mp4',
          sizeBytes: 800,
          modifiedAt: 1,
        },
      ],
      newest: [
        {
          handle: image.handle,
          path: '报告.docx',
          sizeBytes: 800,
          modifiedAt: 2,
        },
      ],
      oldest: [],
      totals: {
        scanned: 5100,
        matched: 5000,
        files: 5000,
        directories: 100,
        bytes: 2_100_000_000,
        unknownMetadata: 0,
        stopped: '',
        elapsedMs: 900,
      },
    });
    const summary = await run({ tool: 'summarize' });
    expect(summary).toMatchObject({
      ok: true,
      groups: [
        { label: 'jpg file', count: 2312, bytes: 1_200_000_000 },
        { label: 'png file', count: 1804 },
      ],
      totals: { files: 5000, directories: 100, stopped: '' },
      newest: [{ path: '报告.docx' }],
      folders: [{ name: 'Inbox' }],
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      'summarize_android_directory',
      expect.objectContaining({ conversationId: selectedChat, groupBy: null }),
    );
  });

  it('writes a listing out instead of reciting it into the chat', async () => {
    // A new file in Downloads is a create, so it goes through approval like one.
    mocks.ask.mockResolvedValue({
      approved: true,
      decision: 'once',
      revision: 0,
    });
    mocks.invoke.mockResolvedValue({
      status: 'saved',
      name: '文件清单-20261124-1310.md',
      uri: 'content://media/external/downloads/7',
      count: 5000,
      bytes: 2_100_000_000,
      format: 'md',
      columns: ['path', 'size', 'date'],
      stopped: '',
    });
    expect(
      await run({ tool: 'export', args: { title: '文件清单' } }),
    ).toMatchObject({
      ok: true,
      written: true,
      file: '文件清单-20261124-1310.md',
      count: 5000,
      format: 'md',
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      'export_android_directory',
      expect.objectContaining({
        title: '文件清单',
        format: 'md',
        columns: null,
      }),
    );
  });

  it('says nothing was written when nothing matched, instead of failing at the model', async () => {
    mocks.ask.mockResolvedValue({
      approved: true,
      decision: 'once',
      revision: 0,
    });
    mocks.invoke.mockResolvedValue({ status: 'empty' });
    expect(
      await run({ tool: 'export', args: { nameContains: 'xyz' } }),
    ).toMatchObject({
      ok: true,
      empty: true,
      written: false,
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
