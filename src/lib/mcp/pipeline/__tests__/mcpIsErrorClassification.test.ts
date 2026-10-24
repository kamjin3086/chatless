import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { detectFatalFailure, markKnownFailure } from '../toolResultDiagnostics';
import { McpAdapter } from '../adapters/McpAdapter';

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  markError: vi.fn(),
  markSuccess: vi.fn(),
  appendStep: vi.fn(async () => {}),
}));

vi.mock('@/lib/mcp/ServerManager', () => ({
  serverManager: { callTool: mocks.callTool },
}));
vi.mock('@/lib/mcp/executor/ConnectionManager', () => ({
  ensureServerConnected: vi.fn(async () => {}),
}));
vi.mock('../ToolCardUpdater', () => ({
  markError: mocks.markError,
  markPendingAuth: vi.fn(),
  markSuccess: mocks.markSuccess,
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: mocks.appendStep,
}));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => true,
}));

const invocation = (args: Record<string, unknown> = {}) =>
  new ToolInvocation({
    provider: 'openai-compatible',
    model: 'gpt-fixture',
    historyForLlm: [],
    originalUserContent: 'question',
    assistantMessageId: 'run-mcp-error',
    conversationId: 'conv-mcp-error',
    server: 'external-fixture',
    tool: 'write',
    args,
    callId: 'call-mcp-error',
    cardId: 'card-mcp-error',
    lockKey: 'lock-mcp-error',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP isError classification', () => {
  it('detects the protocol flag and keeps the explanation', () => {
    const result = {
      content: [{ type: 'text', text: 'permission denied by server' }],
      isError: true,
    };
    expect(
      detectFatalFailure({ server: 'external', tool: 'write' }, result),
    ).toBe('permission denied by server');

    const marked = markKnownFailure(
      { server: 'external', tool: 'write' },
      result,
      'permission denied by server',
    );
    expect(marked).toMatchObject({
      isError: true,
      resultStatus: 'failed',
      content: result.content,
      errorDetails: {
        code: 'TOOL_FAILED',
        message: 'permission denied by server',
      },
    });
  });

  it('leaves a successful MCP result alone', () => {
    expect(
      detectFatalFailure(
        { server: 'external', tool: 'write' },
        { content: [{ type: 'text', text: 'ok' }], isError: false },
      ),
    ).toBeUndefined();
  });

  it('does not overwrite a structured ok=false error when both flags are present', () => {
    expect(
      detectFatalFailure(
        { server: 'external', tool: 'write' },
        { ok: false, isError: true, error: 'write refused' },
      ),
    ).toBe('write refused');
  });

  it('marks the pipeline result and run output as failed without retrying', async () => {
    mocks.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'remote tool failed' }],
      isError: true,
    });
    const pipeline = new ToolExecutionPipeline({
      adapters: [new McpAdapter()],
    });

    const result: any = await pipeline.run(invocation());

    expect(mocks.callTool).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'remote tool failed' }],
      resultStatus: 'failed',
      errorDetails: { code: 'TOOL_FAILED', message: 'remote tool failed' },
    });
    expect(mocks.markError).toHaveBeenCalledWith(
      expect.objectContaining({ server: 'external-fixture' }),
      'remote tool failed',
    );
    expect(mocks.markSuccess).not.toHaveBeenCalled();
    expect(mocks.appendStep).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ resultStatus: 'failed' }),
      }),
    );
  });
});
