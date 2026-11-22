import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAdapters } from '../adapters';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { buildInitialPrompt } from '@/lib/mcp/injection/promptBuilder';
import { serverManager } from '@/lib/mcp/ServerManager';
import { resolveNonConflictingServerName } from '@/lib/mcp/serverNamePolicy';
import { decideServerCall } from '../policy/policy';
import {
  NO_ANDROID_CAPABILITIES,
  type AndroidCapabilities,
} from '@/lib/android/androidCapabilities';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  platform: vi.fn(),
  handoff: vi.fn(),
  ask: vi.fn(),
  configuredServers: vi.fn(),
  remoteTools: vi.fn(),
  connectRemote: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  isTauri: mocks.isTauri,
  invoke: mocks.handoff,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: mocks.platform }));
vi.mock('@/lib/mcp/chatIntegration', () => ({
  getEnabledConfiguredServers: mocks.configuredServers,
}));
vi.mock('@/lib/mcp/persistentCache', () => ({
  persistentCache: { getToolsWithCache: mocks.remoteTools },
}));
vi.mock('@/lib/mcp/executor/ConnectionManager', () => ({
  ensureServerConnected: mocks.connectRemote,
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => false,
}));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 5 }),
}));
vi.mock('../approvalWait', () => ({ waitForCallApproval: mocks.ask }));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: async () => {},
}));
vi.mock('../ToolCardUpdater', () => ({
  markError: vi.fn(),
  markPendingAuth: vi.fn(),
  markSuccess: vi.fn(),
}));

let turn = 0;
function run({
  server = 'android_countdown',
  tool = 'start',
  args = { durationSeconds: 90 },
  planOnly = false,
}: Partial<{
  server: string;
  tool: string;
  args: Record<string, unknown>;
  planOnly: boolean;
}> = {}) {
  const pipeline = new ToolExecutionPipeline({
    adapters: createDefaultAdapters(),
  });
  turn += 1;
  return pipeline.run(
    new ToolInvocation({
      server,
      tool,
      args,
      planOnly,
      conversationId: 'android-countdown',
      assistantMessageId: `countdown-${turn}`,
      callId: `call-${turn}`,
      provider: 'openai-compatible',
      model: 'fixture',
      historyForLlm: [],
      originalUserContent: 'Set a countdown for ninety seconds.',
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.platform.mockReturnValue('android');
  mocks.configuredServers.mockResolvedValue([]);
  mocks.ask.mockResolvedValue({
    approved: true,
    decision: 'once',
    revision: 0,
  });
});

function buildCatalog() {
  return buildInitialPrompt(
    {
      userContent: 'Set a countdown for ninety seconds.',
      phase: 'initial',
      providerName: 'OpenAI',
      modelName: 'gpt-4o',
    },
    {
      hasExplicitMention: false,
      mentionedServers: [],
      webSearchEnabled: false,
      hasToolKeywords: false,
      hasPreviousToolUse: false,
      isTimeRelated: false,
    },
  );
}

describe('Android countdown discovery', () => {
  it('advertises the tool in the model catalog and through tools__search on Android', async () => {
    const { nativeTools, useNativeTools } = await buildCatalog();
    expect(useNativeTools).toBe(true);
    const tool = nativeTools?.find(
      (entry) => entry.name === 'android_countdown__start',
    );
    expect(tool).toMatchObject({
      parameters: {
        properties: {
          durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
        },
        required: ['durationSeconds'],
      },
    });
    expect(tool?.description).toMatch(/explicit.*current user turn/i);
    expect(
      await run({
        server: 'tools',
        tool: 'search',
        args: { query: 'android_countdown' },
      }),
    ).toMatchObject({
      results: [
        expect.objectContaining({
          server: 'android_countdown',
          name: 'start',
          source: 'builtin',
        }),
      ],
    });
  });

  it.each([
    ['linux', true],
    ['ios', true],
    ['android', false],
  ])(
    'does not advertise the built-in tool on %s (Tauri: %s)',
    async (platform, isTauri) => {
      mocks.platform.mockReturnValue(platform);
      mocks.isTauri.mockReturnValue(isTauri);

      expect((await buildCatalog()).nativeTools).not.toContainEqual(
        expect.objectContaining({ name: 'android_countdown__start' }),
      );
      expect(
        await run({
          server: 'tools',
          tool: 'search',
          args: { query: 'android_countdown' },
        }),
      ).toMatchObject({ results: [] });
      expect(mocks.handoff).not.toHaveBeenCalled();
    },
  );

  it('reserves the Android namespace and never loads an external MCP provider with that name', async () => {
    mocks.configuredServers.mockResolvedValue(['android_countdown']);
    mocks.remoteTools.mockResolvedValue([{ name: 'start' }]);

    expect(
      resolveNonConflictingServerName({
        desiredName: 'android_countdown',
        existingNames: [],
      }),
    ).toMatchObject({
      name: 'android_countdown_external',
    });
    expect(
      await run({
        server: 'tools',
        tool: 'search',
        args: { query: 'android_countdown' },
      }),
    ).toMatchObject({
      results: [
        expect.objectContaining({
          server: 'android_countdown',
          name: 'start',
          source: 'builtin',
        }),
      ],
    });
    expect(mocks.remoteTools).not.toHaveBeenCalled();
    expect(await run({ tool: 'external_operation' })).toMatchObject({
      error: 'NO_ADAPTER',
    });
    expect(mocks.connectRemote).not.toHaveBeenCalled();
  });

  it('keeps a same-named desktop MCP server discoverable and under normal approval policy', async () => {
    mocks.platform.mockReturnValue('linux');
    mocks.configuredServers.mockResolvedValue(['android_countdown']);
    mocks.remoteTools.mockResolvedValue([
      { name: 'start', description: 'External countdown tool' },
    ]);
    const externalResult = {
      content: [{ type: 'text', text: 'external tool result' }],
    };
    const remote = vi
      .spyOn(serverManager, 'callTool')
      .mockResolvedValue(externalResult);
    try {
      expect(
        resolveNonConflictingServerName({
          desiredName: 'android_countdown',
          existingNames: [],
        }),
      ).toEqual({
        name: 'android_countdown',
        renames: [],
      });
      expect(
        await run({
          server: 'tools',
          tool: 'search',
          args: { query: 'android_countdown' },
        }),
      ).toMatchObject({
        results: [
          expect.objectContaining({
            server: 'android_countdown',
            name: 'start',
            source: 'mcp',
          }),
        ],
      });
      expect(await run()).toEqual(externalResult);
      expect(mocks.ask).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ server: 'android_countdown', tool: 'start' }),
      );
      expect(remote).toHaveBeenCalledExactlyOnceWith(
        'android_countdown',
        'start',
        { durationSeconds: 90 },
      );
      expect(mocks.handoff).not.toHaveBeenCalled();
    } finally {
      remote.mockRestore();
    }
  });
});

