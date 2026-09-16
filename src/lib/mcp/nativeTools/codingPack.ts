import type { McpTool } from '@/lib/mcp/McpClient';

export const CODING_PACK_SERVER_NAME = 'code';

export const CODING_PROJECT_ATTACH_TOOL: McpTool = {
  name: 'attach',
  description: '挂载项目目录到当前会话（写入 allowlist，不扫描整机）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '项目根目录绝对路径' },
      },
      required: ['path'],
    },
  },
};

export const CODING_GLOB_TOOL: McpTool = {
  name: 'glob',
  description: '在授权目录内递归匹配文件（只读，结果截断）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '搜索根目录（@WorkDir 或绝对路径）' },
        pattern: { type: 'string', description: 'glob 模式，如 **/*.ts' },
        limit: { type: 'number', description: '最多返回条数（默认 200）' },
      },
      required: ['root', 'pattern'],
    },
  },
};

export const CODING_GREP_TOOL: McpTool = {
  name: 'grep',
  description: '在授权目录内搜索文本（只读，结果截断）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '搜索根目录' },
        query: { type: 'string', description: '搜索关键词或正则' },
        glob: { type: 'string', description: '文件名过滤（可选）' },
        limit: { type: 'number', description: '最多匹配条数（默认 100）' },
      },
      required: ['root', 'query'],
    },
  },
};

export const CODING_APPLY_PATCH_TOOL: McpTool = {
  name: 'apply_patch',
  description: '预览 unified diff/patch（默认不写入，需用户审批后配合 fs__write）',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标文件路径' },
        patch: { type: 'string', description: 'unified diff 或完整新内容' },
        mode: { type: 'string', enum: ['diff', 'replace'], description: 'diff=解析补丁；replace=整文件替换预览' },
      },
      required: ['path', 'patch'],
    },
  },
};

export const CODING_GIT_TOOL: McpTool = {
  name: 'git',
  description: '只读 git 命令（status/diff/log），在授权工作区内执行',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        subcommand: { type: 'string', enum: ['status', 'diff', 'log'], description: 'git 子命令' },
        args: { type: 'string', description: '附加参数（禁止含 force/reset）' },
        workingDir: { type: 'string', description: '仓库目录（默认 @WorkDir）' },
      },
      required: ['subcommand'],
    },
  },
};

export const CODING_DIAGNOSTICS_TOOL: McpTool = {
  name: 'diagnostics',
  description: '在授权目录运行受控诊断命令（lint/test），返回结构化输出',
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '如 pnpm test、pnpm lint:ci' },
        workingDir: { type: 'string', description: '工作目录（默认 @WorkDir）' },
        timeout: { type: 'number', description: '超时毫秒（默认 120000）' },
      },
      required: ['command'],
    },
  },
};

export const CODING_PACK_TOOLS: McpTool[] = [
  CODING_PROJECT_ATTACH_TOOL,
  CODING_GLOB_TOOL,
  CODING_GREP_TOOL,
  CODING_APPLY_PATCH_TOOL,
  CODING_GIT_TOOL,
  CODING_DIAGNOSTICS_TOOL,
];
