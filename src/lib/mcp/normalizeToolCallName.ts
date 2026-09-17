import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { FILESYSTEM_SERVER_NAME, FILESYSTEM_TOOLS } from '@/lib/mcp/nativeTools/filesystem';
import { SHELL_EXECUTOR_SERVER_NAME, SHELL_EXECUTOR_TOOLS } from '@/lib/mcp/nativeTools/shellExecutor';
import { AGENT_CONTEXT_SERVER_NAME, AGENT_CONTEXT_TOOLS } from '@/lib/mcp/nativeTools/agentContext';

type Normalized = { serverName: string; toolName: string };

function splitByPrefix(name: string): Normalized | null {
  if (!name) return null;
  if (name.includes('__')) {
    const parts = name.split('__');
    const serverName = parts[0] || '';
    const toolName = parts.slice(1).join('__') || '';
    return { serverName, toolName };
  }
  if (name.includes('.')) {
    const parts = name.split('.');
    const serverName = parts[0] || '';
    const toolName = parts.slice(1).join('.') || '';
    return { serverName, toolName };
  }
  return null;
}

/** 旧 fs 工具名 → 新工具名 */
function normalizeOldFsToolName(name: string): string {
  const map: Record<string, string> = {
    'read_file': 'read',
    'write_file': 'write',
    'list_directory': 'ls',
    'create_directory': 'mkdir',
    'delete_file': 'rm',
    'rename_file': 'mv',
  };
  return map[name] || name;
}

/** 旧 shell 工具名 → 新工具名 */
function normalizeOldShellToolName(name: string): string {
  const map: Record<string, string> = {
    'execute_command': 'run',
    'execute': 'run',
    'exec': 'run',
  };
  return map[name] || name;
}

function inferFromBareToolName(toolName: string): Normalized | null {
  const t = String(toolName || '').trim();
  if (!t) return null;

  // 1) 兼容旧格式（模型可能输出旧的长名称）
  if (t.startsWith('filesystem_') || t.startsWith('fs_')) {
    const suffix = t.startsWith('filesystem_') ? t.slice('filesystem_'.length) : t.slice('fs_'.length);
    return { serverName: FILESYSTEM_SERVER_NAME, toolName: normalizeOldFsToolName(suffix) };
  }
  if (t.startsWith('shell_executor_') || t.startsWith('shell_')) {
    const suffix = t.startsWith('shell_executor_') ? t.slice('shell_executor_'.length) : t.slice('shell_'.length);
    return { serverName: SHELL_EXECUTOR_SERVER_NAME, toolName: normalizeOldShellToolName(suffix) };
  }
  if (t.startsWith('web_search_') || t.startsWith('web_')) {
    const suffix = t.startsWith('web_search_') ? t.slice('web_search_'.length) : t.slice('web_'.length);
    return { serverName: WEB_SEARCH_SERVER_NAME, toolName: suffix };
  }

  // 2) 兼容裸工具名
  const fsSet = new Set(FILESYSTEM_TOOLS.map((x) => x.name));
  if (fsSet.has(t)) return { serverName: FILESYSTEM_SERVER_NAME, toolName: t };
  // 兼容旧工具名
  const oldFsName = normalizeOldFsToolName(t);
  if (fsSet.has(oldFsName)) return { serverName: FILESYSTEM_SERVER_NAME, toolName: oldFsName };
  // 常见别名
  if (t === 'read' || t === 'read_file') return { serverName: FILESYSTEM_SERVER_NAME, toolName: 'read' };
  if (t === 'write' || t === 'write_file') return { serverName: FILESYSTEM_SERVER_NAME, toolName: 'write' };
  if (t === 'ls' || t === 'list' || t === 'dir' || t === 'list_directory') return { serverName: FILESYSTEM_SERVER_NAME, toolName: 'ls' };
  if (t === 'mkdir' || t === 'create' || t === 'create_directory') return { serverName: FILESYSTEM_SERVER_NAME, toolName: 'mkdir' };
  if (t === 'rm' || t === 'delete' || t === 'delete_file') return { serverName: FILESYSTEM_SERVER_NAME, toolName: 'rm' };
  if (t === 'mv' || t === 'rename' || t === 'rename_file') return { serverName: FILESYSTEM_SERVER_NAME, toolName: 'mv' };

  const shSet = new Set(SHELL_EXECUTOR_TOOLS.map((x) => x.name));
  if (shSet.has(t)) return { serverName: SHELL_EXECUTOR_SERVER_NAME, toolName: t };
  if (t === 'run' || t === 'exec' || t === 'execute' || t === 'execute_command') {
    return { serverName: SHELL_EXECUTOR_SERVER_NAME, toolName: 'run' };
  }

  if (t === 'search' || t === 'fetch' || t === 'download') {
    return { serverName: WEB_SEARCH_SERVER_NAME, toolName: t };
  }

  // Agent Context 工具
  const ctxSet = new Set(AGENT_CONTEXT_TOOLS.map((x) => x.name));
  if (ctxSet.has(t)) return { serverName: AGENT_CONTEXT_SERVER_NAME, toolName: t };
  if (t === 'save_research' || t === 'save_plan' || t === 'log_error' || t === 'update_step') {
    return { serverName: AGENT_CONTEXT_SERVER_NAME, toolName: t };
  }
  if (t.startsWith('ctx_')) {
    return { serverName: AGENT_CONTEXT_SERVER_NAME, toolName: t.slice('ctx_'.length) };
  }

  // Tools Registry 工具
  if (t.startsWith('tools_')) {
    return { serverName: 'tools', toolName: t.slice('tools_'.length) };
  }

  return null;
}

