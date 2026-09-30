/**
 * 工具注册表 - 分层工具管理
 * 
 * 设计原则：Tool 越少，AI 越聪明
 * 
 * 分层架构：
 * 1. 核心层（core）：始终注入，精简到最小
 * 2. 能力组（groups）：按意图检测动态注入
 * 3. 发现机制：AI 通过 tools__search 分页搜索完整目录，匹配组在下一步生效
 */

import type { McpTool } from '@/lib/mcp/McpClient';
import { FILESYSTEM_SERVER_NAME, FILESYSTEM_TOOLS } from './filesystem';
import { SHELL_EXECUTOR_SERVER_NAME, SHELL_EXECUTOR_TOOLS } from './shellExecutor';
import { WEB_SEARCH_SERVER_NAME, WEB_SEARCH_TOOLS } from './webSearch';
import { SYSTEM_SERVER_NAME, SYSTEM_PROMPT_TOOLS } from './systemPrompts';
import { SKILL_SERVER_NAME, SKILL_UNIFIED_TOOLS } from './skillUnifiedTools';
import { KNOWLEDGE_SERVER_NAME, KNOWLEDGE_TOOLS } from './knowledge';
import { TOOL_RESULT_SERVER_NAME, TOOL_RESULT_TOOLS } from './toolResult';

// ============ 工具组定义 ============

export type ToolGroupId = 
  | 'core'      // 核心：始终加载（fs + shell + web）
  | 'skill'     // 技能系统
  | 'prompt'    // 提示词管理
  | 'knowledge'; // 知识库（会话挂载 KB + Agent 模式）

export interface ToolGroup {
  id: ToolGroupId;
  name: string;
  description: string;
  /** 该组包含的工具 */
  tools: Array<{
    server: string;
    tool: McpTool;
  }>;
}

// ============ 核心工具（始终注入） ============

// 文件工具：全部纳入 core（避免 fs vs fs_extra 的决策复杂度）
const CORE_FS_TOOLS = FILESYSTEM_TOOLS;

// Shell 工具：高频使用，纳入 core（避免每次都要 load shell 组）
const CORE_SHELL_TOOLS = SHELL_EXECUTOR_TOOLS;

// Web 工具：常见需求，且只有 3 个工具，约 200 tokens，纳入 core
const CORE_WEB_TOOLS = WEB_SEARCH_TOOLS;

// ============ 工具组注册表 ============

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'core',
    name: '核心工具',
    description: '文件操作 + 命令执行 + 网络搜索',
    tools: [
      ...CORE_FS_TOOLS.map(t => ({ server: FILESYSTEM_SERVER_NAME, tool: t })),
      ...CORE_SHELL_TOOLS.map(t => ({ server: SHELL_EXECUTOR_SERVER_NAME, tool: t })),
      ...CORE_WEB_TOOLS.map(t => ({ server: WEB_SEARCH_SERVER_NAME, tool: t })),
      ...TOOL_RESULT_TOOLS.map(t => ({ server: TOOL_RESULT_SERVER_NAME, tool: t })),
    ],
  },
  {
    id: 'skill',
    name: '技能系统',
    description: '技能查询、管理和文件操作',
    tools: SKILL_UNIFIED_TOOLS.map(t => ({ server: SKILL_SERVER_NAME, tool: t })),
  },
  {
    id: 'prompt',
    name: '提示词管理',
    description: '管理提示词（列出、创建、编辑、删除、优化）',
    tools: SYSTEM_PROMPT_TOOLS.map(t => ({ server: SYSTEM_SERVER_NAME, tool: t })),
  },
  {
    id: 'knowledge',
    name: '知识库',
    description: 'knowledge_search / knowledge_read（会话挂载知识库时）',
    tools: KNOWLEDGE_TOOLS.map(t => ({ server: KNOWLEDGE_SERVER_NAME, tool: t })),
  },
];

// ============ 工具发现工具定义 ============

export const TOOLS_DISCOVER_SERVER_NAME = 'tools';

export const TOOLS_SEARCH_TOOL: McpTool = {
  name: 'search',
  description: 'Search the complete tool catalog by name or description. Matching capability groups become available in the next model step.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Tool or capability keywords.' },
        cursor: { type: 'number', description: 'Zero-based result offset.' },
        limit: { type: 'number', description: 'Maximum results (default 20, max 50).' },
      },
      required: ['query'],
    },
  },
};

export const TOOLS_REGISTRY_TOOLS: McpTool[] = [
  TOOLS_SEARCH_TOOL,
];

/**
 * 获取指定组的工具列表
 */
export function getToolsForGroup(groupId: ToolGroupId): Array<{ server: string; tool: McpTool }> {
  const group = TOOL_GROUPS.find(g => g.id === groupId);
  return group?.tools || [];
}

/**
 * 获取所有组的摘要信息
 */
export function getGroupsSummary(): Array<{
  id: ToolGroupId;
  name: string;
  description: string;
  toolCount: number;
}> {
  return TOOL_GROUPS.filter(g => g.id !== 'core').map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    toolCount: g.tools.length,
  }));
}
