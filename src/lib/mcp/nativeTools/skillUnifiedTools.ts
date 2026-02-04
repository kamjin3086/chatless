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
  description: '列出已安装的技能（仅返回名称/ID，不含使用方法）。要使用技能必须先调用 skill__use 获取指南。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字' },
        mode: {
          type: 'string',
          enum: ['task', 'admin'],
          description: 'task=任务匹配 | admin=管理',
        },
        enabledOnly: { type: 'boolean', description: '仅已启用（默认 true）' },
        limit: { type: 'number', description: '最多条数（默认 30）' },
      },
      required: [],
    },
  },
};

export const SKILL_GUIDE_TOOL: McpTool = {
  name: 'guide',
  description: '获取技能的完整操作指南（SKILL.md）。返回内容包含：依赖检查、执行步骤、示例命令。调用后根据需要再读取其他文件。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（从 skill__list 获取）' },
        name: { type: 'string', description: 'Skill 名称（模糊匹配）' },
      },
      required: [],
    },
  },
};

// ============ 安装和卸载 ============

export const SKILL_INSTALL_TOOL: McpTool = {
  name: 'install',
  description: '安装技能（从 Git 仓库或 ZIP）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: 'Git 仓库地址（优先）' },
        zipPath: { type: 'string', description: 'ZIP 文件本地路径' },
        overwrite: { type: 'boolean', description: '是否覆盖已存在的同名技能' },
      },
      required: [],
    },
  },
};

export const SKILL_UNINSTALL_TOOL: McpTool = {
  name: 'uninstall',
  description: '卸载技能（需 confirm=true）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        confirm: { type: 'boolean', description: '必须为 true 才会卸载' },
      },
      required: ['id'],
    },
  },
};

// ============ 启用和禁用 ============

export const SKILL_ENABLE_TOOL: McpTool = {
  name: 'enable',
  description: '启用技能。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
      },
      required: ['id'],
    },
  },
};

export const SKILL_DISABLE_TOOL: McpTool = {
  name: 'disable',
  description: '禁用技能。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
      },
      required: ['id'],
    },
  },
};

// ============ 更新 ============

export const SKILL_UPDATE_TOOL: McpTool = {
  name: 'update',
  description: '更新技能（仅限 Git 安装的）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
      },
      required: ['id'],
    },
  },
};

// ============ 资源获取（只读，语义明确） ============

export const SKILL_LIST_RESOURCES_TOOL: McpTool = {
  name: 'list_resources',
  description: '列出技能提供的资源文件（模板、示例代码、配置样例）。用于了解 skill 包含哪些可参考的内容。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        max: { type: 'number', description: '最多返回多少个文件（默认 50）' },
      },
      required: ['id'],
    },
  },
};

export const SKILL_GET_TEMPLATE_TOOL: McpTool = {
  name: 'get_template',
  description: '获取技能提供的模板或示例代码（只读）。用于参考 skill 的最佳实践，然后用 fs__write 写入用户目录。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        name: { type: 'string', description: '资源文件名（从 skill__list_resources 获取）' },
        maxLines: { type: 'number', description: '最多读取行数（用于大文件）' },
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
  description: '编辑技能包的内部资源文件。⚠️ 仅当用户明确要求修改 skill 包本身时使用。普通任务输出请用 fs__write + @WorkDir。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        name: { type: 'string', description: '资源文件名（必填）' },
        content: { type: 'string', description: '新内容（必填）' },
      },
      required: ['id', 'name', 'content'],
    },
  },
};

// ============ 依赖检查 ============

export const SKILL_CHECK_DEPS_TOOL: McpTool = {
  name: 'check_deps',
  description: '检查技能依赖是否满足',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
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
