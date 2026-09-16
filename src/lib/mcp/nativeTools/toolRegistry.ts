/**
 * 工具注册表 - 分层工具管理
 * 
 * 设计原则：Tool 越少，AI 越聪明
 * 
 * 分层架构：
 * 1. 核心层（core）：始终注入，精简到最小
 * 2. 能力组（groups）：按意图检测动态注入
 * 3. 发现机制：AI 可通过 tools__discover 查看未加载的工具
 */

import type { McpTool } from '@/lib/mcp/McpClient';
import { FILESYSTEM_SERVER_NAME, FILESYSTEM_TOOLS } from './filesystem';
import { SHELL_EXECUTOR_SERVER_NAME, SHELL_EXECUTOR_TOOLS } from './shellExecutor';
import { WEB_SEARCH_SERVER_NAME, WEB_SEARCH_TOOLS } from './webSearch';
import { AGENT_CONTEXT_SERVER_NAME, AGENT_CONTEXT_TOOLS } from './agentContext';
import { SYSTEM_SERVER_NAME, SYSTEM_PROMPT_TOOLS } from './systemPrompts';
import { SKILL_SERVER_NAME, SKILL_UNIFIED_TOOLS } from './skillUnifiedTools';
import { CODING_PACK_SERVER_NAME, CODING_PACK_TOOLS } from './codingPack';
import { KNOWLEDGE_SERVER_NAME, KNOWLEDGE_TOOLS } from './knowledge';
import { INTERACTION_SERVER_NAME, INTERACTION_TOOLS } from './interaction';

// ============ 工具组定义 ============

export type ToolGroupId = 
  | 'core'      // 核心：始终加载（fs + shell + web）
  | 'ctx'       // 上下文管理（复杂任务）
  | 'skill'     // 技能系统
  | 'prompt'    // 提示词管理
  | 'coding'    // Coding Pack（默认关闭）
  | 'knowledge'; // 知识库（会话挂载 KB + Agent 模式）

export interface ToolGroup {
  id: ToolGroupId;
  name: string;
  description: string;
  /** 意图关键词（用于自动检测） */
  intentKeywords: RegExp[];
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
    intentKeywords: [], // 始终加载，无需关键词
    tools: [
      ...CORE_FS_TOOLS.map(t => ({ server: FILESYSTEM_SERVER_NAME, tool: t })),
      ...CORE_SHELL_TOOLS.map(t => ({ server: SHELL_EXECUTOR_SERVER_NAME, tool: t })),
      ...CORE_WEB_TOOLS.map(t => ({ server: WEB_SEARCH_SERVER_NAME, tool: t })),
      ...INTERACTION_TOOLS.map(t => ({ server: INTERACTION_SERVER_NAME, tool: t })),
    ],
  },
  {
    id: 'ctx',
    name: '上下文管理',
    description: '任务计划、研究记录、错误日志（复杂任务用）',
    intentKeywords: [
      /计划|规划|plan|todo|步骤/i,
      /研究|分析|调研|research/i,
      /记录|日志|log|追踪/i,
      /复杂|多步|分阶段|长期/i,
      /断点|继续|恢复|resume/i,
    ],
    tools: AGENT_CONTEXT_TOOLS.map(t => ({ server: AGENT_CONTEXT_SERVER_NAME, tool: t })),
  },
  {
    id: 'skill',
    name: '技能系统',
    description: '技能查询、管理和文件操作',
    intentKeywords: [
      /@skill|技能|skill/i,
      /管理.*技能|技能.*管理/i,
      /安装.*技能|卸载.*技能|启用.*技能|禁用.*技能|更新.*技能/i,
      /列出.*技能|查看.*技能|技能列表/i,
      /skill.*list|skill.*install|skill.*uninstall|skill.*get/i,
    ],
    tools: SKILL_UNIFIED_TOOLS.map(t => ({ server: SKILL_SERVER_NAME, tool: t })),
  },
  {
    id: 'prompt',
    name: '提示词管理',
    description: '管理提示词（列出、创建、编辑、删除、优化）',
    intentKeywords: [
      /提示词|prompt|指令|system\s*prompt/i,
      /列出.*提示|查看.*提示|搜索.*提示|找.*提示/i,
      /创建.*提示|新建.*提示|添加.*提示|写.*提示/i,
      /修改.*提示|编辑.*提示|更新.*提示|改.*提示/i,
      /删除.*提示|移除.*提示/i,
      /优化.*提示|改进.*提示|润色.*提示/i,
    ],
    tools: SYSTEM_PROMPT_TOOLS.map(t => ({ server: SYSTEM_SERVER_NAME, tool: t })),
  },
  {
    id: 'coding',
    name: 'Coding Pack',
    description: '项目挂载、glob/grep、patch 预览、git 只读、诊断（默认关闭）',
    intentKeywords: [
      /代码库|代码库|repository|repo/i,
      /glob|grep|ripgrep|搜索文件/i,
      /patch|diff|apply_patch/i,
      /git\s+(status|diff|log)/i,
      /lint|test|诊断|diagnostic/i,
      /挂载项目|attach.*project/i,
    ],
    tools: CODING_PACK_TOOLS.map(t => ({ server: CODING_PACK_SERVER_NAME, tool: t })),
  },
  {
    id: 'knowledge',
    name: '知识库',
    description: 'knowledge_search / knowledge_read（会话挂载知识库时）',
    intentKeywords: [
      /知识库|knowledge\s*base/i,
      /检索|搜索.*文档|查.*资料/i,
      /knowledge_search|knowledge_read/i,
    ],
    tools: KNOWLEDGE_TOOLS.map(t => ({ server: KNOWLEDGE_SERVER_NAME, tool: t })),
  },
];

// ============ 工具发现工具定义 ============

export const TOOLS_DISCOVER_SERVER_NAME = 'tools';

export const TOOLS_DISCOVER_TOOL: McpTool = {
  name: 'discover',
  description: '查看可用但未加载的工具组',
  input_schema: {
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const TOOLS_LOAD_TOOL: McpTool = {
  name: 'load',
  description: '加载工具组（ctx/skill/prompt）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          enum: ['ctx', 'skill', 'prompt', 'coding', 'knowledge'],
          description: '要加载的工具组 ID',
        },
      },
      required: ['group'],
    },
  },
};

export const TOOLS_SEARCH_TOOL: McpTool = {
  name: 'search',
  description: 'Search the complete tool catalog by name or description. Results can be loaded for the next model step.',
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
  TOOLS_DISCOVER_TOOL,
  TOOLS_LOAD_TOOL,
  TOOLS_SEARCH_TOOL,
];

// ============ 意图检测 ============

/**
 * 检测用户输入匹配哪些工具组
 */
export function detectToolGroupIntents(content: string): ToolGroupId[] {
  const matched: ToolGroupId[] = [];
  
  for (const group of TOOL_GROUPS) {
    if (group.id === 'core') continue; // 核心组始终加载，跳过
    
    const isMatched = group.intentKeywords.some(pattern => pattern.test(content));
    if (isMatched) {
      matched.push(group.id);
    }
  }
  
  return matched;
}

/**
 * 检测是否是复杂任务（需要上下文管理）
 */
export function detectComplexTaskIntent(content: string): boolean {
  const complexPatterns = [
    /帮我.{10,}/,  // 长请求通常是复杂任务
    /多个|批量|所有|全部|每个/,
    /步骤|阶段|流程|计划/,
    /首先|然后|最后|接下来/,
    /分析|研究|调研|比较/,
    /项目|工程|应用|系统/,
  ];
  
  return complexPatterns.some(p => p.test(content));
}

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
