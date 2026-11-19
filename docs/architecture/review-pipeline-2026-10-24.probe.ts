import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '@/lib/mcp/pipeline/ToolExecutionPipeline';
import { ToolInvocation } from '@/lib/mcp/pipeline/ToolInvocation';
import { clearConversationAccess } from '@/lib/mcp/accessPolicy';

/** A real invocation always carries these; they are not what the tests below are about. */
const realInvocation = () => ({
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
});

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
  approvals: [] as Array<{
    id: string;
    onApprove: (d?: 'once' | 'always' | 'unrestricted') => void;
    onReject: () => void;
  }>,
  answer: 'approve' as 'approve' | 'reject',
  decision: 'once' as 'once' | 'always' | 'unrestricted',
}));

vi.mock('@/lib/filesystemAllowlist', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/filesystemAllowlist')>();
  return {
    ...actual,
    resolveAllowlistPath: (params: unknown) => {
      if (mocks.resolverThrows) throw new Error('gate boom');
      return (actual.resolveAllowlistPath as (p: unknown) => unknown)(params);
    },
  };
});

vi.mock('@/lib/tauri/filesystemCommands', () => ({
  writeFile: vi.fn(async () => {
    throw new Error('IPC response lost after dispatch');
  }),
  setAllowlist: vi.fn(async () => ({ ok: true })),
  grantCallScope: mocks.grantCallScope,
  revokeCallScope: mocks.revokeCallScope,
}));

vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: {
        id: string;
        onApprove: (d?: 'once' | 'always' | 'unrestricted') => void;
        onReject: () => void;
      }) => {
        mocks.approvals.push(auth);
        if (mocks.answer === 'approve') auth.onApprove(mocks.decision);
        else auth.onReject();
      },
    }),
  },
}));

vi.mock('@/store/filesystemAllowlistStore', () => ({
  useFilesystemAllowlistStore: {
    getState: () => ({
      directories: [],
      load: async () => {
        mocks.loadAllowlist();
        if (mocks.loadFail) throw new Error('allowlist unavailable');
      },
      getByPath: () => undefined,
      addDirectory: async () => {},
      updateDirectory: async () => {},
    }),
  },
}));

vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: {
    getState: () => ({ getWorkingDir: () => undefined }),
  },
}));

vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => false,
}));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: mocks.appendWorkspaceToolStep,
}));
vi.mock('@/lib/mcp/pipeline/ToolCardUpdater', () => ({
  markError: () => {},
  markPendingAuth: () => {},
  markSuccess: () => {},
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        getConnectionUrl: () => 'sqlite::memory:',
        executeTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({ execute: async () => {} }),
      }),
    }),
  },
}));

const adapter = () => ({
  server: 'filesystem',
  canHandle: () => true,
  execute: vi.fn(async () => ({ ok: true })),
});

const fsInvocation = (args: Record<string, unknown>, callId: string) =>
  new ToolInvocation({
    ...realInvocation(),
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

import { FilesystemAdapter } from '@/lib/mcp/pipeline/adapters/FilesystemAdapter';
import { McpAdapter } from '@/lib/mcp/pipeline/adapters/McpAdapter';
vi.mock('@/lib/mcp/executor/ConnectionManager', () => ({
  ensureServerConnected: async () => {},
}));
vi.mock('@/lib/mcp/ServerManager', () => ({
  serverManager: {
    callTool: async () => ({
      isError: true,
      content: [{ type: 'text', text: 'Remote tool failed' }],
    }),
  },
}));
it('preserves uncertainty when filesystem transport rejects after dispatch', async () => {
  const invocation = fsInvocation(
    { path: 'C:/outside/dir/file.txt', content: 'x' },
    'transport-loss',
  );
  const result: any = await new ToolExecutionPipeline({
    adapters: [new FilesystemAdapter()],
  }).run(invocation);
  console.log('filesystem transport result:', JSON.stringify(result));
  expect(result.resultStatus).toBe('unknown');
});
it('marks a returned MCP isError result as failure', async () => {
  const invocation = new ToolInvocation({
    ...realInvocation(),
    server: 'external-fixture',
    tool: 'write',
    assistantMessageId: 'mcp-error-run',
    conversationId: 'conv-gate',
    args: {},
    callId: 'mcp-error',
    cardId: 'mcp-error',
  });
  const result: any = await new ToolExecutionPipeline({
    adapters: [new McpAdapter()],
  }).run(invocation);
  console.log('MCP result:', JSON.stringify(result));
  expect(result.resultStatus).toBe('failed');
});

it('control: a throwing write adapter is classified unknown by the pipeline', async () => {
  const invocation = fsInvocation(
    { path: 'C:/outside/dir/file.txt', content: 'x' },
    'direct-throw',
  );
  const result: any = await new ToolExecutionPipeline({
    adapters: [
      {
        server: invocation.server,
        canHandle: () => true,
        execute: async () => {
          throw new Error('IPC response lost after dispatch');
        },
      },
    ],
  }).run(invocation);
  expect(result.resultStatus).toBe('unknown');
});
it('control: an explicit ok=false result is classified failed', async () => {
  const invocation = fsInvocation(
    { path: 'C:/outside/dir/file.txt', content: 'x' },
    'known-fail',
  );
  const result: any = await new ToolExecutionPipeline({
    adapters: [
      {
        server: invocation.server,
        canHandle: () => true,
        execute: async () => ({ ok: false, error: 'Permission denied' }),
      },
    ],
  }).run(invocation);
  expect(result.resultStatus).toBe('failed');
});
