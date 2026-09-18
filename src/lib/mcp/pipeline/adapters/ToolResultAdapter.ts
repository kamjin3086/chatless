import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { TOOL_RESULT_SERVER_NAME } from '@/lib/mcp/nativeTools/toolResult';
import { readToolResultAttachment } from '@/lib/mcp/toolResultAttachments';

export class ToolResultAdapter implements ToolAdapter {
  readonly server = TOOL_RESULT_SERVER_NAME;
  canHandle(invocation: ToolInvocation): boolean { return invocation.server === TOOL_RESULT_SERVER_NAME; }
  execute(invocation: ToolInvocation): Promise<unknown> {
    return readToolResultAttachment({ id: String(invocation.args?.attachmentId || ''),
      conversationId: invocation.conversationId, runId: invocation.assistantMessageId,
      offset: Number(invocation.args?.offset || 0), limit: Number(invocation.args?.limit || 8000) });
  }
}
