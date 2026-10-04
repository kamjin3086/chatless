import type { McpTool } from '@/lib/mcp/McpClient';

/**
 * System Prompts 原生工具
 *
 * 目标：把"提示词管理"能力封装成可被 Agent 调用的工具。
 * 命名约定：{server}__{tool}
 * 例如：system__list_prompts、system__update_prompt
 */

export const SYSTEM_SERVER_NAME = 'system';

export const SYSTEM_LIST_PROMPTS_TOOL: McpTool = {
  name: 'list_prompts',
  description: 'List prompts',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' },
        tag: { type: 'string', description: 'Filter by tag' },
        favoriteOnly: { type: 'boolean', description: 'Favourites only' },
        limit: { type: 'number', description: 'Maximum entries' },
      },
      required: [],
    },
  },
};

export const SYSTEM_GET_PROMPT_TOOL: McpTool = {
  name: 'get_prompt',
  description: 'Read one prompt',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Prompt id' },
        name: { type: 'string', description: 'Prompt name' },
      },
      required: [],
    },
  },
};

export const SYSTEM_CREATE_PROMPT_TOOL: McpTool = {
  name: 'create_prompt',
  description: 'Create a prompt',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name' },
        content: { type: 'string', description: 'Content' },
        description: { type: 'string', description: 'Description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
        shortcuts: { type: 'array', items: { type: 'string' }, description: 'Shortcuts' },
        favorite: { type: 'boolean', description: 'Mark as favourite' },
      },
      required: ['name', 'content'],
    },
  },
};

export const SYSTEM_UPDATE_PROMPT_TOOL: McpTool = {
  name: 'update_prompt',
  description: 'Update a prompt',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Prompt id' },
        name: { type: 'string', description: 'Name' },
        content: { type: 'string', description: 'Content' },
        description: { type: 'string', description: 'Description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
        shortcuts: { type: 'array', items: { type: 'string' }, description: 'Shortcuts' },
        favorite: { type: 'boolean', description: 'Favourite flag' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_DELETE_PROMPT_TOOL: McpTool = {
  name: 'delete_prompt',
  description: 'Delete a prompt (confirm=true is required)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Prompt id' },
        confirm: { type: 'boolean', description: 'Confirm the deletion' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_OPTIMIZE_PROMPT_TOOL: McpTool = {
  name: 'optimize_prompt',
  description: 'Suggest improvements for a prompt',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Prompt id' },
        optimization_goal: { type: 'string', description: 'What to optimise for' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_PROMPT_TOOLS: McpTool[] = [
  SYSTEM_LIST_PROMPTS_TOOL,
  SYSTEM_GET_PROMPT_TOOL,
  SYSTEM_CREATE_PROMPT_TOOL,
  SYSTEM_UPDATE_PROMPT_TOOL,
  SYSTEM_DELETE_PROMPT_TOOL,
  SYSTEM_OPTIMIZE_PROMPT_TOOL,
];
