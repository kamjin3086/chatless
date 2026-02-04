import type { McpTool } from '@/lib/mcp/McpClient';

/**
 * System Skills 原生工具
 *
 * 目标：把“Skill 管理”能力封装成可被 Agent 调用的工具。
 * 命名约定：system__list_skills、system__install_skill_from_git 等。
 */

export const SYSTEM_SERVER_NAME = 'system';

export const SYSTEM_LIST_SKILLS_TOOL: McpTool = {
  name: 'list_skills',
  description:
    '列出已安装的技能。返回包含 id、name、pathAlias 等信息。\n' +
    '**重要**：返回结果中的 pathAlias（如 @skill:docx）可用于后续访问 skill 内部文件。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（匹配 id/name/description，大小写不敏感）' },
        status: { type: 'string', description: '状态过滤（可选）：installed | needs_update | not_installed | error' },
        source: { type: 'string', description: '来源过滤（可选）：local | remote' },
        enabledOnly: { type: 'boolean', description: '仅返回已启用技能（可选，默认 false）' },
        limit: { type: 'number', description: '最多返回条数（可选，默认 30，上限 200）' },
      },
      required: [],
    },
  },
};

export const SYSTEM_GET_SKILL_TOOL: McpTool = {
  name: 'get_skill',
  description:
    '获取 Skill 详情，包括版本、路径别名、文件访问指南等元信息。\n' +
    '**重要**：返回结果包含 fileAccessGuide，指导如何使用 skills_fs 工具组访问 skill 内部文件。\n' +
    '访问 skill 内部文件时，必须使用 skills_fs__read_skill_resource，不要使用 fs__read。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（推荐）' },
        name: { type: 'string', description: 'Skill 名称（精确或近似匹配）' },
      },
      required: [],
    },
  },
};

export const SYSTEM_INSTALL_SKILL_FROM_GIT_TOOL: McpTool = {
  name: 'install_skill_from_git',
  description:
    '从 Git 仓库克隆安装 Skill（需要系统 Git 与 shell 插件）。\n' +
    '成功后会刷新技能列表。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        repoUrl: { type: 'string', description: 'Git 仓库地址（必填）' },
      },
      required: ['repoUrl'],
    },
  },
};

export const SYSTEM_INSTALL_SKILL_FROM_ZIP_TOOL: McpTool = {
  name: 'install_skill_from_zip',
  description:
    '从 ZIP 文件导入安装 Skill（前端解压）。\n' +
    '注意：filePath 必须是本机可访问路径。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'ZIP 文件路径（必填）' },
        targetSkillId: { type: 'string', description: '可选：覆盖安装到指定 skill id（用于“更新/覆盖”）' },
        overwrite: { type: 'boolean', description: '是否允许覆盖（可选，默认 false）' },
      },
      required: ['filePath'],
    },
  },
};

export const SYSTEM_UNINSTALL_SKILL_TOOL: McpTool = {
  name: 'uninstall_skill',
  description:
    '卸载 Skill（危险操作，删除本地技能文件夹）。\n' +
    '默认需要 confirm=true 才会执行，以避免误删。',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID（必填）' },
        confirm: { type: 'boolean', description: '必须为 true 才会卸载（安全确认）' },
      },
      required: ['id'],
    },
  },
};

export const SYSTEM_ENABLE_SKILL_TOOL: McpTool = {
  name: 'enable_skill',
  description: '启用 Skill（按 id）。',
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

export const SYSTEM_DISABLE_SKILL_TOOL: McpTool = {
  name: 'disable_skill',
  description: '禁用 Skill（按 id）。',
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

export const SYSTEM_UPDATE_SKILL_TOOL: McpTool = {
  name: 'update_skill',
  description:
    '更新 Skill（仅适用于 Git 安装的技能，内部执行 git pull）。\n' +
    '如果不是 Git 安装的技能，请使用 system__install_skill_from_zip 进行覆盖导入。',
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

export const SYSTEM_SKILL_TOOLS: McpTool[] = [
  SYSTEM_LIST_SKILLS_TOOL,
  SYSTEM_GET_SKILL_TOOL,
  SYSTEM_INSTALL_SKILL_FROM_GIT_TOOL,
  SYSTEM_INSTALL_SKILL_FROM_ZIP_TOOL,
  SYSTEM_UNINSTALL_SKILL_TOOL,
  SYSTEM_ENABLE_SKILL_TOOL,
  SYSTEM_DISABLE_SKILL_TOOL,
  SYSTEM_UPDATE_SKILL_TOOL,
];

