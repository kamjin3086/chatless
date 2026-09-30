import type { McpTool } from '@/lib/mcp/McpClient';

export const TOOL_RESULT_SERVER_NAME = 'tool_result';
export const TOOL_RESULT_TOOLS: McpTool[] = [{
  name: 'read',
  description: 'Read another bounded page from a large tool result returned earlier in this run.',
  input_schema: { schema: { type: 'object', properties: {
    attachmentId: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' },
  }, required: ['attachmentId'] } },
}];
