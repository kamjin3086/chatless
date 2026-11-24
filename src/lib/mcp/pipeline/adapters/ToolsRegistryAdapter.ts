/**
 * Capability directory. It intentionally has one operation: search the whole
 * enabled directory, then expose the selected capability on the next turn.
 */
import { androidCapabilities } from '@/lib/android/androidCapabilities';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { getToolsForGroup, TOOLS_DISCOVER_SERVER_NAME, TOOL_GROUPS, type ToolGroupId } from '@/lib/mcp/nativeTools/toolRegistry';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { getEnabledConfiguredServers } from '@/lib/mcp/chatIntegration';
import { persistentCache } from '@/lib/mcp/persistentCache';
import { isAndroidRuntime } from '@/lib/utils/runtimePlatform';
import { isReservedMcpServerName } from '@/lib/mcp/serverNamePolicy';

interface CatalogItem {
  source: 'builtin' | 'mcp';
  group?: ToolGroupId;
  server: string;
  name: string;
  description: string;
}

export class ToolsRegistryAdapter implements ToolAdapter {
  readonly server = TOOLS_DISCOVER_SERVER_NAME;

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

    const android = await androidCapabilities(conversationId);
    const builtin: CatalogItem[] = TOOL_GROUPS.flatMap((group) => getToolsForGroup(group.id, android).map(({ server, tool }) => ({
      source: 'builtin' as const,
      group: group.id,
      server,
      name: tool.name,
      description: tool.description || '',
    })));

    // A failing remote server only omits its own entries. Local discovery must
    // remain usable when a configured MCP endpoint is unavailable.
    const enabledServers = (await getEnabledConfiguredServers())
      .filter((server) => !isReservedMcpServerName(server));
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
      hint: page.length
        ? 'The matching capability becomes available in the next model step.'
        : androidHint(android),
    };
  }
}

/**
 * An empty search on a phone used to answer "No tools matched", which reads as "search
 * differently" and costs two more rounds. On Android the honest answer is that whole families do
 * not exist here, and that files arrive only when the user hands them over.
 */
function androidHint(android: { directory?: boolean }): string {
  if (!isAndroidRuntime())
    return 'No tools matched.';
  return (
    'No tools matched. This is an Android phone: there is no filesystem or shell tool here, so '
    + 'searching for one will keep returning nothing. Files come from a folder the user attaches '
    + '(android_directory__inventory), from photos they pick (android_photos__group), and from '
    + 'documents this chat already holds (android_document__search). '
    + (android.directory
      ? 'Folders are already authorized: call android_directory__inventory.'
      : 'Ask the user to attach the folder from the attachment menu.')
  );
}
