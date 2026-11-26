import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsRegistryAdapter } from '../ToolsRegistryAdapter';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { buildExtensionRegistry } from '@/lib/extensions/registry';
import type { BuiltinExtension } from '@/lib/extensions/contracts';
import type { ToolAdapter } from '../../ToolAdapter';

function catalogExtension(): BuiltinExtension {
  return {
    id: 'catalogprobe',
    defaultEnabled: true,
    toolGroups: [
      {
        id: 'catalogprobe',
        name: 'Catalog probe',
        description: 'probe group for catalog visibility tests',
        server: 'catalogserver',
        availability: async () => false, // enabled but data unavailable
        tools: [
          {
            definition: {
              name: 'peek',
              description: 'peek at catalog probe data',
              input_schema: { schema: { type: 'object', properties: {} } },
            },
            risk: 'unknown',
          },
        ],
        loadAdapter: async () =>
          ({
            server: 'catalogserver',
            canHandle: () => true,
            execute: async () => ({ ok: true }),
          }) as ToolAdapter,
      },
    ],
  } as BuiltinExtension;
}

vi.mock('@/lib/mcp/chatIntegration', () => ({
  getEnabledConfiguredServers: vi.fn(async () => ['research-mcp']),
}));
vi.mock('@/lib/mcp/persistentCache', () => ({
  persistentCache: {
    getToolsWithCache: vi.fn(async () => [{ name: 'find_paper', description: 'Find research papers' }]),
  },
}));

describe('ToolsRegistryAdapter', () => {
  beforeEach(() => {
    useToolLoadRequestStore.getState().reset('conversation-a');
  });

  it('searches enabled MCP tools and loads the matching server only for this conversation', async () => {
    const adapter = new ToolsRegistryAdapter();
    const result = await adapter.execute({
      server: 'tools', tool: 'search', conversationId: 'conversation-a', args: { query: 'paper' },
    } as any) as any;

    expect(result.ok).toBe(true);
    expect(result.results).toContainEqual(expect.objectContaining({ server: 'research-mcp', name: 'find_paper' }));
    expect(useToolLoadRequestStore.getState().getLoadedMcpServers('conversation-a')).toEqual(['research-mcp']);
    expect(useToolLoadRequestStore.getState().getLoadedMcpServers('another-conversation')).toEqual([]);
  });

  it('lists knowledge tools exactly once after the group moved to a contribution', async () => {
    const adapter = new ToolsRegistryAdapter();
    const result = await adapter.execute({
      server: 'tools', tool: 'search', conversationId: 'conversation-a', args: { query: 'knowledge' },
    } as any) as any;
    const kn = result.results.filter((r: any) => r.server === 'knowledge');
    expect(kn.map((r: any) => r.name).sort()).toEqual(['list', 'read', 'search']);
    expect(result.total).toBe(kn.length); // no hand-written duplicate inflating the catalog (B1)
  });

  it('a disabled extension is not discoverable in the catalog (review P0-1)', async () => {
    const reg = buildExtensionRegistry([catalogExtension()], {
      isEnabled: () => false,
    });
    const adapter = new ToolsRegistryAdapter(() => reg);
    const result = await adapter.execute({
      server: 'tools', tool: 'search', conversationId: 'conversation-a', args: { query: 'catalogserver' },
    } as any) as any;
    expect(result.results.filter((r: any) => r.server === 'catalogserver')).toHaveLength(0);
  });

  it('an enabled-but-unavailable group stays discoverable: discovery reveals the capability, injection stays gated', async () => {
    const reg = buildExtensionRegistry([catalogExtension()]); // availability false
    const adapter = new ToolsRegistryAdapter(() => reg);
    const result = await adapter.execute({
      server: 'tools', tool: 'search', conversationId: 'conversation-a', args: { query: 'catalogserver' },
    } as any) as any;
    expect(result.results).toContainEqual(
      expect.objectContaining({ server: 'catalogserver', name: 'peek' }),
    );
  });
});
