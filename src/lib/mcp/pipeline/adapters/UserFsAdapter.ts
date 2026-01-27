import { USER_FS_SERVER_NAME, executeUserFsTool, isUserFsTool } from '@/lib/userFs/userFsTools';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class UserFsAdapter implements ToolAdapter {
  readonly server = USER_FS_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === USER_FS_SERVER_NAME || isUserFsTool(invocation.tool);
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    return executeUserFsTool(invocation.tool, invocation.args || {});
  }
}

