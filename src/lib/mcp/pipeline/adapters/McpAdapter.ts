import { ensureServerConnected } from '@/lib/mcp/executor/ConnectionManager';
import { serverManager } from '@/lib/mcp/ServerManager';
import { isBuiltinServer, normalizeServerName } from '@/lib/mcp/toolNaming';
import { getExtensionRegistry } from '@/lib/extensions/assembly';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class McpAdapter implements ToolAdapter {
  readonly server = '*';

  canHandle(invocation: ToolInvocation): boolean {
    const name = String(invocation.server || '');
    if (name.length === 0 || isBuiltinServer(name)) return false;
    // A05: a contributed server never falls through to the external MCP path,
    // disabled or not ("no execution, no external MCP fallback" - plan §11.1).
    // The FULL groups view is used on purpose: the enabled view would send a
    // disabled contribution's server here, which is the fallback A05 forbids.
    // Same claim semantics as ContributionAdapter (normalized server names).
    return !getExtensionRegistry()
      .groups()
      .some((g) => normalizeServerName(g.server) === normalizeServerName(name));
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    await ensureServerConnected(invocation.server);
    return serverManager.callTool(invocation.server, invocation.tool, invocation.args || undefined);
  }
}

