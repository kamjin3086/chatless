import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolExecutionPipeline } from '../../ToolExecutionPipeline';
import { ToolInvocation } from '../../ToolInvocation';
import { ContributionAdapter } from '../ContributionAdapter';
import { McpAdapter } from '../McpAdapter';
import { createDefaultAdapters } from '../index';
import { buildExtensionRegistry } from '@/lib/extensions/registry';
import type { BuiltinExtension } from '@/lib/extensions/contracts';
import type { ToolAdapter } from '../../ToolAdapter';
import type { ExtensionRegistry } from '@/lib/extensions/registry';

const mocks = vi.hoisted(() => ({
  approvals: [] as Array<{ id: string }>,
  mcpCalls: [] as string[],
}));

vi.mock('@/lib/mcp/executor/ConnectionManager', () => ({
  ensureServerConnected: async () => {
    mocks.mcpCalls.push('connect');
  },
}));
vi.mock('@/lib/mcp/ServerManager', () => ({
  serverManager: {
    callTool: async (server: string, tool: string) => {
      mocks.mcpCalls.push(`call:${server}.${tool}`);
      return { ok: true, via: 'mcp' };
    },
  },
}));

vi.mock('@/store/authorizationStore', () => ({
  useAuthorizationStore: {
    getState: () => ({
      addPendingAuthorization: (auth: {
        id: string;
        onApprove: () => void;
      }) => {
        mocks.approvals.push(auth);
        auth.onApprove();
      },
    }),
  },
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => false,
}));
vi.mock('@/lib/mcp/experience/agentExperienceConfig', () => ({
  getAgentExperienceConfig: async () => ({ maxToolRetries: 0 }),
}));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: async () => {},
}));
vi.mock('../../ToolCardUpdater', () => ({
  markError: () => {},
  markPendingAuth: () => {},
  markSuccess: () => {},
}));

const executor = vi.hoisted(() => ({ calls: 0, executed: [] as unknown[] }));

function knowledgeExtension(enabled = true): BuiltinExtension {
  return {
    id: 'knowledge',
    defaultEnabled: enabled,
    toolGroups: [
      {
        id: 'knowledge.pilot',
        replaces: 'knowledge',
        stickyWhenLoaded: false,
        name: 'Knowledge base',
        description: 'knowledge_search / knowledge_read (per-conversation)',
        server: 'knowledge',
        tools: [
          {
            definition: {
              name: 'search',
              description: 'Search the mounted knowledge base',
              input_schema: { schema: { type: 'object', properties: {} } },
            },
            risk: 'read',
          },
        ],
        loadAdapter: async (): Promise<ToolAdapter> => {
          executor.calls++;
          return {
            server: 'knowledge',
            canHandle: (inv) => inv.server === 'knowledge',
            execute: async (inv) => {
              executor.executed.push(inv);
              return { ok: true, via: 'contribution' };
            },
          };
        },
      },
    ],
  } as BuiltinExtension;
}

function registry(overrides?: {
  isEnabled?: (id: string) => boolean | undefined;
}): ExtensionRegistry {
  return buildExtensionRegistry([knowledgeExtension()], overrides);
}

function invocation(server: string, tool = 'search') {
  return new ToolInvocation({
    provider: 'openai-compatible',
    model: 'gpt-fixture',
    historyForLlm: [],
    originalUserContent: 'q',
    assistantMessageId: 'run-x',
    conversationId: 'conv-x',
    server,
    tool,
    args: { query: 'anything' },
    callId: `call-${server}-${tool}`,
  });
}

