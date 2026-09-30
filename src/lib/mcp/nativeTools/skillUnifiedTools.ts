/**
 * Skill 统一工具定义
 *
 * 将所有 skill 相关操作合并到一个工具组，遵循"Tool 越少，AI 越聪明"原则。
 *
 * ## 设计理念
 *
 * Skill 是"指导 AI 如何组合使用已有 Tools 完成任务"的模板，而不是"直接执行脚本"的容器。
 * AI 读取 SKILL.md 后，应该使用 shell__run、fs__*、web__* 等通用工具来执行任务。
 *
 * ## 工具列表（语义明确，避免与 fs 工具混淆）
 *
 * ### 使用类（只读）
 * - skill__list: 列出技能（仅返回名称/ID）
 * - skill__guide: 获取技能操作指南（SKILL.md）
 * - skill__get_template: 获取技能提供的模板/示例代码（只读）
 * - skill__list_resources: 列出技能提供的资源文件
 *
 * ### 管理类
 * - skill__install: 安装技能
 * - skill__uninstall: 卸载技能
 * - skill__update: 更新技能（从 Git 拉取最新版本）
 * - skill__enable: 启用技能
 * - skill__disable: 禁用技能
 * - skill__check_deps: 检查依赖
 *
 * ### 编辑类（需用户明确指示）
 * - skill__edit_resource: 编辑技能包的内部资源（仅用于修改 skill 包本身）
 *
 * ## 重要：skill 工具 vs fs 工具
 *
 * - skill__get_template: 获取 skill 包内的模板 → 用于参考
 * - skill__edit_resource: 编辑 skill 包资源 → 仅当用户要求修改 skill 本身
 * - fs__write: 写入用户文件 → 用于保存任务输出（默认选择）
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const SKILL_SERVER_NAME = 'skill';

// ============ 列表和查询 ============

export const SKILL_LIST_TOOL: McpTool = {
  name: 'list',
  description: 'List the installed skills (names and ids only, no usage). Call skill__guide before using one.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' },
        mode: {
          type: 'string',
          enum: ['task', 'admin'],
          description: 'task = match to a task | admin = administration',
        },
        enabledOnly: { type: 'boolean', description: 'Enabled skills only (default true)' },
        limit: { type: 'number', description: 'Maximum entries (default 30)' },
      },
      required: [],
    },
  },
};

export const SKILL_GUIDE_TOOL: McpTool = {
  name: 'guide',
  description: 'Read a skill\'s full guide (SKILL.md): dependency checks, steps and example commands. Read other files afterwards if the guide asks for it.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (from skill__list)' },
        name: { type: 'string', description: 'Skill name (fuzzy match)' },
      },
      required: [],
    },
  },
};

// ============ 安装和卸载 ============

export const SKILL_INSTALL_TOOL: McpTool = {
  name: 'install',
  description: 'Install a skill (from a git repository or a ZIP)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: 'Git repository URL (preferred)' },
        zipPath: { type: 'string', description: 'Local path of a ZIP file' },
        overwrite: { type: 'boolean', description: 'Overwrite a skill with the same name' },
      },
      required: [],
    },
  },
};

export const SKILL_UNINSTALL_TOOL: McpTool = {
  name: 'uninstall',
  description: 'Uninstall a skill (confirm=true is required)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
        confirm: { type: 'boolean', description: 'Must be true; otherwise nothing happens' },
      },
      required: ['id'],
    },
  },
};

// ============ 启用和禁用 ============

export const SKILL_ENABLE_TOOL: McpTool = {
  name: 'enable',
  description: 'Enable a skill.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
      },
      required: ['id'],
    },
  },
};

export const SKILL_DISABLE_TOOL: McpTool = {
  name: 'disable',
  description: 'Disable a skill.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
      },
      required: ['id'],
    },
  },
};

// ============ 更新 ============

export const SKILL_UPDATE_TOOL: McpTool = {
  name: 'update',
  description: 'Update a skill (git-installed skills only)',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
      },
      required: ['id'],
    },
  },
};

// ============ 资源获取（只读，语义明确） ============

export const SKILL_LIST_RESOURCES_TOOL: McpTool = {
  name: 'list_resources',
  description: 'List the resource files a skill ships (templates, example code, sample configs).',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
        max: { type: 'number', description: 'Maximum files to return (default 50)' },
      },
      required: ['id'],
    },
  },
};

export const SKILL_GET_TEMPLATE_TOOL: McpTool = {
  name: 'get_template',
  description: 'Read a template or example shipped by a skill (read-only). Reference it, then use fs__write to create the user\'s file.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
        name: { type: 'string', description: 'Resource file name (from skill__list_resources)' },
        maxLines: { type: 'number', description: 'Maximum lines to read (for large files)' },
      },
      required: ['id', 'name'],
    },
  },
};

// 保留旧名称的兼容性别名（内部映射到新工具）
export const SKILL_LIST_FILES_TOOL = SKILL_LIST_RESOURCES_TOOL;
export const SKILL_READ_FILE_TOOL = SKILL_GET_TEMPLATE_TOOL;

// ============ 编辑 skill 包（需用户明确指示） ============

export const SKILL_EDIT_RESOURCE_TOOL: McpTool = {
  name: 'edit_resource',
  description: 'Edit a file inside a skill package. Use ONLY when the user explicitly asks to change the skill itself; ordinary task output belongs in fs__write + @WorkDir.',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
        name: { type: 'string', description: 'Resource file name (required)' },
        content: { type: 'string', description: 'New content (required)' },
      },
      required: ['id', 'name', 'content'],
    },
  },
};

// ============ 依赖检查 ============

export const SKILL_CHECK_DEPS_TOOL: McpTool = {
  name: 'check_deps',
  description: 'Check whether the dependencies of a skill are satisfied',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id (required)' },
      },
      required: ['id'],
    },
  },
};

// ============ 导出 ============

export const SKILL_UNIFIED_TOOLS: McpTool[] = [
  // 使用类（只读）
  SKILL_LIST_TOOL,
  SKILL_GUIDE_TOOL,
  SKILL_LIST_RESOURCES_TOOL,
  SKILL_GET_TEMPLATE_TOOL,
  // 管理类
  SKILL_INSTALL_TOOL,
  SKILL_UNINSTALL_TOOL,
  SKILL_UPDATE_TOOL,
  SKILL_ENABLE_TOOL,
  SKILL_DISABLE_TOOL,
  SKILL_CHECK_DEPS_TOOL,
  // 编辑类（需用户明确指示）
  SKILL_EDIT_RESOURCE_TOOL,
];

// 兼容性导出（保留旧名称的别名）
export const SKILL_USE_TOOL = SKILL_GUIDE_TOOL;
export const SKILL_GET_TOOL = SKILL_GUIDE_TOOL;
export const SKILL_WRITE_FILE_TOOL = SKILL_EDIT_RESOURCE_TOOL; // 兼容旧名称
