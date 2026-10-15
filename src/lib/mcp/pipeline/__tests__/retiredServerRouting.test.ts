import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { createDefaultAdapters } from '../adapters';

/** A real invocation always carries these; they are not what the tests below are about. */
const realInvocation = () => ({
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
});

const mocks = vi.hoisted(() => ({ approvals: [] as Array<{ id: string }> }));

vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: { id: string; onApprove: () => void }) => {
        mocks.approvals.push(auth);
        auth.onApprove();
      },
    }),
  },
}));

// 对照测试要跑真实的文件门，所以把它的邻居都换成哑实现。
vi.mock('@/lib/tauri/filesystemCommands', () => ({
  setAllowlist: async () => ({ ok: true }),
  grantCallScope: async () => ({ ok: true, path: '' }),
  revokeCallScope: async () => ({ ok: true }),
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
vi.mock('@/lib/mcp/authorizationConfig', () => ({ shouldAutoAuthorize: async () => false }));
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

function invocation(server: string, tool: string, args: Record<string, unknown> = { path: '@WorkDir/notes.md' }) {
  return new ToolInvocation({
    ...realInvocation(),
    assistantMessageId: 'run-retired',
    conversationId: 'conv-retired',
    server,
    tool,
    args,
    callId: `call-${server}-${tool}`,
  });
}

/**
 * `user_fs` / `skills_fs` 已退役，模型也看不到它们的工具。但历史消息里可能还留着
 * 当年的调用，模型也可能凭空造一个。这两种情况都该在**路由**这一层就失败：审批门在
 * 路由之后，若让它先跑，用户会看到一张永远无法兑现的授权卡。
 */
describe('retired servers fail at routing, before any approval prompt', () => {
  beforeEach(() => {
    mocks.approvals.length = 0;
  });

  it.each([['user_fs', 'read_user_file'], ['user_fs', 'write_user_file'], ['skills_fs', 'read_skill_resource']])(
    '%s__%s is rejected without opening a card',
    async (server, tool) => {
      const pipeline = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

      const result = (await pipeline.run(invocation(server, tool))) as { error?: string };

      expect(result.error).toBe('NO_ADAPTER');
      expect(mocks.approvals).toHaveLength(0);
    },
  );

  // 对照：门要弹卡时这个 mock 收得到。没有它，上面那三条 approvals 为空可能只是
  // 因为整条审批链路在测试里根本没接通。
  it('does open a card when a live fs write needs approval', async () => {
    const adapter = { server: 'filesystem', canHandle: () => true, execute: vi.fn(async () => ({ ok: true })) };
    const pipeline = new ToolExecutionPipeline({ adapters: [adapter as never] });

    await pipeline.run(invocation('filesystem', 'write_file', { path: '/outside/allowlist/file.txt', content: 'hi' }));

    expect(mocks.approvals.length).toBeGreaterThan(0);
  });

  it('keeps the retired servers out of the default adapter registry', () => {
    const adapters = createDefaultAdapters();

    for (const server of ['user_fs', 'skills_fs']) {
      const claimed = adapters.some((adapter) => adapter.canHandle(invocation(server, 'anything')));
      expect(claimed, `${server} must not be claimed by any adapter`).toBe(false);
    }
  });
});
