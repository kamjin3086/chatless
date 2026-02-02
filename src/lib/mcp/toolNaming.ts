/**
 * 统一的 server/tool 命名归一化与判断工具。
 *
 * 目的：
 * - 避免到处散落 `srv === 'filesystem' || srv === 'fs'` 这类判断
 * - 后续改名只需要改这一处
 */

export type CanonicalServerName =
  | 'fs'
  | 'shell'
  | 'web_search'
  | 'tools'
  | 'skills'
  | 'skills_fs'
  | 'user_fs'
  | 'ctx'
  | string;

function lc(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v).trim().toLowerCase();
  // 避免把 object/stringify 成 "[object Object]" 误入 server/tool 名
  return '';
}

export function normalizeServerName(server: unknown): CanonicalServerName {
  const s = lc(server);
  if (!s) return '';

  // filesystem 兼容
  if (s === 'filesystem' || s === 'file-system') return 'fs';

  // shell 兼容
  if (s === 'shell_executor' || s === 'shell-executor') return 'shell';

  // web 兼容
  if (s === 'web') return 'web_search';

  // 其它保持原样（已是 canonical 或第三方 mcp server）
  return s;
}

export function normalizeToolName(tool: unknown): string {
  return lc(tool);
}

export function isFilesystemServer(server: unknown): boolean {
  return normalizeServerName(server) === 'fs';
}

export function isShellServer(server: unknown): boolean {
  return normalizeServerName(server) === 'shell';
}

export function isWebServer(server: unknown): boolean {
  return normalizeServerName(server) === 'web_search';
}

export function isSkillsServer(server: unknown): boolean {
  const s = normalizeServerName(server);
  return s === 'skills' || s === 'skill';
}

export function isBuiltinServer(server: unknown): boolean {
  const s = normalizeServerName(server);
  return (
    s === 'fs' ||
    s === 'shell' ||
    s === 'web_search' ||
    s === 'skills' ||
    s === 'skills_fs' ||
    s === 'user_fs' ||
    s === 'ctx' ||
    s === 'tools'
  );
}

// ---------- filesystem tool helpers ----------
export function isFsListTool(tool: unknown): boolean {
  const t = normalizeToolName(tool);
  return t === 'ls' || t === 'list_directory' || t === 'list' || t === 'dir';
}

export function isFsMkdirTool(tool: unknown): boolean {
  const t = normalizeToolName(tool);
  return t === 'mkdir' || t === 'create_directory' || t === 'create';
}

export function isFsDeleteTool(tool: unknown): boolean {
  const t = normalizeToolName(tool);
  return t === 'rm' || t === 'delete_file' || t === 'delete';
}

export function isDirectorySemanticFsTool(tool: unknown): boolean {
  return isFsListTool(tool) || isFsMkdirTool(tool);
}

