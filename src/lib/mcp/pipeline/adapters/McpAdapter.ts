import { ensureServerConnected } from '@/lib/mcp/executor/ConnectionManager';
import { serverManager } from '@/lib/mcp/ServerManager';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

const BUILTIN_SERVERS = new Set<string>([
  'web_search',
  'skills',
  'skill',
  'skills_fs',
  'user_fs',
  'shell_executor',
  // filesystem 是 MCP 概念层，本 adapter 仍可以处理它（但授权策略通常更严格）
]);

export class McpAdapter implements ToolAdapter {
  readonly server = '*';

  canHandle(invocation: ToolInvocation): boolean {
    const name = String(invocation.server || '');
    return name.length > 0 && !BUILTIN_SERVERS.has(name);
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    await ensureServerConnected(invocation.server);
    return serverManager.callTool(invocation.server, invocation.tool, invocation.args || undefined);
  }
}

