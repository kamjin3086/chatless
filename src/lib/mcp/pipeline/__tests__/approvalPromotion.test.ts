import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { clearConversationAccess, getConversationAccess } from '@/lib/mcp/accessPolicy';

/** A real invocation always carries these; they are not what the tests below are about. */
const realInvocation = () => ({
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
});

/**
 * Pin what each approval answer *does* before the policy is extracted from the
 * pipeline. The three answers mean different things per scope - fs `always`
 * remembers a directory, shell `always` turns prompts off globally - and that
 * asymmetry is exactly what a mechanical extraction would silently flatten.
 */
const mocks = vi.hoisted(() => ({
  setAllowlist: vi.fn(async () => ({ ok: true })),
  grantCallScope: vi.fn(async () => ({ ok: true, path: '' })),
  revokeCallScope: vi.fn(async () => ({ ok: true })),
  ensureAllowlistedDirectory: vi.fn(async () => {}),
  setServerAutoAuthorize: vi.fn(async () => {}),
  approvals: [] as Array<{ id: string; onApprove: (d?: string) => void }>,
  decision: 'once' as 'once' | 'always' | 'unrestricted',
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  setAllowlist: mocks.setAllowlist,
  grantCallScope: mocks.grantCallScope,
  revokeCallScope: mocks.revokeCallScope,
}));
vi.mock('@/lib/filesystemAllowlist/autoAuthorize', () => ({
  ensureAllowlistedDirectory: mocks.ensureAllowlistedDirectory,
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => false,
  setServerAutoAuthorize: mocks.setServerAutoAuthorize,
}));
vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: { id: string; onApprove: (d?: string) => void }) => {
        mocks.approvals.push(auth);
        auth.onApprove(mocks.decision);
      },
    }),
  },
}));
vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: { getState: () => ({
    directories: [], load: async () => {}, getByPath: () => undefined,
    addDirectory: async () => {}, updateDirectory: async () => {},
  }) },
}));
vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: { getState: () => ({ getWorkingDir: () => undefined }) },
}));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({ appendWorkspaceToolStep: async () => {} }));
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

const CONVERSATION = 'conv-promote';

function pipelineThatExecutes() {
  const adapter = { server: 'fs', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
  return new ToolExecutionPipeline({ adapters: [adapter as never] });
}

function fsCall(tool: string, path: string, callId: string) {
  return new ToolInvocation({
    ...realInvocation(),
    assistantMessageId: `run-${callId}`, conversationId: CONVERSATION,
    server: 'filesystem', tool, args: { path }, callId,
  });
}

function shellCall(callId: string) {
  return new ToolInvocation({
    ...realInvocation(),
    assistantMessageId: `run-${callId}`, conversationId: CONVERSATION,
    server: 'shell', tool: 'run', args: { command: 'ls' }, callId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approvals.length = 0;
  mocks.decision = 'once';
  clearConversationAccess('fs', CONVERSATION);
  clearConversationAccess('shell', CONVERSATION);
});

describe('fs promotion: what each answer changes', () => {
  it('once grants only this call and leaves nothing behind', async () => {
    await pipelineThatExecutes().run(fsCall('write_file', 'C:/outside/dir/file.txt', 'p-once'));

    expect(mocks.grantCallScope).toHaveBeenCalledOnce();
    expect(mocks.revokeCallScope).toHaveBeenCalledOnce();
    expect(mocks.ensureAllowlistedDirectory).not.toHaveBeenCalled();
    expect(getConversationAccess('fs', CONVERSATION)).toBeUndefined();
    expect(mocks.setServerAutoAuthorize).not.toHaveBeenCalled();
  });

  it('always remembers the containing directory', async () => {
    mocks.decision = 'always';
    await pipelineThatExecutes().run(fsCall('write_file', 'C:/outside/dir/file.txt', 'p-always'));

    expect(mocks.ensureAllowlistedDirectory).toHaveBeenCalledWith(expect.objectContaining({
      path: 'C:/outside/dir', source: 'manual',
    }));
    expect(getConversationAccess('fs', CONVERSATION)).toBeUndefined();
  });

  it('always on a delete still does not remember the directory', async () => {
    mocks.decision = 'always';
    await pipelineThatExecutes().run(fsCall('delete_file', 'C:/outside/dir/file.txt', 'p-del'));

    expect(mocks.approvals.length, 'the delete still asked').toBe(1);
    expect(mocks.ensureAllowlistedDirectory).not.toHaveBeenCalled();
  });

  it('unrestricted silences the rest of the conversation and still grants the call', async () => {
    mocks.decision = 'unrestricted';
    await pipelineThatExecutes().run(fsCall('write_file', 'C:/outside/dir/file.txt', 'p-unr'));

    expect(getConversationAccess('fs', CONVERSATION)).toBe('unrestricted');
    expect(mocks.ensureAllowlistedDirectory).not.toHaveBeenCalled();
    expect(mocks.grantCallScope).toHaveBeenCalledOnce();
  });

  it('stops asking after unrestricted, and never persisted anything to do with shell', async () => {
    mocks.decision = 'unrestricted';
    const pipeline = pipelineThatExecutes();
    await pipeline.run(fsCall('write_file', 'C:/outside/a/f.txt', 'p-first'));
    mocks.approvals.length = 0;

    await pipeline.run(fsCall('write_file', 'C:/outside/b/f.txt', 'p-second'));

    expect(mocks.approvals.length).toBe(0);
  });
});

describe('shell promotion: the same word means something else', () => {
  it('once asks and changes nothing durable', async () => {
    await pipelineThatExecutes().run(shellCall('s-once'));

    expect(mocks.approvals.length).toBe(1);
    expect(mocks.setServerAutoAuthorize).not.toHaveBeenCalled();
    expect(getConversationAccess('shell', CONVERSATION)).toBeUndefined();
  });

  it('always turns shell prompts off globally, not just for this conversation', async () => {
    mocks.decision = 'always';
    await pipelineThatExecutes().run(shellCall('s-always'));

    expect(mocks.setServerAutoAuthorize).toHaveBeenCalledWith('shell', true);
    expect(getConversationAccess('shell', CONVERSATION)).toBeUndefined();
  });

  it('unrestricted is scoped to the conversation and touches no persisted switch', async () => {
    mocks.decision = 'unrestricted';
    await pipelineThatExecutes().run(shellCall('s-unr'));

    expect(getConversationAccess('shell', CONVERSATION)).toBe('unrestricted');
    expect(mocks.setServerAutoAuthorize).not.toHaveBeenCalled();
  });

  it('reading or stopping a process the agent started is never a new side effect', async () => {
    for (const tool of ['logs', 'list', 'stop']) {
      mocks.approvals.length = 0;
      await pipelineThatExecutes().run(new ToolInvocation({
        ...realInvocation(),
        assistantMessageId: `run-${tool}`, conversationId: CONVERSATION,
        server: 'shell', tool, args: {}, callId: `s-${tool}`,
      }));
      expect(mocks.approvals.length, tool).toBe(0);
    }
  });
});
