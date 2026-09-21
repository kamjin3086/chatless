import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { clearSessionDirectories } from '@/lib/filesystemAllowlist/sessionGrants';

const mocks = vi.hoisted(() => ({
  setAllowlist: vi.fn(async () => ({ ok: true })),
  grantCallScope: vi.fn(async () => ({ ok: true, path: '' })),
  revokeCallScope: vi.fn(async () => ({ ok: true })),
  appendWorkspaceToolStep: vi.fn(async () => {}),
  approvals: [] as Array<{ id: string; onApprove: (decision?: 'once' | 'session' | 'always') => void }>,
  decision: 'once' as 'once' | 'session' | 'always',
  addedDirectories: [] as Array<{ path: string; permissions: Record<string, boolean> }>,
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  setAllowlist: mocks.setAllowlist,
  grantCallScope: mocks.grantCallScope,
  revokeCallScope: mocks.revokeCallScope,
}));

vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: { id: string; onApprove: (decision?: 'once' | 'session' | 'always') => void }) => {
        mocks.approvals.push(auth);
        // Simulate the user's decision; "允许本次" by default.
        auth.onApprove(mocks.decision);
      },
    }),
  },
}));

vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: { getState: () => ({
    directories: [],
    load: async () => {},
    getByPath: () => undefined,
    addDirectory: async (directory: { path: string; permissions: Record<string, boolean> }) => {
      mocks.addedDirectories.push(directory);
    },
    updateDirectory: async (_id: string, patch: { path: string; permissions: Record<string, boolean> }) => {
      mocks.addedDirectories.push(patch);
    },
  }) },
}));

vi.mock('@/store/shellAuthStore', () => ({
  isShellCommandTrusted: () => false,
  useShellAuthStore: { getState: () => ({ load: async () => {} }) },
}));

vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: { getState: () => ({ getWorkingDir: () => undefined }) },
}));

vi.mock('@/lib/mcp/authorizationConfig', () => ({ shouldAutoAuthorize: async () => false }));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: mocks.appendWorkspaceToolStep,
}));
vi.mock('../ToolCardUpdater', () => ({
  markError: () => {}, markPendingAuth: () => {}, markSuccess: () => {},
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        getConnectionUrl: () => 'sqlite::memory:',
        executeTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: async () => {} }),
      }),
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approvals.length = 0;
  mocks.addedDirectories.length = 0;
  mocks.decision = 'once';
  clearSessionDirectories('conv-1');
});

describe('one-time filesystem approval', () => {
  it('grants the approved call without writing the persistent allowlist', async () => {
    const adapter = {
      server: 'filesystem',
      canHandle: () => true,
      execute: vi.fn(async () => ({ ok: true })),
    };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    const invocation = new ToolInvocation({
      assistantMessageId: 'run-1',
      conversationId: 'conv-1',
      server: 'filesystem',
      tool: 'write_file',
      args: { path: 'C:/outside/dir/file.txt', content: 'hello' },
      callId: 'call-1',
    });

    const result = await pipeline.run(invocation);

    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
    expect(mocks.grantCallScope).toHaveBeenCalledWith({
      runId: 'run-1', callId: 'call-1', path: 'C:/outside/dir',
      read: false, write: true, create: false, delete: false,
    });
    // The approval must never become a persistent authorization.
    const persistedPaths = mocks.setAllowlist.mock.calls
      .flatMap((call) => ((call[0] as { directories?: Array<{ path: string }> })?.directories || []).map((d) => d.path));
    expect(persistedPaths).toEqual([]);
    expect(mocks.revokeCallScope).toHaveBeenCalledWith({ runId: 'run-1', callId: 'call-1' });
  });

  it('binds a delete approval to the exact target instead of its parent', async () => {
    const adapter = {
      server: 'filesystem',
      canHandle: () => true,
      execute: vi.fn(async () => ({ ok: true })),
    };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    const invocation = new ToolInvocation({
      assistantMessageId: 'run-2',
      conversationId: 'conv-1',
      server: 'filesystem',
      tool: 'delete_file',
      args: { path: 'C:/outside/dir/file.txt' },
      callId: 'call-2',
    });

    await pipeline.run(invocation);

    expect(mocks.grantCallScope).toHaveBeenCalledWith({
      runId: 'run-2', callId: 'call-2', path: 'C:/outside/dir/file.txt',
      read: true, write: false, create: false, delete: true,
    });
  });
});

describe('directory-level filesystem approval', () => {
  const adapter = () => ({
    server: 'filesystem',
    canHandle: () => true,
    execute: vi.fn(async () => ({ ok: true })),
  });

  const write = (pipeline: ToolExecutionPipeline, id: string, path: string) => pipeline.run(
    new ToolInvocation({
      assistantMessageId: id,
      conversationId: 'conv-1',
      server: 'filesystem',
      tool: 'write_file',
      args: { path, content: 'hello' },
      callId: id,
    }),
  );

  it('stops asking for the same folder after "this session" is chosen', async () => {
    const exec = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [exec as never] });
    mocks.decision = 'session';

    await write(pipeline, 'run-a', 'C:/outside/dir/first.txt');
    expect(mocks.approvals).toHaveLength(1);
    // The session grant itself must never reach the persistent allowlist.
    expect(mocks.addedDirectories).toEqual([]);

    mocks.grantCallScope.mockClear();
    await write(pipeline, 'run-b', 'C:/outside/dir/second.txt');

    expect(mocks.approvals).toHaveLength(1);
    expect(mocks.grantCallScope).toHaveBeenCalledWith({
      runId: 'run-b', callId: 'run-b', path: 'C:/outside/dir',
      read: true, write: true, create: true, delete: false,
    });
  });

  it('persists the folder without delete after "always" is chosen', async () => {
    const exec = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [exec as never] });
    mocks.decision = 'always';

    await write(pipeline, 'run-c', 'C:/outside/keep/file.txt');

    expect(mocks.addedDirectories).toEqual([
      expect.objectContaining({ path: 'C:/outside/keep',
        permissions: { read: true, write: true, create: true, delete: false } }),
    ]);
  });
});
