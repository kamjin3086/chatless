import { ensureServerConnected } from '@/lib/mcp/executor/ConnectionManager';
import { serverManager } from '@/lib/mcp/ServerManager';
import { isBuiltinServer } from '@/lib/mcp/toolNaming';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class McpAdapter implements ToolAdapter {
  readonly server = '*';

  canHandle(invocation: ToolInvocation): boolean {
    const name = String(invocation.server || '');
    return name.length > 0 && !isBuiltinServer(name);
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    await ensureServerConnected(invocation.server);
    return serverManager.callTool(invocation.server, invocation.tool, invocation.args || undefined);
  }
}

