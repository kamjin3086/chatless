/**
 * Capability directory. It intentionally has one operation: search the whole
 * enabled directory, then expose the selected capability on the next turn.
 */
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { TOOLS_DISCOVER_SERVER_NAME, TOOL_GROUPS } from '@/lib/mcp/nativeTools/toolRegistry';
import { getExtensionRegistry } from '@/lib/extensions/assembly';
import type { ExtensionRegistry } from '@/lib/extensions/registry';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { getEnabledConfiguredServers } from '@/lib/mcp/chatIntegration';
import { persistentCache } from '@/lib/mcp/persistentCache';
import { RESERVED_MCP_SERVER_NAMES } from '@/lib/mcp/serverNamePolicy';

interface CatalogItem {
  source: 'builtin' | 'mcp';
  group?: string;
  server: string;
  name: string;
  description: string;
}

export class ToolsRegistryAdapter implements ToolAdapter {
  readonly server = TOOLS_DISCOVER_SERVER_NAME;

  // Injectable for tests (disabled-extension catalog case); production uses
  // the assembled singleton.
  constructor(
    private readonly registry: () => ExtensionRegistry = getExtensionRegistry,
  ) {}

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === TOOLS_DISCOVER_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    if (String(invocation.tool || '').toLowerCase() !== 'search') {
      return { ok: false, error: 'Unknown tools command. Use tools__search.' };
    }
    return this.handleSearch(invocation.args || {}, invocation.conversationId);
  }

  private async handleSearch(args: Record<string, unknown>, conversationId?: string): Promise<unknown> {
    const query = String(args.query || '').trim().toLowerCase();
    const offset = Math.max(0, Number(args.cursor || 0));
    const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));
    if (!query) return { ok: false, error: 'query is required' };

    const builtin: CatalogItem[] = TOOL_GROUPS.flatMap((group) => group.tools.map(({ server, tool }) => ({
      source: 'builtin' as const,
      group: group.id,
      server,
      name: tool.name,
      description: tool.description || '',
    })));
    // Contributed groups join the same catalog view through the ENABLED view
    // (Registry four states, external review P0-1): a disabled extension is
    // not discoverable (A05 "找不到"), while an enabled-but-unavailable group
    // stays discoverable - discovery reveals capability existence, injection
    // remains availability-gated. A hit on their group id requestLoads them
    // exactly like a hand-written group.
    for (const group of this.registry().enabledGroups()) {
      for (const t of group.tools) {
        builtin.push({
          source: 'builtin',
          group: group.id,
          server: group.server,
          name: String(t.definition.name),
          description: String(t.definition.description || ''),
        });
      }
    }

    // A failing remote server only omits its own entries. Local discovery must
    // remain usable when a configured MCP endpoint is unavailable.
    const enabledServers = (await getEnabledConfiguredServers())
      .filter((server) => !RESERVED_MCP_SERVER_NAMES.has(String(server || '').toLowerCase()));
    const external = await Promise.all(enabledServers.map(async (server): Promise<CatalogItem[]> => {
      try {
        const tools = await persistentCache.getToolsWithCache(server);
        return (Array.isArray(tools) ? tools : [])
          .filter((tool) => tool?.name)
          .map((tool) => ({
            source: 'mcp' as const,
            server,
            name: String(tool.name),
            description: String(tool.description || ''),
          }));
      } catch {
        return [];
      }
    }));

    const matches = [...builtin, ...external.flat()]
      .filter((item) => `${item.server} ${item.name} ${item.description}`.toLowerCase().includes(query));
    const page = matches.slice(offset, offset + limit);
    const groupsToLoad = [...new Set(page.flatMap((item) => item.group ? [item.group] : []))];
    const serversToLoad = [...new Set(page.filter((item) => item.source === 'mcp').map((item) => item.server))];
    const state = useToolLoadRequestStore.getState();
    for (const group of groupsToLoad) state.requestLoad(group, conversationId);
    for (const server of serversToLoad) state.loadMcpServer(server, conversationId);

    return {
      ok: true,
      query,
      results: page,
      nextCursor: offset + page.length < matches.length ? offset + page.length : null,
      total: matches.length,
      hint: page.length ? 'The matching capability becomes available in the next model step.' : 'No tools matched.',
    };
  }
}
