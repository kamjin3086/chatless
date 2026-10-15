import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { clearConversationAccess } from '@/lib/mcp/accessPolicy';

/** A real invocation always carries these; they are not what the tests below are about. */
const REAL_INVOCATION = {
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
};

/**
 * 这几条钉的是文件系统门在 run() 这个接缝上必须表现出的行为，全部来自契约里
 * "行为必须原样保留"的清单。它们刻意不调用私有的 filesystemGate：门是实现细节，
 * 该被钉住的是调用方看得见的结果。拆分之前它们一条都不存在，所以等价性当时
 * 只有文本 diff 背书。
 */
const mocks = vi.hoisted(() => ({
  loadAllowlist: vi.fn(async () => {}),
  grantCallScope: vi.fn(async () => ({ ok: true, path: '' })),
  revokeCallScope: vi.fn(async () => ({ ok: true })),
  appendWorkspaceToolStep: vi.fn(async () => {}),
  resolverThrows: false,
  loadFail: false,
  approvals: [] as Array<{ id: string; onApprove: (d?: 'once' | 'always' | 'unrestricted') => void; onReject: () => void }>,
  answer: 'approve' as 'approve' | 'reject',
  decision: 'once' as 'once' | 'always' | 'unrestricted',
}));

vi.mock('@/lib/filesystemAllowlist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/filesystemAllowlist')>();
  return {
    ...actual,
    resolveAllowlistPath: (params: unknown) => {
      if (mocks.resolverThrows) throw new Error('gate boom');
      return (actual.resolveAllowlistPath as (p: unknown) => unknown)(params);
    },
  };
});

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  setAllowlist: vi.fn(async () => ({ ok: true })),
  grantCallScope: mocks.grantCallScope,
  revokeCallScope: mocks.revokeCallScope,
}));

vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: { id: string; onApprove: (d?: 'once' | 'always' | 'unrestricted') => void; onReject: () => void }) => {
        mocks.approvals.push(auth);
        if (mocks.answer === 'approve') auth.onApprove(mocks.decision);
        else auth.onReject();
      },
    }),
  },
}));

vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: { getState: () => ({
    directories: [],
    load: async () => { mocks.loadAllowlist(); if (mocks.loadFail) throw new Error('allowlist unavailable'); },
    getByPath: () => undefined,
    addDirectory: async () => {},
    updateDirectory: async () => {},
  }) },
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

const adapter = () => ({
  server: 'filesystem',
  canHandle: () => true,
  execute: vi.fn(async () => ({ ok: true })),
});

const fsInvocation = (args: Record<string, unknown>, callId: string) => new ToolInvocation({
  ...REAL_INVOCATION,
  assistantMessageId: 'run-gate',
  conversationId: 'conv-gate',
  server: 'filesystem',
  tool: 'write_file',
  args,
  callId,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approvals.length = 0;
  mocks.answer = 'approve';
  mocks.decision = 'once';
  mocks.resolverThrows = false;
  mocks.loadFail = false;
  clearConversationAccess('fs', 'conv-gate');
});

describe('filesystem gate at the run() seam', () => {
  it('a filesystem call with no path argument never enters the gate', async () => {
    const a = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [a as never] });

    const result = await pipeline.run(fsInvocation({ content: 'x' }, 'call-nopath'));

    expect(a.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
    // 不解析、不读 allowlist、也不发审批
    expect(mocks.loadAllowlist).not.toHaveBeenCalled();
    expect(mocks.approvals).toHaveLength(0);
  });

  it('a whitespace-only path still counts as a path to resolve', async () => {
    // 原实现从不 trim 路径值，所以 '   ' 会照常走解析与审批，而不是被当成"没有路径"放过。
    const a = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [a as never] });

    await pipeline.run(fsInvocation({ path: '   ', content: 'x' }, 'call-blank'));

    expect(mocks.loadAllowlist).toHaveBeenCalled();
  });

  it('a resolver that throws is not swallowed into "no path was given"', async () => {
    // 解析异常会被记成 resolveError，和残留别名一样走拒绝分支——原始字符串绝不交给后端。
    // 原实现就是这个形状（main:438-488），钉住它是为了证明拆分没有把异常变成放行。
    mocks.resolverThrows = true;
    const a = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [a as never] });

    const result = await pipeline.run(fsInvocation({ path: 'C:/outside/dir/file.txt', content: 'x' }, 'call-throw'));

    expect(a.execute).not.toHaveBeenCalled();
    expect((result as { error?: { code?: string } }).error?.code).toBe('UNRESOLVED_ALIAS');
  });

  it('anything else the gate throws comes back as FILESYSTEM_GATE_FAILED', async () => {
    // 读 allowlist 这一步在门的 try 里、但不在解析的 try 里，所以它才是 FILESYSTEM_GATE_FAILED 的来源。
    mocks.loadFail = true;
    const a = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [a as never] });

    const result = await pipeline.run(fsInvocation({ path: 'C:/outside/dir/file.txt', content: 'x' }, 'call-loadfail'));

    expect(a.execute).not.toHaveBeenCalled();
    expect((result as { error?: { code?: string } }).error?.code).toBe('FILESYSTEM_GATE_FAILED');
  });

  it('a refusal reaches the model as AUTH_DENIED and grants nothing', async () => {
    mocks.answer = 'reject';
    const a = adapter();
    const pipeline = new ToolExecutionPipeline({ adapters: [a as never] });

    const result = await pipeline.run(fsInvocation({ path: 'C:/outside/dir/file.txt', content: 'x' }, 'call-reject'));

    expect(mocks.approvals).toHaveLength(1);
    expect(a.execute).not.toHaveBeenCalled();
    expect((result as { error?: { code?: string } }).error?.code).toBe('AUTH_DENIED');
    expect(mocks.grantCallScope).not.toHaveBeenCalled();
  });
});
