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
  'filesystem',
  'shell_executor',
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

