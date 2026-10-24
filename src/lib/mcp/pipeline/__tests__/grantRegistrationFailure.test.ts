import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';

const mocks = vi.hoisted(() => ({
  grantCallScopedPaths: vi.fn(),
  execute: vi.fn(async () => ({ ok: true })),
  markError: vi.fn(),
}));

vi.mock('@/lib/filesystemAllowlist/backendSync', () => ({
  grantCallScopedPaths: mocks.grantCallScopedPaths,
  syncFilesystemAllowlistToBackend: vi.fn(async () => {}),
}));
vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: {
    getState: () => ({
      directories: [],
      load: async () => {},
      getByPath: () => undefined,
      addDirectory: async () => {},
      updateDirectory: async () => {},
    }),
  },
}));
vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: {
    getState: () => ({
      getWorkingDir: () => '/fixture/work',
      isSessionDirInUse: () => false,
      isWorkspaceMaterialized: () => true,
    }),
  },
}));
vi.mock('@/lib/mcp/accessPolicy', () => ({
  resolveAccess: async () => 'unrestricted',
  setConversationAccess: vi.fn(),
  clearConversationAccess: vi.fn(),
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => true,
}));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: vi.fn(async () => {}),
}));
vi.mock('../ToolCardUpdater', () => ({
  markError: mocks.markError,
  markPendingAuth: vi.fn(),
  markSuccess: vi.fn(),
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        getConnectionUrl: () => 'sqlite::memory:',
        executeTransaction: vi.fn(),
      }),
    }),
  },
}));

const invocation = () =>
  new ToolInvocation({
    provider: 'openai-compatible',
    model: 'gpt-fixture',
    historyForLlm: [],
    originalUserContent: 'read',
    assistantMessageId: 'run-grant',
    conversationId: 'conv-grant',
    server: 'fs',
    tool: 'read_file',
    args: { path: '@WorkDir/notes.txt' },
    callId: 'call-grant',
    cardId: 'card-grant',
    lockKey: 'lock-grant',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('call grant registration failure', () => {
  it('does not execute a call whose grant could not be established', async () => {
    mocks.grantCallScopedPaths.mockRejectedValue(
      new Error('grant command failed'),
    );
    const pipeline = new ToolExecutionPipeline({
      adapters: [
        {
          server: 'fs',
          canHandle: () => true,
          execute: mocks.execute,
        } as never,
      ],
    });

    const result: any = await pipeline.run(invocation());

    expect(mocks.grantCallScopedPaths).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      resultStatus: 'failed',
      error: { code: 'CALL_SCOPE_FAILED' },
    });
    expect(mocks.markError).toHaveBeenCalled();
  });

  it('executes normally when the grant is established', async () => {
    mocks.grantCallScopedPaths.mockResolvedValue(async () => {});
    const pipeline = new ToolExecutionPipeline({
      adapters: [
        {
          server: 'fs',
          canHandle: () => true,
          execute: mocks.execute,
        } as never,
      ],
    });

    await pipeline.run(invocation());

    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
