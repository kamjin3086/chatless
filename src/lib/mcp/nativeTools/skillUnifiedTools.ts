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
 * ## 工具列表
 *
 * - skill__list: 列出技能（支持任务模式和管理模式）
 * - skill__use: 使用技能 - 获取完整指导（含 SKILL.md 内容）
 * - skill__install: 安装技能（从 Git 或 ZIP）
 * - skill__uninstall: 卸载技能
 * - skill__enable: 启用技能
 * - skill__disable: 禁用技能
 * - skill__update: 更新技能
 * - skill__list_files: 列出技能内部资源文件
 * - skill__read_file: 读取技能内部资源文件
 * - skill__write_file: 写入技能内部文件
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

export const SKILL_USE_TOOL: McpTool = {
  name: 'use',
  description: '【必须】获取技能的完整操作指南。skill__list 只返回名称，必须调用此工具才能知道如何正确使用技能。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（从 skill__list 获取）' },
        name: { type: 'string', description: 'Skill 名称（模糊匹配）' },
        includeContent: {
          type: 'boolean',
          description: '是否包含 SKILL.md 完整内容（默认 true）',
        },
        startLine: { type: 'number', description: '起始行号（用于分段读取大文件）' },
        endLine: { type: 'number', description: '结束行号' },
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

// ============ 文件操作 ============

export const SKILL_LIST_FILES_TOOL: McpTool = {
  name: 'list_files',
  description: '列出技能内部资源文件',
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

export const SKILL_READ_FILE_TOOL: McpTool = {
  name: 'read_file',
  description: '读取技能内部资源文件',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        path: { type: 'string', description: '相对 skill 目录的文件路径（必填）' },
        maxLines: { type: 'number', description: '最多读取行数（用于大文件）' },
      },
      required: ['id', 'path'],
    },
  },
};

export const SKILL_WRITE_FILE_TOOL: McpTool = {
  name: 'write_file',
  description: '写入技能内部文件',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        path: { type: 'string', description: '相对 skill 目录的文件路径（必填）' },
        content: { type: 'string', description: '要写入的内容（必填）' },
      },
      required: ['id', 'path', 'content'],
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
  SKILL_LIST_TOOL,
  SKILL_USE_TOOL,
  SKILL_INSTALL_TOOL,
  SKILL_UNINSTALL_TOOL,
  SKILL_ENABLE_TOOL,
  SKILL_DISABLE_TOOL,
  SKILL_UPDATE_TOOL,
  SKILL_LIST_FILES_TOOL,
  SKILL_READ_FILE_TOOL,
  SKILL_WRITE_FILE_TOOL,
  SKILL_CHECK_DEPS_TOOL,
];

// 兼容性导出（保留旧名称的别名）
export const SKILL_GET_TOOL = SKILL_USE_TOOL;
