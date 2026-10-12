import { findUnresolvedAlias, findUnresolvedAliasInValues, resolveAllowlistPath, type AllowlistDirectory } from '@/lib/filesystemAllowlist';
import { ToolInvocation } from '../ToolInvocation';

/**
 * 一次调用的解析产物：把模型给的别名和相对路径落成真实路径，附带关于这次调用的事实。
 *
 * 这一层刻意只做解析：不读 store、不查授权、不做任何决策。allowlist 目录和会话工作目录
 * 由调用方读好后传进来（见 ToolExecutionPipeline），这样解析结果完全由入参决定，
 * "参数里的 @WorkDir 到底落成了什么"第一次成为一个有名字、可单独测试的东西。
 *
 * 此前这份中间状态没有名字，只以 `args` / `execArgs` / `execInvocation.args` 三种取法
 * 散在调用路径上，所以同一份解析结果在九个地方被以不同方式重新取用。
 */

/**
 * 别名没解析出来或路径解析失败。调用方负责给出结构化拒绝——放过去就会造出一个
 * 字面量 `@WorkDir` 目录，这正是本模块存在的理由之一。
 */
export type CallResolutionRejected = {
  kind: 'reject';
  /** 没能解析的别名，保留原样的 `@` 前缀（拒绝文案直接拼它）。 */
  alias: string;
  /** 解析失败的原始信息，有则优先于别名提示。 */
  reason?: string;
};

export type CallResolutionResolved = {
  kind: 'resolved';
  /** 可以直接交给 adapter 执行的那份调用，参数已落成绝对路径。 */
  invocation: ToolInvocation;
  /** 用于权限检查的主路径；没有主路径时为空串。 */
  primaryPath: string;
  /** 模型原本要动的那个路径（未经解析），拒绝时给卡片用来对照“问了什么 vs 落成了什么”。 */
  requestedPath: string;
  /** 主路径命中的允许名单目录，未命中为 undefined。 */
  directory?: AllowlistDirectory;
};

export type FilesystemCallResolution = CallResolutionRejected | CallResolutionResolved;

/** 取父目录；盘符根（C:/）保持自身。解析与审批两侧共用这一份。 */
export function dirnameOf(path: string): string {
  const s = String(path ?? '').replace(/\\/g, '/').trim();
  if (!s) return '';
  if (/^[A-Za-z]:\/$/.test(s)) return s;
  const i = s.lastIndexOf('/');
  return i <= 0 ? s : s.slice(0, i);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 这次调用带没带需要解析的路径参数。
 *
 * 单独导出来是因为调用方要用它决定要不要去读 allowlist / 同步后端：一个不带任何
 * 路径参数的 fs 调用不值得触发这些。它与 resolveFilesystemCall 内部判据同一份，
 * 不会出现两边不一致。
 */
export function hasFilesystemPaths(args: unknown): boolean {
  const a = (args || {}) as Record<string, unknown>;
  const inputPath = str(a.path) || str(a.dir) || str(a.root) || str(a.oldPath);
  const hasNewPath = !!str(a.newPath);
  const hasPaths = Array.isArray(a.paths) && a.paths.some((p) => String(p ?? '').trim());
  return !!inputPath || hasNewPath || !!hasPaths;
}

/**
 * 解析文件系统调用的所有路径参数：`path` / `dir` / `root` 走主路径，
 * `oldPath` / `newPath`（rename、move）与 `paths`（delete_many）各自解析。
 *
 * 调用方先用 hasFilesystemPaths 判短：一个不带任何路径参数的 fs 调用今天不走
 * 审批也不读 allowlist，那一层短路留在调用方。
 *
 * `resolveAllowlistPath` 对未授权别名和空路径抛错，这里不吞：调用方外层把它变成
 * 文件系统门禁失败，与原行为一致。
 */
export function resolveFilesystemCall(params: {
  invocation: ToolInvocation;
  cardId: string;
  directories: AllowlistDirectory[];
  workingDir?: string;
}): FilesystemCallResolution {
  const args = (params.invocation.args || {}) as Record<string, unknown>;
  const directories = params.directories;
  const workingDir = params.workingDir;

  const rawPath = str(args.path);
  const rawDir = str(args.dir);
  const rawOldPath = str(args.oldPath);
  const rawNewPath = str(args.newPath);
  // fs__search 用 root 指定根目录而不是 path/dir。
  const rawRoot = str(args.root);
  const rawPaths = Array.isArray(args.paths)
    ? (args.paths as unknown[]).map((p) => String(p ?? '').trim()).filter(Boolean)
    : [];

  // 主路径用于权限检查。
  const inputPath = rawPath || rawDir || rawRoot || rawOldPath || '';

  let resolveError: string | undefined;
  const resolvePath = (p: string): string => {
    if (!p.trim()) return '';
    try {
      return resolveAllowlistPath({ inputPath: p, directories, workingDir }).absolutePath;
    } catch (error) {
      resolveError ||= error instanceof Error ? error.message : String(error);
      return p;
    }
  };

  let resolved: ReturnType<typeof resolveAllowlistPath> | null = null;
  if (inputPath) {
    try {
      resolved = resolveAllowlistPath({ inputPath, directories, workingDir });
    } catch (error) {
      resolveError ||= error instanceof Error ? error.message : String(error);
    }
  }

  const execArgs: Record<string, unknown> = { ...args };
  if (resolved) {
    if (rawPath) execArgs.path = resolved.absolutePath;
    if (rawDir) execArgs.dir = resolved.absolutePath;
    if (rawRoot) execArgs.root = resolved.absolutePath;
  }
  if (rawOldPath) execArgs.oldPath = resolvePath(rawOldPath);
  if (rawNewPath) execArgs.newPath = resolvePath(rawNewPath);
  if (rawPaths.length > 0) execArgs.paths = rawPaths.map(resolvePath).filter(Boolean);

  // 别名没解析出来（未授权或拼错）、或路径根本解析不了：不要把原始字符串交给后端，
  // 那正是字面量 "@WorkDir" 目录的由来。
  const leftoverAlias = findUnresolvedAliasInValues([
    execArgs.path, execArgs.dir, execArgs.root, execArgs.oldPath, execArgs.newPath,
    ...(Array.isArray(execArgs.paths) ? (execArgs.paths as unknown[]) : []),
  ]);
  if (leftoverAlias || resolveError) {
    return {
      kind: 'reject',
      alias: leftoverAlias || findUnresolvedAlias(inputPath) || '',
      reason: resolveError,
    };
  }

  const invocation = params.invocation;
  return {
    kind: 'resolved',
    invocation: new ToolInvocation({
      assistantMessageId: invocation.assistantMessageId,
      conversationId: invocation.conversationId,
      server: invocation.server,
      tool: invocation.tool,
      args: execArgs,
      provider: invocation.provider,
      model: invocation.model,
      historyForLlm: invocation.historyForLlm,
      originalUserContent: invocation.originalUserContent,
      callId: invocation.callId,
      cardId: params.cardId,
      lockKey: invocation.lockKey,
    }),
    primaryPath: resolved?.absolutePath || '',
    requestedPath: inputPath,
    directory: resolved?.directory,
  };
}
