import type { McpTool } from '@/lib/mcp/McpClient';

export const INTERACTION_SERVER_NAME = 'interaction';

export const ASK_USER_TOOL: McpTool = {
  name: 'ask_user',
  description: 'Ask the user one focused clarifying question and wait for an answer.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to show the user.' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional short choices.' },
      },
      required: ['question'],
    },
  },
};

export const UPDATE_PLAN_TOOL: McpTool = {
  name: 'update_plan',
  description: 'Show a small task plan and update the status of its steps.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'string' } },
        current: { type: 'number' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] },
      },
      required: ['steps'],
    },
  },
};

export const INTERACTION_TOOLS: McpTool[] = [ASK_USER_TOOL, UPDATE_PLAN_TOOL];

