/**
 * 情景化意图规则与工具候选（不写死 server_name）
 * - 通过 toolName 定位支持该工具的 server（运行时解析）
 * - 每条规则仅输出极短指导语，避免冗长
 */

export type IntentMatcher =
  | { type: 'regex'; pattern: RegExp }
  | { type: 'anyOf'; patterns: RegExp[] };

export interface ToolCandidate {
  toolName: string;
  // 以最小可行参数为主，尽量不涉及用户私有路径
  argumentTemplate: string; // 例如 {"path":"."} 或 {"path":"<文件路径>"}
  // 可选的友好名称（展示用，避免写死 server）
  label?: string;
}

export interface IntentRule {
  id: string;
  matchers: IntentMatcher[];
  // 候选工具（按优先级排序）
  toolCandidates: ToolCandidate[];
  // 短提示语（在提示词里用于1行引导）
  hint: string;
}

/**
 * 基础规则集（后续可扩展）
 * 注意：只使用工具名，不写死 server_name
 */
export const INTENT_RULES: IntentRule[] = [
  {
    id: 'list-directory',
    matchers: [
      { type: 'regex', pattern: /(查看|列出|目录|文件|list\b|ls\b)/i }
    ],
    toolCandidates: [
      { toolName: 'list_directory', argumentTemplate: '{"path":"."}', label: '列出目录' },
      { toolName: 'directory_tree', argumentTemplate: '{"path":"."}', label: '目录树' }
    ],
    hint: 'To see a local directory or file listing, call a server that provides list_directory or directory_tree.'
  },
  {
    id: 'read-file',
    matchers: [
      { type: 'regex', pattern: /(读取|查看内容|打开|read\b|cat\b)/i }
    ],
    toolCandidates: [
      { toolName: 'read_file', argumentTemplate: '{"path":"<文件路径>"}', label: '读取文件' },
      { toolName: 'read_multiple_files', argumentTemplate: '{"paths":["<文件1>","<文件2>"]}', label: '读取多个文件' }
    ],
    hint: 'To read file contents, call a server that provides read_file/read_multiple_files.'
  },
  {
    id: 'write-file',
    matchers: [
      { type: 'anyOf', patterns: [/(写入|保存|新建|创建|覆盖)/i, /(file|写文件|write\b)/i] }
    ],
    toolCandidates: [
      { toolName: 'write_file', argumentTemplate: '{"path":"<文件路径>","content":"<文本>"}', label: '写入文件' },
      { toolName: 'edit_file', argumentTemplate: '{"path":"<文件路径>","patch":"<diff>"}', label: '编辑补丁' },
      { toolName: 'create_directory', argumentTemplate: '{"path":"<目录路径>"}', label: '新建目录' }
    ],
    hint: 'To create or modify files and directories, call a server that provides write_file/edit_file/create_directory.'
  },
  {
    id: 'move-file',
    matchers: [
      { type: 'regex', pattern: /(移动|重命名|rename|move_file)/i }
    ],
    toolCandidates: [
      { toolName: 'move_file', argumentTemplate: '{"from":"<源路径>","to":"<目标路径>"}', label: '移动/重命名' }
    ],
    hint: 'To move or rename files, call a server that provides move_file.'
  },
  {
    id: 'git-basic',
    matchers: [
      { type: 'regex', pattern: /\bgit\s*(status|diff|commit|add|reset|log)\b/i }
    ],
    toolCandidates: [
      { toolName: 'git_status', argumentTemplate: '{}', label: 'git status' },
      { toolName: 'git_diff_unstaged', argumentTemplate: '{}', label: 'git diff (未暂存)' },
      { toolName: 'git_diff_staged', argumentTemplate: '{}', label: 'git diff --staged' },
      { toolName: 'git_add', argumentTemplate: '{"paths":["<文件或目录>"]}', label: 'git add' },
      { toolName: 'git_commit', argumentTemplate: '{"message":"<提交说明>"}', label: 'git commit' },
      { toolName: 'git_log', argumentTemplate: '{}', label: 'git log' },
      { toolName: 'git_reset', argumentTemplate: '{"paths":["<文件或目录>"]}', label: 'git reset' }
    ],
    hint: 'To run git operations, call a server with the matching git_* tools (status/diff/commit/add/reset/log and so on).'
  }
];


