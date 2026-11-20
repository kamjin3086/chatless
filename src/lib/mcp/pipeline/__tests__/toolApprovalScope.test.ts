import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { clearConversationAccess } from '@/lib/mcp/accessPolicy';
import { useConversationAccessStore } from '@/store/conversationAccessStore';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

/** A real invocation always carries these; they are not what the tests below are about. */
const realInvocation = () => ({
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
});

const mocks = vi.hoisted(() => ({
  setAllowlist: vi.fn(async () => ({ ok: true })),
  grantCallScope: vi.fn(async (params: { path: string }) => ({ ok: true, path: params.path })),
  revokeCallScope: vi.fn(async () => ({ ok: true })),
  appendWorkspaceToolStep: vi.fn(async () => {}),
  approvals: [] as Array<{ id: string; onApprove: (decision?: 'once' | 'always' | 'unrestricted') => void }>,
  decision: 'once' as 'once' | 'always' | 'unrestricted',
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
      addPendingAuthorization: (auth: { id: string; onApprove: (decision?: 'once' | 'always' | 'unrestricted') => void }) => {
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
  useConversationAccessStore.setState({ conversations: {} });
  useConversationAttachmentStore.setState({ mountedDirByConversation: {}, sessionDirByConversation: {} });
  mocks.approvals.length = 0;
  mocks.addedDirectories.length = 0;
  mocks.decision = 'once';
  clearConversationAccess('fs', 'conv-1');
  clearConversationAccess('shell', 'conv-1');
});

describe('unified conversation approval', () => {
  let sequence = 0;
  const execute = async (pipeline: ToolExecutionPipeline, tool: string, conversationId = 'conv-1', server = 'knowledge') => pipeline.run(new ToolInvocation({
    ...realInvocation(), server, tool, args: {}, conversationId,
    assistantMessageId: `${conversationId}-${tool}-${++sequence}`, callId: `${conversationId}-${tool}-${sequence}`,
  }));
  it('grants Knowledge reads across turns only in the approved conversation and supports revocation', async () => {
    const adapter = { server: 'knowledge', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    mocks.decision = 'unrestricted';
    await execute(pipeline, 'search'); await execute(pipeline, 'read'); await execute(pipeline, 'list');
    expect(mocks.approvals).toHaveLength(1);
    await execute(pipeline, 'read', 'conv-2'); expect(mocks.approvals).toHaveLength(2);
    useConversationAccessStore.getState().revoke('conv-1');
    await execute(pipeline, 'read'); expect(mocks.approvals).toHaveLength(3);
  });
  it('automatic mode bypasses eligible prompts but never leaks to another conversation', async () => {
    const adapter = { server: 'knowledge', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    useConversationAccessStore.getState().setAutomatic('conv-1', true);
    await execute(pipeline, 'search'); await execute(pipeline, 'read');
    expect(mocks.approvals).toHaveLength(0);
    await execute(pipeline, 'read', 'conv-2'); expect(mocks.approvals).toHaveLength(1);
    useConversationAccessStore.getState().revoke('conv-1');
    await execute(pipeline, 'read'); expect(mocks.approvals).toHaveLength(2);
  });
  it('does not extend a read grant to Knowledge mutations or other tools on an MCP server', async () => {
    const adapter = { server: 'knowledge', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    mocks.decision = 'unrestricted';
    await execute(pipeline, 'search');
    await execute(pipeline, 'delete_document');
    await execute(pipeline, 'search', 'conv-1', 'calendar');
    await execute(pipeline, 'create', 'conv-1', 'calendar');
    expect(mocks.approvals).toHaveLength(4);
  });
  it('keeps mandatory administrative prompts in automatic mode', async () => {
    const adapter = { server: 'system', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    useConversationAccessStore.getState().setAutomatic('conv-1', true);
    await execute(pipeline, 'delete_prompt', 'conv-1', 'system');
    expect(mocks.approvals).toHaveLength(1);
    expect(mocks.approvals[0]).toMatchObject({ scope: { automaticEligible: false } });
  });
  it('automatic mode still asks for an unknown filesystem range', async () => {
    useConversationAccessStore.getState().setAutomatic('conv-1', true);
    const adapter = { server: 'filesystem', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    await new ToolExecutionPipeline({ adapters: [adapter as never] }).run(new ToolInvocation({ ...realInvocation(), server: 'filesystem', tool: 'write_file', args: { path: 'C:/new-scope/file.txt', content: 'test' }, conversationId: 'conv-1', assistantMessageId: 'unknown-range', callId: 'unknown-range' }));
    expect(mocks.approvals).toHaveLength(1);
  });
});

describe('one-time filesystem approval', () => {
  it('requires approval for project files even in automatic mode', async () => {
    const store = useConversationAttachmentStore.getState();
    store.setMountedDir('conv-1', 'C:/project');
    store.setWorkingDir('conv-1', 'C:/Chatless/session');
    useConversationAccessStore.getState().setAutomatic('conv-1', true);

    const adapter = { server: 'filesystem', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    const write = (path: string, callId: string) => pipeline.run(new ToolInvocation({
      ...realInvocation(), conversationId: 'conv-1', assistantMessageId: 'project-membership', callId,
      server: 'filesystem', tool: 'write_file', args: { path, content: 'test' },
    }));

    await write('@WorkDir/output.txt', 'session-output');
    expect(adapter.execute).toHaveBeenCalledOnce();
    expect(mocks.grantCallScope).toHaveBeenCalledWith(expect.objectContaining({ path: 'C:/Chatless/session' }));
    expect(mocks.approvals).toHaveLength(0);

    await write('C:/project/draft.txt', 'project-file');
    expect(mocks.approvals).toHaveLength(1);
    expect(mocks.grantCallScope).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'project-file', path: 'C:/project', read: false, write: true, create: false, delete: false,
    }));
    expect(mocks.addedDirectories).toEqual([]);
  });

  it('grants the approved call without writing the persistent allowlist', async () => {
    const adapter = {
      server: 'filesystem',
      canHandle: () => true,
      execute: vi.fn(async () => ({ ok: true })),
    };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });
    const invocation = new ToolInvocation({
      ...realInvocation(),
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
      .flatMap((call) => (((call as unknown as Array<{ directories?: Array<{ path: string }> }>)[0])?.directories || []).map((d) => d.path));
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
      ...realInvocation(),
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
      ...realInvocation(),
      assistantMessageId: id,
      conversationId: 'conv-1',
      server: 'filesystem',
      tool: 'write_file',
      args: { path, content: 'hello' },
      callId: id,
    }),
  );

  it('remembers the approved directory without granting other folders or delete', async () => {
    const exec = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [exec as never] });
    mocks.decision = 'unrestricted';

    await write(pipeline, 'run-a', 'C:/outside/dir/first.txt');
    expect(mocks.approvals).toHaveLength(1);
    // Turning prompts off for the session must not touch the allowlist.
    expect(mocks.addedDirectories).toEqual([]);

    mocks.grantCallScope.mockClear();
    await write(pipeline, 'run-same-folder', 'C:/outside/dir/second.txt');
    expect(mocks.approvals).toHaveLength(1);
    // New ranges and deletion permissions still require explicit authorization.
    await write(pipeline, 'run-b', 'D:/elsewhere/second.txt');
    await pipeline.run(new ToolInvocation({
      ...realInvocation(),
      assistantMessageId: 'run-c',
      conversationId: 'conv-1',
      server: 'filesystem',
      tool: 'delete_file',
      args: { path: 'D:/elsewhere/second.txt' },
      callId: 'run-c',
    }));

    expect(mocks.approvals).toHaveLength(3);
    expect(mocks.grantCallScope).toHaveBeenCalledWith({
      runId: 'run-b', callId: 'run-b', path: 'D:/elsewhere',
      read: false, write: true, create: false, delete: false,
    });
  });

  it('persists the folder without delete after "以后都允许" is chosen', async () => {
    const exec = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [exec as never] });
    mocks.decision = 'always';

    await write(pipeline, 'run-c', 'C:/outside/keep/file.txt');

    expect(mocks.addedDirectories).toEqual([
      expect.objectContaining({ path: 'C:/outside/keep',
        permissions: { read: true, write: true, create: true, delete: false } }),
    ]);
  });

  it('stops asking for shell commands after the user turns prompts off', async () => {
    const exec = {
      server: 'shell',
      canHandle: () => true,
      execute: vi.fn(async () => ({ ok: true })),
    };
    const pipeline = new ToolExecutionPipeline({ adapters: [exec as never] });
    mocks.decision = 'unrestricted';
    const run = (id: string, command: string) => pipeline.run(new ToolInvocation({
      ...realInvocation(),
      assistantMessageId: id,
      conversationId: 'conv-1',
      server: 'shell',
      tool: 'run',
      args: { shell: 'cmd', command },
      callId: id,
    }));

    await run('run-shell-a', 'echo %USERPROFILE%');
    expect(mocks.approvals).toHaveLength(1);
    // The card knows it is approving a command, not a path.
    expect(mocks.approvals[0]).toMatchObject({ scope: { kind: 'shell', command: 'echo %USERPROFILE%' } });

    await run('run-shell-b', 'git status');
    expect(mocks.approvals).toHaveLength(1);
    expect(exec.execute).toHaveBeenCalledTimes(2);
  });

  it('asks before starting a background process but never for logs, list or stop', async () => {
    const exec = {
      server: 'shell',
      canHandle: () => true,
      execute: vi.fn(async () => ({ ok: true })),
    };
    const pipeline = new ToolExecutionPipeline({ adapters: [exec as never] });
    const run = (id: string, tool: string, args: Record<string, unknown>) => pipeline.run(new ToolInvocation({
      ...realInvocation(),
      assistantMessageId: id,
      conversationId: 'conv-1',
      server: 'shell',
      tool,
      args,
      callId: id,
    }));

    // Starting a server is a side effect: it goes through the approval card.
    await run('run-start', 'start', { command: 'pnpm dev' });
    expect(mocks.approvals).toHaveLength(1);
    expect(mocks.approvals[0]).toMatchObject({ scope: { kind: 'shell', command: 'pnpm dev' } });

    // Reading, listing and stopping a process the agent started do not.
    await run('run-logs', 'logs', { executionId: 'shell:run-start:card' });
    await run('run-list', 'list', {});
    await run('run-stop', 'stop', { executionId: 'shell:run-start:card' });
    expect(mocks.approvals).toHaveLength(1);
    expect(exec.execute).toHaveBeenCalledTimes(4);
  });
});
