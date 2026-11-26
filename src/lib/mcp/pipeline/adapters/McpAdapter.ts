import { ensureServerConnected } from '@/lib/mcp/executor/ConnectionManager';
import { serverManager } from '@/lib/mcp/ServerManager';
import { isBuiltinServer } from '@/lib/mcp/toolNaming';
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
    // The claim is the Registered-state view, shared with the config-time
    // check in ServerManager (one fact, one place).
    return getExtensionRegistry().serverClaim(name) === undefined;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    await ensureServerConnected(invocation.server);
    return serverManager.callTool(invocation.server, invocation.tool, invocation.args || undefined);
  }
}

