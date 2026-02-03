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
import { SYSTEM_SKILL_TOOLS } from './systemSkills';

// ============ 工具组定义 ============

export type ToolGroupId = 
  | 'core'      // 核心：始终加载
  | 'fs_extra'  // 文件扩展：mkdir, rm, mv
  | 'shell'     // 命令执行
  | 'web'       // 网络：搜索、抓取、下载
  | 'ctx'       // 上下文管理
  | 'skills'    // 技能系统
  | 'system';   // 系统管理（提示词、技能管理）

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

const CORE_FS_TOOLS = FILESYSTEM_TOOLS.filter(t => 
  ['read', 'write', 'ls'].includes(t.name)
);

// ============ 文件扩展工具 ============

const EXTRA_FS_TOOLS = FILESYSTEM_TOOLS.filter(t => 
  ['mkdir', 'rm', 'mv'].includes(t.name)
);

// ============ 工具组注册表 ============

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'core',
    name: '核心文件',
    description: '基础文件读写（read, write, ls）',
    intentKeywords: [], // 始终加载，无需关键词
    tools: CORE_FS_TOOLS.map(t => ({ server: FILESYSTEM_SERVER_NAME, tool: t })),
  },
  {
    id: 'fs_extra',
    name: '文件管理',
    description: '创建目录、删除、移动文件（mkdir, rm, mv）',
    intentKeywords: [
      /创建.*(目录|文件夹)|mkdir|新建目录/i,
      /删除|移除|清理|rm\s|remove/i,
      /移动|重命名|mv\s|rename|move/i,
      /整理|归档|批量/i,
    ],
    tools: EXTRA_FS_TOOLS.map(t => ({ server: FILESYSTEM_SERVER_NAME, tool: t })),
  },
  {
    id: 'shell',
    name: '命令执行',
    description: '运行系统命令和脚本（git, npm, python 等）',
    intentKeywords: [
      /运行|执行|run|exec|命令|脚本/i,
      /\b(git|npm|pnpm|yarn|pip|python|node|cargo)\b/i,
      /安装|install|build|编译|打包/i,
      /终端|terminal|shell|命令行/i,
    ],
    tools: SHELL_EXECUTOR_TOOLS.map(t => ({ server: SHELL_EXECUTOR_SERVER_NAME, tool: t })),
  },
  {
    id: 'web',
    name: '网络工具',
    description: '搜索、抓取网页、下载文件',
    intentKeywords: [
      /搜索|search|查找|找一下|查一下/i,
      /谷歌|google|百度|bing|必应/i,
      /网页|网站|url|链接|抓取|fetch|爬取/i,
      /下载|download|保存.*图片|获取.*文件/i,
      /天气|新闻|汇率|股价|最新/i,
      /\b(http|https|www\.)/i,
    ],
    tools: WEB_SEARCH_TOOLS.map(t => ({ server: WEB_SEARCH_SERVER_NAME, tool: t })),
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
    id: 'skills',
    name: '技能系统',
    description: '预定义的任务模板和专业能力',
    intentKeywords: [
      /@skill|技能|skill/i,
      // 其他技能触发词由 detectSkillIntent 处理
    ],
    tools: [], // 动态从 skillTools 获取
  },
  {
    id: 'system',
    name: '系统管理',
    description: '管理提示词和技能（列出、创建、编辑、删除、启用/禁用）',
    intentKeywords: [
      // 提示词管理
      /提示词|prompt|指令|system\s*prompt/i,
      /列出.*提示|查看.*提示|搜索.*提示|找.*提示/i,
      /创建.*提示|新建.*提示|添加.*提示|写.*提示/i,
      /修改.*提示|编辑.*提示|更新.*提示|改.*提示/i,
      /删除.*提示|移除.*提示/i,
      /优化.*提示|改进.*提示|润色.*提示/i,
      // 技能管理
      /管理.*技能|技能.*管理/i,
      /安装.*技能|卸载.*技能|启用.*技能|禁用.*技能|更新.*技能/i,
      /列出.*技能|查看.*技能/i,
      /技能列表|skill.*list|skill.*install|skill.*uninstall/i,
    ],
    tools: [
      ...SYSTEM_PROMPT_TOOLS.map(t => ({ server: SYSTEM_SERVER_NAME, tool: t })),
      ...SYSTEM_SKILL_TOOLS.map(t => ({ server: SYSTEM_SERVER_NAME, tool: t })),
    ],
  },
];

// ============ 工具发现工具定义 ============

export const TOOLS_DISCOVER_SERVER_NAME = 'tools';

export const TOOLS_DISCOVER_TOOL: McpTool = {
  name: 'discover',
  description: `查看可用但未加载的工具组。

**返回内容**：
- 已加载的工具组
- 未加载但可用的工具组（含描述）

**何时使用**：
- 当前工具无法完成任务时
- 需要了解系统还有什么能力时

**注意**：这是一个"发现"工具，不是"执行"工具。`,
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
  description: `请求加载特定工具组。

调用后，下一轮对话将包含该组的工具。

**可用的组**：
- fs_extra: 文件管理（mkdir, rm, mv）
- shell: 命令执行（git, npm, python）
- web: 网络工具（搜索、抓取、下载）
- ctx: 上下文管理（计划、研究、错误记录）
- skills: 技能系统
- system: 系统管理（提示词、技能管理）`,
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        group: {
          type: 'string',
          enum: ['fs_extra', 'shell', 'web', 'ctx', 'skills', 'system'],
          description: '要加载的工具组 ID',
        },
      },
      required: ['group'],
    },
  },
};

export const TOOLS_REGISTRY_TOOLS: McpTool[] = [
  TOOLS_DISCOVER_TOOL,
  TOOLS_LOAD_TOOL,
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
