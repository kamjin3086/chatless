import type { McpTool } from '@/lib/mcp/McpClient';

/**
 * System Prompts 原生工具
 *
 * 目标：把“提示词管理”能力封装成可被 Agent 调用的工具。
 * 命名约定：{server}__{tool}
 * 例如：system__list_prompts、system__update_prompt
 */

export const SYSTEM_SERVER_NAME = 'system';

export const SYSTEM_LIST_PROMPTS_TOOL: McpTool = {
  name: 'list_prompts',
  description:
    '列出提示词（支持搜索/筛选/限量）。用于找到要操作的提示词 ID。\n' +
    '建议：优先用 query 精确搜索名称，limit 不要太大（默认 20）。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（匹配 name/description/tags/shortcuts，大小写不敏感）' },
        tag: { type: 'string', description: '按标签过滤（可选）' },
        favoriteOnly: { type: 'boolean', description: '仅返回收藏（可选，默认 false）' },
        limit: { type: 'number', description: '最多返回条数（可选，默认 20，上限 100）' },
      },
      required: [],
    },
  },
};

export const SYSTEM_GET_PROMPT_TOOL: McpTool = {
  name: 'get_prompt',
  description:
    '获取提示词详情。你必须提供 id 或 name（至少一个）。\n' +
    '返回内容包含：name/description/content/tags/shortcuts/favorite/updatedAt 等。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID（推荐）' },
        name: { type: 'string', description: '提示词名称（精确或近似匹配）' },
      },
      required: [],
    },
  },
};

export const SYSTEM_CREATE_PROMPT_TOOL: McpTool = {
  name: 'create_prompt',
  description:
    '创建提示词。\n' +
    '注意：shortcuts 建议不带 /，系统会自动规范化。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '提示词名称（必填）' },
        content: { type: 'string', description: '提示词内容（必填）' },
        description: { type: 'string', description: '描述（可选）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签数组（可选）' },
        shortcuts: { type: 'array', items: { type: 'string' }, description: '快捷指令数组（可选）' },
        favorite: { type: 'boolean', description: '是否收藏（可选，默认 false）' },
      },
      required: ['name', 'content'],
    },
  },
};

export const SYSTEM_UPDATE_PROMPT_TOOL: McpTool = {
  name: 'update_prompt',
  description:
    '更新提示词（按 id 更新）。只传你想修改的字段即可。\n' +
    '注意：如果 content/name/description 发生变化，会自动写入“修改历史”（最多保留最近 10 次）。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID（必填）' },
        name: { type: 'string', description: '名称（可选）' },
        content: { type: 'string', description: '内容（可选）' },
        description: { type: 'string', description: '描述（可选）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签数组（可选）' },
        shortcuts: { type: 'array', items: { type: 'string' }, description: '快捷指令数组（可选）' },
        favorite: { type: 'boolean', description: '收藏状态（可选）' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_DELETE_PROMPT_TOOL: McpTool = {
  name: 'delete_prompt',
  description:
    '删除提示词（危险操作）。\n' +
    '默认需要 confirm=true 才会执行，以避免误删。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID（必填）' },
        confirm: { type: 'boolean', description: '必须为 true 才会删除（安全确认）' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_OPTIMIZE_PROMPT_TOOL: McpTool = {
  name: 'optimize_prompt',
  description:
    '基于现有提示词生成“优化建议”，不会直接覆盖保存。\n' +
    '返回 proposedContent；如需应用，请再调用 system__update_prompt。\n' +
    '注意：会尽量保留 {{变量}}，避免破坏已有模板。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 ID（必填）' },
        optimization_goal: { type: 'string', description: '优化目标（可选），例如：更简洁、更结构化、更严格输出格式' },
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

