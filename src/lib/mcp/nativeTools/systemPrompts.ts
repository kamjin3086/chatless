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
  description: '列出提示词',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字' },
        tag: { type: 'string', description: '按标签过滤' },
        favoriteOnly: { type: 'boolean', description: '仅返回收藏' },
        limit: { type: 'number', description: '最多返回条数' },
      },
      required: [],
    },
  },
};

export const SYSTEM_GET_PROMPT_TOOL: McpTool = {
  name: 'get_prompt',
  description: '获取提示词详情',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID' },
        name: { type: 'string', description: '提示词名称' },
      },
      required: [],
    },
  },
};

export const SYSTEM_CREATE_PROMPT_TOOL: McpTool = {
  name: 'create_prompt',
  description: '创建提示词',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '名称' },
        content: { type: 'string', description: '内容' },
        description: { type: 'string', description: '描述' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        shortcuts: { type: 'array', items: { type: 'string' }, description: '快捷指令' },
        favorite: { type: 'boolean', description: '是否收藏' },
      },
      required: ['name', 'content'],
    },
  },
};

export const SYSTEM_UPDATE_PROMPT_TOOL: McpTool = {
  name: 'update_prompt',
  description: '更新提示词',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID' },
        name: { type: 'string', description: '名称' },
        content: { type: 'string', description: '内容' },
        description: { type: 'string', description: '描述' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        shortcuts: { type: 'array', items: { type: 'string' }, description: '快捷指令' },
        favorite: { type: 'boolean', description: '收藏状态' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_DELETE_PROMPT_TOOL: McpTool = {
  name: 'delete_prompt',
  description: '删除提示词（需 confirm=true）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID' },
        confirm: { type: 'boolean', description: '确认删除' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_OPTIMIZE_PROMPT_TOOL: McpTool = {
  name: 'optimize_prompt',
  description: '生成提示词优化建议',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID' },
        optimization_goal: { type: 'string', description: '优化目标' },
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
