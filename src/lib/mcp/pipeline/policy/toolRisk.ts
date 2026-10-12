import { normalizeServerName } from '@/lib/mcp/toolNaming';

/**
 * 一个 server + tool 组合的读写性质。
 *
 * 这张表取代了此前散落在 ToolExecutionPipeline 里的四份"哪些工具算只读"的说法：
 * 计划模式白名单（fs 分支）、文件系统操作种类、重试的只读判定，以及它们各自重复的
 * 正则。计划模式是否放行与失败后能否安全重放**不是同一件事**，所以这里是两个谓词，
 * 共用一份分类，而不是一个布尔。
 */
export type ToolRisk = 'read' | 'write' | 'create' | 'delete' | 'unknown';

/**
 * 文件系统工具的操作种类。判定不到的工具名落到 `unknown`——
 * 调用方（见 filesystemOp）对此有明确的兜底策略，不能在这里偷偷兜。
 *
 * 成员集合就是旧的那份 fs 只读正则加上写/创建/删除的显式名字，没有扩：
 * `list_files`、`search_files` 这类未登记的名字由 filesystemOp 兜底成 `read`，
 * 但不会因此变成计划模式可放行或失败可重放。
 */
const FS_RISK: Record<string, ToolRisk> = {
  read: 'read',
  read_file: 'read',
  list: 'read',
  list_directory: 'read',
  ls: 'read',
  dir: 'read',
  stat: 'read',
  exists: 'read',
  search: 'read',

  write: 'write',
  write_file: 'write',
  edit: 'write',
  edit_file: 'write',
  rename: 'write',
  rename_file: 'write',
  move: 'write',
  move_file: 'write',
  mv: 'write',

  mkdir: 'create',
  create: 'create',
  create_directory: 'create',

  delete: 'delete',
  delete_file: 'delete',
  rm: 'delete',
};

/**
 * 非文件系统 server 的读操作。只有列在这里的 server 才会参与"可重放"判定
 * （见 REPLAYABLE_SERVERS）；表里出现但不在该集合中的 server 只是为计划模式供数。
 *
 * 注意 `skill` 与 `skills` 是两个不同的 server 名，normalizeServerName 不会把它们
 * 归一。今天计划模式只放行 `skill`，`skills` 整条被禁——此处照原样保留，没有顺手"修好"。
 */
const READ_TOOLS: Record<string, string[]> = {
  knowledge: ['list', 'search', 'read'],
  web_search: ['search', 'fetch'],
  tools: ['search'],
  tool_result: ['read'],
  skill: ['list', 'guide', 'read_file', 'list_files', 'check_deps'],
  system: ['list_prompts', 'get_prompt'],
};

/**
 * 重跑不会多造副作用的 server。写完之后的超时不算——无从得知副作用是否已发生，
 * 所以只有读操作够格，且只限这些 server。
 */
const REPLAYABLE_SERVERS = new Set(['fs', 'knowledge', 'web_search', 'tools']);

/**
 * 计划模式下额外放行的非读操作。`skill__use` 是查资料用的执行入口，不是读操作，
 * 但计划模式今天放行它——写成显式例外，而不是把它的风险谎报成 `read`。
 */
const PLAN_ALLOWED_EXTRAS: Record<string, string[]> = {
  skill: ['use'],
};

function canonical(server: unknown): string {
  return normalizeServerName(server).toLowerCase();
}

function toolName(tool: unknown): string {
  // 只 lower、不 trim：旧的三处判定都是 `String(tool).toLowerCase()`，对带空格的
  // 工具名（如 ' Search '）判否。在这里 trim 就会把它们变成可放行 / 可重放。
  return String(tool ?? '').toLowerCase();
}

/** 这个 server + tool 组合的读写性质。 */
export function toolRisk(server: unknown, tool: unknown): ToolRisk {
  const srv = canonical(server);
  const tl = toolName(tool);
  if (!srv || !tl) return 'unknown';

  if (srv === 'fs') return FS_RISK[tl] ?? 'unknown';
  if (READ_TOOLS[srv]?.includes(tl)) return 'read';
  return 'unknown';
}

/**
 * 失败后可以照原样再跑一次的调用。判定只认表里显式登记为读的工具名：
 * 表外的 fs 工具名今天不在重试白名单里，换表之后也不能因为它们落到兜底就变成可重放。
 */
export function isReplayableRead(server: unknown, tool: unknown): boolean {
  const srv = canonical(server);
  return REPLAYABLE_SERVERS.has(srv) && toolRisk(srv, tool) === 'read';
}

/** 计划模式下是否放行这次调用。 */
export function isPlanOnlyAllowed(server: unknown, tool: unknown): boolean {
  const srv = canonical(server);
  const tl = toolName(tool);
  if (toolRisk(srv, tool) === 'read') return true;
  return PLAN_ALLOWED_EXTRAS[srv]?.includes(tl) ?? false;
}

export type FilesystemOp = 'read' | 'write' | 'create' | 'delete';

/**
 * 文件系统工具对应的权限种类。
 *
 * 判定不到的工具名按 `read` 处理——这是既有行为，保持不变：新增的 fs 工具默认走
 * "读"这条最不容易造成破坏的权限路径。判定为 `read` 不等于它是可重放的。
 */
export function filesystemOp(tool: unknown): FilesystemOp {
  const risk = toolRisk('fs', tool);
  return risk === 'unknown' ? 'read' : risk;
}
