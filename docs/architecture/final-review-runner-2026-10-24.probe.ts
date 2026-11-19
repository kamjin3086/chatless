import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamCallbacks, Message } from '@/lib/llm/types';
import {
  AgentLoopRunner,
  EMPTY_MODEL_OUTPUT_NOTICE,
} from '@/lib/mcp/agentLoop/AgentLoopRunner';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  stream: vi.fn(),
  execute: vi.fn(),
  append: vi.fn(),
  status: vi.fn(),
  loadEvents: vi.fn(),
  capability: vi.fn(),
  store: {
    conversations: [],
    setAgentRunState: vi.fn(),
    updateMessage: vi.fn(),
    dispatchMessageAction: vi.fn(),
  },
}));
vi.mock('@/lib/llm', () => ({
  streamChat: mocks.stream,
  cancelStream: vi.fn(),
  chat: vi.fn(),
}));
vi.mock('@/lib/llm/ProviderRegistry', () => ({
  ProviderRegistry: { get: () => ({ cancelStream: vi.fn() }) },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/lib/mcp/pipeline', () => ({
  ToolInvocation: class {
    constructor(params: unknown) {
      Object.assign(this, params);
    }
  },
  ToolExecutionPipeline: class {
    run = mocks.execute;
  },
}));
vi.mock('@/lib/mcp/pipeline/adapters', () => ({
  createDefaultAdapters: () => [],
}));
vi.mock('@/lib/mcp/ToolCallCoordinator', () => ({
  ToolCallCoordinator: {
    getInstance: () => ({
      isMessageCancelled: () => false,
      markToolCallComplete: vi.fn(),
    }),
  },
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => mocks.store },
}));
vi.mock('@/store/toolLoadRequestStore', () => ({
  useToolLoadRequestStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock('@/lib/rag/CitationService', () => ({ applyCitations: vi.fn() }));
vi.mock('@/lib/rag/EvidenceRegistry', () => ({
  listEvidence: () => [],
  clearEvidenceRegistry: vi.fn(),
  restoreEvidence: vi.fn(),
}));
vi.mock('@/lib/mcp/promptInjector', () => ({
  buildMcpSystemInjections: async () => ({ useNativeTools: true }),
}));
vi.mock('@/lib/mcp/agentLoop/buildAgentPromptEnvelope', () => ({
  buildAgentPromptEnvelope: () => ({
    prefixMessages: [],
    tools: [{ name: 'fs__write' }],
  }),
}));
vi.mock('@/lib/mcp/agentLoop/resolveAgentToolCapability', () => ({
  resolveAgentToolCapability: mocks.capability,
}));
vi.mock('@/lib/mcp/agentLoop/AgentRunEventStore', () => ({
  AgentRunEventStore: {
    ensureRun: vi.fn(),
    loadEvents: mocks.loadEvents,
    appendEvent: mocks.append,
    setRunStatus: mocks.status,
  },
}));
vi.mock('@/lib/chat/stream/StreamOrchestrator', () => ({
  StreamOrchestrator: class {
    content = '';
    constructor(private config: any) {}
    getContext() {
      return { content: this.content };
    }
    createCallbacks() {
      return {
        onEvent: async (event: any) => {
          await Promise.resolve(); // Exercise providers that do not await callbacks.
          if (event.type === 'tool_call') {
            // A native event carries `request`; the prompt track's synthesised
            // event carries the parsed call and the handler mints the ids.
            await this.config.onToolCall(
              event.request ?? {
                server: event.parsed?.serverName,
                tool: event.parsed?.toolName,
                args: event.parsed?.arguments
                  ? JSON.parse(event.parsed.arguments)
                  : {},
                callId: event.toolCall,
                cardId: 'card',
                lockKey: event.toolCall,
              },
            );
          }
          if (event.type === 'content_token') this.content += event.content;
        },
        onComplete: vi.fn(),
        onError: this.config.onError,
      };
    }
  },
}));

const params = {
  assistantMessageId: 'run',
  conversationId: 'conversation',
  provider: 'test',
  model: 'model',
  historyForLlm: [{ role: 'user', content: 'write' }] as Message[],
  originalUserContent: 'write',
};
function tool(callbacks: StreamCallbacks, id: string, preResult?: unknown) {
  callbacks.onEvent?.({
    type: 'tool_call',
    request: {
      server: 'fs',
      tool: 'write',
      callId: id,
      cardId: id,
      lockKey: id,
      args: { path: id },
      preResult,
    },
  } as any);
}
function finish(callbacks: StreamCallbacks) {
  callbacks.onComplete?.();
}

beforeEach(() => {
  // Reset queued one-shot implementations as well as call history. A test
  // may fail at a durable boundary before consuming its prepared transport.
  vi.resetAllMocks();
  mocks.capability.mockReturnValue({
    track: 'native',
    useNativeTools: true,
    renderMode: 'tool_role',
  });
  mocks.append.mockResolvedValue(undefined);
  mocks.status.mockResolvedValue(undefined);
  mocks.loadEvents.mockResolvedValue([]);
  mocks.store.updateMessage.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue({ ok: true });
  mocks.stream.mockImplementation(async (_p, _m, _history, cb) => finish(cb));
});

import { waitForCallApproval } from '@/lib/mcp/pipeline/approvalWait';
import { useAuthorizationStore } from '@/store/authorizationStore';
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({ getConnectionUrl: () => 'sqlite:review-only' }),
    }),
  },
}));
it('Stop during native approval insertion releases the real loop and permits another send', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  useAuthorizationStore.setState({ pendingAuthorizations: new Map() });
  let release!: () => void;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'agent_request_approval')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return true;
  });
  mocks.stream.mockImplementationOnce(async (_p, _m, _history, cb) => {
    tool(cb, 'a');
    finish(cb);
  });
  mocks.execute.mockImplementationOnce(async () => {
    const answer = await waitForCallApproval({
      id: 'approval-native',
      runId: 'run',
      conversationId: 'conversation',
      server: 'fs',
      tool: 'write',
      args: {},
    });
    return { ok: answer.approved };
  });
  let ended = false;
  const running = AgentLoopRunner.run(params).finally(() => {
    ended = true;
  });
  try {
    await vi.waitFor(() => expect(release).toBeDefined());
    AgentLoopRunner.cancel({ assistantMessageId: 'run' });
    useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
    release();
    await vi.waitFor(() =>
      expect(
        useAuthorizationStore
          .getState()
          .hasPendingAuthorization('approval-native'),
      ).toBe(true),
    );
    const subsequent = await AgentLoopRunner.run({
      ...params,
      assistantMessageId: 'next-run',
    }).then(
      () => 'started',
      (e) => e.message,
    );
    console.log('native-branch Stop: ended=', ended, 'next send=', subsequent);
    const observedEnded = ended;
    useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
    await running;
    expect(observedEnded).toBe(true);
    expect(subsequent).toBe('started');
  } finally {
    useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
    await running;
    vi.unstubAllGlobals();
  }
});