describe('ContributionAdapter: contributions own their executor (phase 3)', () => {
  beforeEach(() => {
    executor.calls = 0;
    executor.executed.length = 0;
    mocks.approvals.length = 0;
    mocks.mcpCalls.length = 0;
  });

  it('routes a contributed server to the loadAdapter executor, loading it once', async () => {
    const bridge = new ContributionAdapter(() => registry());
    expect(bridge.canHandle(invocation('knowledge'))).toBe(true);
    expect(bridge.canHandle(invocation('fs'))).toBe(false);
    // canHandle (discovery-time routing question) never loads the factory (A04).
    expect(executor.calls).toBe(0);

    const first = await bridge.execute(invocation('knowledge'));
    const second = await bridge.execute(invocation('knowledge'));
    expect(first).toEqual({ ok: true, via: 'contribution' });
    expect(second).toEqual(first);
    expect(executor.calls).toBe(1); // cached after first execution
    expect(executor.executed).toHaveLength(2); // same invocation object passed through
    expect((executor.executed[0] as ToolInvocation).tool).toBe('search');
  });

  it('a disabled contribution rejects at routing and never loads its executor (A05)', async () => {
    const bridge = new ContributionAdapter(() =>
      buildExtensionRegistry([knowledgeExtension()], {
        isEnabled: () => false,
      }),
    );
    expect(bridge.canHandle(invocation('knowledge'))).toBe(false);
    expect(await bridge.execute(invocation('knowledge'))).toMatchObject({
      error: 'NO_ADAPTER',
    });
    expect(executor.calls).toBe(0);
  });

  it('disabled contribution on the REAL adapter list: NO_ADAPTER, no card, no MCP fallback (A05)', async () => {
    // Retired-servers harness, but for a disabled knowledge contribution.
    // McpAdapter claims any non-builtin name, so without the contributed-
    // server guard the call would open an approval card and execute against
    // an external "knowledge" MCP server - exactly the fallback A05 forbids.
    const disabled = new ContributionAdapter(() =>
      buildExtensionRegistry([knowledgeExtension()], {
        isEnabled: () => false,
      }),
    );
    const adapters = createDefaultAdapters().map((a) =>
      a instanceof ContributionAdapter ? disabled : a,
    );
    const pipeline = new ToolExecutionPipeline({ adapters });
    const result = (await pipeline.run(invocation('knowledge'))) as {
      error?: string;
    };
    expect(result.error).toBe('NO_ADAPTER');
    expect(mocks.approvals).toHaveLength(0);
    expect(mocks.mcpCalls).toHaveLength(0);
    expect(executor.calls).toBe(0);
  });

  it('the MCP path never claims contributed servers, disabled or not (A05 guard)', () => {
    const mcp = new McpAdapter();
    // The real assembled registry contributes knowledge; the guard uses the
    // full groups view, so the name is blocked regardless of enablement.
    expect(mcp.canHandle(invocation('knowledge'))).toBe(false);
    expect(mcp.canHandle(invocation('KNOWLEDGE'))).toBe(false);
    expect(mcp.canHandle(invocation('research-mcp'))).toBe(true);
  });

  it('routing matches normalized server names on the bridge (plan §10 alias rule)', () => {
    const bridge = new ContributionAdapter(() => registry());
    for (const variant of [
      'knowledge',
      'Knowledge',
      ' KNOWLEDGE ',
      'knowledge\n',
    ]) {
      expect(bridge.canHandle(invocation(variant)), variant).toBe(true);
    }
  });

  it('a failed adapter load is retried on the next execution (A13 init failure)', async () => {
    let fail = true;
    let loads = 0;
    const base = knowledgeExtension().toolGroups![0];
    const bridge = new ContributionAdapter(() =>
      buildExtensionRegistry([
        {
          ...knowledgeExtension(),
          toolGroups: [
            {
              ...base,
              loadAdapter: async () => {
                loads++;
                if (fail) throw new Error('chunk 404');
                return {
                  server: 'knowledge',
                  canHandle: (inv) => inv.server === 'knowledge',
                  execute: async () => ({ ok: true }),
                } as ToolAdapter;
              },
            },
          ],
        } as BuiltinExtension,
      ]),
    );
    await expect(bridge.execute(invocation('knowledge'))).rejects.toThrow(
      'chunk 404',
    );
    fail = false;
    await expect(bridge.execute(invocation('knowledge'))).resolves.toEqual({
      ok: true,
    });
    expect(loads).toBe(2);
  });

  it('the default adapter list routes knowledge through the bridge, not a static knowledge entry', () => {
    const adapters = createDefaultAdapters();
    expect(adapters.some((a) => a instanceof ContributionAdapter)).toBe(true);
    expect(adapters.some((a) => a.server === 'knowledge')).toBe(false);
    // The real assembled registry contributes knowledge, so the bridge claims
    // it - via the enabled view only; no availability predicate runs at routing.
    const bridge = adapters.find((a) => a instanceof ContributionAdapter)!;
    expect(bridge.canHandle(invocation('knowledge'))).toBe(true);
  });

  it('routes by declared tool identity: an undeclared tool on a contributed server reaches no adapter (review P0-3)', async () => {
    const bridge = new ContributionAdapter(() => registry());
    expect(bridge.canHandle(invocation('knowledge', 'delete'))).toBe(false);
    const result = await bridge.execute(invocation('knowledge', 'delete'));
    expect(result).toMatchObject({ ok: false, error: 'NO_ADAPTER' });
    expect(executor.calls).toBe(0);
  });

  it('two groups sharing one server dispatch to their own adapters (review P0-3)', async () => {
    const hit: string[] = [];
    const mk = (gid: string, tool: string): BuiltinExtension =>
      ({
        id: gid,
        defaultEnabled: true,
        toolGroups: [
          {
            id: gid,
            name: gid,
            description: `group ${gid} for shared-server routing tests`,
            server: 'sharedserver',
            tools: [
              {
                definition: {
                  name: tool,
                  description: `tool ${tool}`,
                  input_schema: { schema: { type: 'object', properties: {} } },
                },
                risk: 'unknown',
              },
            ],
            loadAdapter: async () =>
              ({
                server: 'sharedserver',
                canHandle: (inv: { tool: unknown }) => inv.tool === tool,
                execute: async () => {
                  hit.push(gid);
                  return { ok: true, group: gid };
                },
              }) as ToolAdapter,
          },
        ],
      }) as BuiltinExtension;
    const bridge = new ContributionAdapter(() =>
      buildExtensionRegistry([mk('groupa', 'alpha'), mk('groupb', 'beta')]),
    );
    expect(await bridge.execute(invocation('sharedserver', 'alpha'))).toEqual({
      ok: true,
      group: 'groupa',
    });
    expect(await bridge.execute(invocation('sharedserver', 'beta'))).toEqual({
      ok: true,
      group: 'groupb',
    });
    expect(hit).toEqual(['groupa', 'groupb']);
  });

  it('disabling while the factory is loading blocks the late execution (review P0-5 race)', async () => {
    let enabled = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const executed: string[] = [];
    const ext = knowledgeExtension();
    const gated: BuiltinExtension = {
      ...ext,
      toolGroups: [
        {
          ...ext.toolGroups![0],
          loadAdapter: async () => {
            await gate;
            return {
              server: 'knowledge',
              canHandle: () => true,
              execute: async () => {
                executed.push('ran');
                return { ok: true };
              },
            } as ToolAdapter;
          },
        },
      ],
    } as BuiltinExtension;
    const reg = buildExtensionRegistry([gated], { isEnabled: () => enabled });
    const bridge = new ContributionAdapter(() => reg);
    const running = bridge.execute(invocation('knowledge'));
    enabled = false; // disabled mid-load
    release();
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: 'NO_ADAPTER' });
    expect(executed).toEqual([]);
  });
});
