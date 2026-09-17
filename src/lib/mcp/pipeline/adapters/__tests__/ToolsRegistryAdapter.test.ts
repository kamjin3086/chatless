import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsRegistryAdapter } from '../ToolsRegistryAdapter';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';

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
});