/**
 * 将 provider/toolcall 里的 name 归一化为 {serverName, toolName}：
 * - 优先识别 `server__tool` / `server.tool`
 * - 若 serverName 是 `default`（表示"无前缀"），则基于工具名推断 server
 * - 兼容旧格式工具名（如 filesystem__read_file → fs__read）
 */
export function normalizeToolCallServerAndTool(params: {
  serverName?: string;
  toolName?: string;
}): Normalized {
  const rawServer = String(params.serverName || '').trim();
  const rawTool = String(params.toolName || '').trim();

  // 1) toolName 本身带前缀（优先）
  const fromToolName = splitByPrefix(rawTool);
  if (fromToolName && fromToolName.serverName && fromToolName.toolName) {
    // 规范化 server 名
    let sn = fromToolName.serverName;
    let tn = fromToolName.toolName;
    if (sn === 'filesystem') sn = FILESYSTEM_SERVER_NAME;
    if (sn === 'shell_executor') sn = SHELL_EXECUTOR_SERVER_NAME;
    if (sn === 'web_search') sn = WEB_SEARCH_SERVER_NAME;
    // 规范化 tool 名
    if (sn === FILESYSTEM_SERVER_NAME) tn = normalizeOldFsToolName(tn);
    if (sn === SHELL_EXECUTOR_SERVER_NAME) tn = normalizeOldShellToolName(tn);
    return { serverName: sn, toolName: tn };
  }

  // 2) serverName/toolName 已分离
  if (rawServer && rawServer !== 'default') {
    let sn = rawServer;
    let tn = rawTool;
    // 规范化
    if (sn === 'filesystem') sn = FILESYSTEM_SERVER_NAME;
    if (sn === 'shell_executor') sn = SHELL_EXECUTOR_SERVER_NAME;
    if (sn === 'web_search') sn = WEB_SEARCH_SERVER_NAME;
    if (sn === FILESYSTEM_SERVER_NAME) tn = normalizeOldFsToolName(tn);
    if (sn === SHELL_EXECUTOR_SERVER_NAME) tn = normalizeOldShellToolName(tn);
    return { serverName: sn, toolName: tn };
  }

  // 3) serverName=default：尝试从裸工具名推断
  const inferred = inferFromBareToolName(rawTool);
  if (inferred) return inferred;

  return { serverName: rawServer || 'default', toolName: rawTool };
}