describe('Android countdown execution', () => {
  it.each([1, 90, 86400])(
    'hands off %i seconds once, without an extra approval or a claim that the timer is running',
    async (durationSeconds) => {
      mocks.handoff.mockResolvedValue({ status: 'handed_off' });

      expect(await run({ args: { durationSeconds } })).toEqual({
        ok: true,
        status: 'handed_off',
        durationSeconds,
        message:
          'Countdown request handed off to the Android clock. Chatless cannot verify that the timer started.',
      });
      expect(mocks.ask).not.toHaveBeenCalled();
      expect(mocks.handoff).toHaveBeenCalledExactlyOnceWith(
        'start_android_countdown',
        { durationSeconds },
      );
    },
  );

  it.each([undefined, 0, -5, 1.5, 86401, '90', NaN, null])(
    'rejects invalid duration %s before native handoff',
    async (durationSeconds) => {
      expect(
        await run({
          args: durationSeconds === undefined ? {} : { durationSeconds },
        }),
      ).toMatchObject({
        ok: false,
        resultStatus: 'failed',
        error: expect.objectContaining({ code: 'INVALID_DURATION' }),
      });
      expect(mocks.ask).not.toHaveBeenCalled();
      expect(mocks.handoff).not.toHaveBeenCalled();
    },
  );

  it('reports a missing clock target as a known failure', async () => {
    mocks.handoff.mockResolvedValue({ status: 'unavailable' });

    expect(await run()).toMatchObject({
      ok: false,
      resultStatus: 'failed',
      error: expect.objectContaining({ code: 'CLOCK_UNAVAILABLE' }),
    });
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
  });

  it('allows only the exact countdown tool without approval, and only on Android', () => {
    const params = {
      server: 'android_countdown',
      tool: 'start',
      autoAuthorize: false,
    };
    const countdownOn: AndroidCapabilities = {
      ...NO_ANDROID_CAPABILITIES,
      countdown: true,
    };
    expect(decideServerCall({ ...params, android: countdownOn })).toBe('allow');
    expect(
      decideServerCall({ ...params, android: NO_ANDROID_CAPABILITIES }),
    ).toBe('ask');
    expect(decideServerCall({ ...params })).toBe('ask');
    expect(
      decideServerCall({
        ...params,
        tool: 'set_alarm',
        android: countdownOn,
      }),
    ).toBe('ask');
    expect(
      decideServerCall({
        ...params,
        server: 'other_device',
        android: countdownOn,
      }),
    ).toBe('ask');
  });

  it('rejects unrelated device actions and blocks countdowns in plan-only mode', async () => {
    expect(await run({ tool: 'set_alarm' })).toMatchObject({
      error: 'NO_ADAPTER',
    });
    expect(await run({ planOnly: true })).toMatchObject({
      error: { code: 'PLAN_ONLY_BLOCKED' },
    });
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it.each(['lost response', 'unexpected response'])(
    'marks %s unknown without replay despite retry configuration',
    async (scenario) => {
      if (scenario === 'lost response')
        mocks.handoff.mockRejectedValue(
          new Error('timeout waiting for Android'),
        );
      else mocks.handoff.mockResolvedValue({ status: 'unexpected' });

      expect(await run()).toMatchObject({
        ok: false,
        attempts: 1,
        maxRetries: 0,
        resultStatus: 'unknown',
        errorDetails: { code: 'TOOL_RESULT_UNKNOWN' },
        message: expect.stringMatching(/check.*clock.*do not retry/i),
      });
      expect(mocks.handoff).toHaveBeenCalledTimes(1);
    },
  );
});
