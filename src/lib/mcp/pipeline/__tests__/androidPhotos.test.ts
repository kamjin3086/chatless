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

const original = {
  handle: 'opaque-original',
  name: 'IMG_4021.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 3_200_000,
  contentDigest: 'bytes-of-4021',
};
const copy = {
  ...original,
  handle: 'opaque-copy',
  name: 'IMG_4021 (1).jpg',
};
const screenshot = {
  handle: 'opaque-screenshot',
  name: 'Screenshot_20260101-120000.png',
  mimeType: 'image/png',
  sizeBytes: 210_000,
  contentDigest: 'bytes-of-screenshot',
};
const uncompared = {
  handle: 'opaque-uncompared',
  name: 'IMG_5000.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 8_400_000,
  contentDigest: null,
};
const snapshot = {
  status: 'ready',
  count: 4,
  items: [original, copy, screenshot, uncompared],
  omissions: [{ reason: 'unreadable' }],
};
const selectedChat = 'with-photos';
let turn = 0;

function run({
  conversationId = selectedChat,
  server = 'android_photos',
  tool = 'group',
  args = {},
  planOnly = false,
}: {
  conversationId?: string;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  planOnly?: boolean;
} = {}) {
  const id = `photos-${++turn}`;
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
      originalUserContent: 'Group the photos I selected.',
    }),
  );
}

function buildCatalog(conversationId: string) {
  return buildInitialPrompt(
    {
      userContent: 'Group the photos I selected.',
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
    if (command === 'android_photo_batch_selection') {
      return args?.conversationId === selectedChat
        ? { status: 'ready', count: snapshot.count }
        : { status: 'none' };
    }
    if (command === 'inventory_android_photo_batch') {
      return args?.conversationId === selectedChat
        ? snapshot
        : { status: 'none' };
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
});

describe('Android photo organization tool scope', () => {
  it('discovers grouping in the active Android chat with a selected batch, not elsewhere', async () => {
    const search = (conversationId: string) =>
      run({
        conversationId,
        server: 'tools',
        tool: 'search',
        args: { query: 'android_photos' },
      });
    const { nativeTools } = await buildCatalog(selectedChat);
    expect(nativeTools).toContainEqual(
      expect.objectContaining({
        name: 'android_photos__group',
        description: expect.stringMatching(/proposal.*omissions/i),
      }),
    );
    expect(await search(selectedChat)).toMatchObject({
      results: [{ server: 'android_photos', name: 'group', source: 'builtin' }],
    });
    expect((await buildCatalog('other')).nativeTools).not.toContainEqual(
      expect.objectContaining({ name: 'android_photos__group' }),
    );
    expect(await search('other')).toMatchObject({ results: [] });
    mocks.platform.mockReturnValue('linux');
    mocks.invoke.mockClear();
    expect(await search(selectedChat)).toMatchObject({ results: [] });
    expect(await run()).toMatchObject({ error: 'NO_ADAPTER' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('groups the selected batch by identical bytes and screenshot names without a new approval', async () => {
    const result = await run({ planOnly: true });
    expect(result).toMatchObject({
      ok: true,
      count: 4,
      groups: [
        {
          signal: 'duplicate',
          items: [
            { handle: original.handle, name: original.name },
            { handle: copy.handle, name: copy.name },
          ],
        },
        {
          signal: 'screenshot',
          items: [{ handle: screenshot.handle, name: screenshot.name }],
        },
      ],
      ungrouped: [{ handle: uncompared.handle, name: uncompared.name }],
      omissions: [
        { reason: 'unreadable' },
        { reason: 'duplicate_check_skipped', name: uncompared.name },
      ],
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'inventory_android_photo_batch',
      { conversationId: selectedChat },
    );
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('sends the model handles and names, never photo content or local URIs', async () => {
    const serialized = JSON.stringify(await run());
    expect(serialized).not.toMatch(/content:\/\//);
    expect(serialized).not.toMatch(/data:image/);
    expect(serialized).not.toContain('contentDigest');
    expect(serialized).not.toContain(original.contentDigest);
  });

  it.each([
    { path: '/sdcard/DCIM/Camera' },
    { uri: 'content://media/external/images/1' },
    { handle: 'opaque-copy' },
    { conversationId: selectedChat },
  ])('rejects invented scope arguments: %o', async (args) => {
    expect(await run({ conversationId: 'other', args })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not resolve another conversation, invent a selection, or route mutations', async () => {
    expect(await run({ conversationId: 'other' })).toMatchObject({
      ok: false,
      error: { code: 'PHOTOS_NOT_SELECTED' },
    });
    mocks.invoke.mockResolvedValue({ status: 'unavailable' });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'PHOTOS_UNAVAILABLE' },
    });
    expect(await run({ tool: 'move' })).toMatchObject({ error: 'NO_ADAPTER' });
    expect(await run({ tool: 'delete' })).toMatchObject({
      error: 'NO_ADAPTER',
    });
    expect(mocks.connectRemote).not.toHaveBeenCalled();
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});
