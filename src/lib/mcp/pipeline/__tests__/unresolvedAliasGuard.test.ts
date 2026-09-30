import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { clearConversationAccess } from '@/lib/mcp/accessPolicy';

const mocks = vi.hoisted(() => ({
  setAllowlist: vi.fn(async () => ({ ok: true })),
  grantCallScope: vi.fn(async () => ({ ok: true, path: '' })),
  revokeCallScope: vi.fn(async () => ({ ok: true })),
  appendWorkspaceToolStep: vi.fn(async () => {}),
  markError: vi.fn(),
  sessionWorkDir: undefined as string | undefined,
}));

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  setAllowlist: mocks.setAllowlist,
  grantCallScope: mocks.grantCallScope,
  revokeCallScope: mocks.revokeCallScope,
}));

vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: { onApprove: (decision?: string) => void }) => auth.onApprove('once'),
    }),
  },
}));

vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: { getState: () => ({
    directories: [],
    load: async () => {},
    getByPath: () => undefined,
    addDirectory: async () => {},
    updateDirectory: async () => {},
  }) },
}));

vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: {
    getState: () => ({
      getWorkingDir: () => mocks.sessionWorkDir,
      getMountedDir: () => undefined,
    }),
  },
}));

vi.mock('@/lib/mcp/authorizationConfig', () => ({ shouldAutoAuthorize: async () => false }));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: mocks.appendWorkspaceToolStep,
}));
vi.mock('../ToolCardUpdater', () => ({
  markError: mocks.markError, markPendingAuth: () => {}, markSuccess: () => {},
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
  mocks.sessionWorkDir = undefined;
  clearConversationAccess('fs', 'conv-1');
  clearConversationAccess('shell', 'conv-1');
});

const shellAdapter = () => ({
  server: 'shell',
  canHandle: () => true,
  execute: vi.fn(async () => ({ success: true, exitCode: 0, stdout: '', stderr: '' })),
});

const fsAdapter = () => ({
  server: 'filesystem',
  canHandle: () => true,
  execute: vi.fn(async () => ({ ok: true })),
});

const run = (pipeline: ToolExecutionPipeline, params: {
  server: string; tool: string; args: Record<string, unknown>; callId: string;
}) => pipeline.run(new ToolInvocation({
  assistantMessageId: 'run-1', conversationId: 'conv-1',
  server: params.server, tool: params.tool, args: params.args, callId: params.callId,
}));

describe('unresolved @Alias', () => {
  it('refuses a shell command whose @WorkDir has nowhere to point', async () => {
    const adapter = shellAdapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });

    const result: any = await run(pipeline, {
      server: 'shell', tool: 'run', args: { command: 'cd @WorkDir' }, callId: 'call-1',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_ALIAS' } });
    expect(String(result.error.message)).toContain('@WorkDir');
    // The whole point: no process is started, so no literal @WorkDir folder.
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('still resolves @WorkDir when the session has a working directory', async () => {
    mocks.sessionWorkDir = 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21';
    const adapter = shellAdapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });

    const result: any = await run(pipeline, {
      server: 'shell', tool: 'run', args: { command: 'cd @WorkDir' }, callId: 'call-2',
    });

    expect(result).toMatchObject({ success: true });
    expect(adapter.execute).toHaveBeenCalledOnce();
    const invocation = adapter.execute.mock.calls[0][0] as { args: { command: string; workingDir?: string } };
    expect(invocation.args.command).toBe(`cd ${mocks.sessionWorkDir}`);
    // The default working directory travels with the call, so the card and the
    // backend agree on where it runs.
    expect(invocation.args.workingDir).toBe(mocks.sessionWorkDir);
  });

  it('refuses a filesystem path that still carries an alias', async () => {
    const adapter = fsAdapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });

    const result: any = await run(pipeline, {
      server: 'filesystem', tool: 'write_file',
      args: { path: '@Project/notes.txt', content: 'x' }, callId: 'call-3',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_ALIAS' } });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('explains a relative path that cannot be resolved instead of forwarding it', async () => {
    const adapter = fsAdapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });

    const result: any = await run(pipeline, {
      server: 'filesystem', tool: 'read_file', args: { path: 'notes.txt' }, callId: 'call-4',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'UNRESOLVED_ALIAS' } });
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});
