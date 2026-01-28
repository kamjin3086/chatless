import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { FILESYSTEM_SERVER_NAME, FILESYSTEM_TOOLS } from '@/lib/mcp/nativeTools/filesystem';
import { SHELL_EXECUTOR_SERVER_NAME, SHELL_EXECUTOR_TOOLS } from '@/lib/mcp/nativeTools/shellExecutor';

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

function inferFromBareToolName(toolName: string): Normalized | null {
  const t = String(toolName || '').trim();
  if (!t) return null;

  // 1) 兼容某些模型/后端“把 server 前缀变成下划线”的输出（例如 filesystem_rename_file）
  if (t.startsWith('filesystem_')) {
    return { serverName: FILESYSTEM_SERVER_NAME, toolName: t.slice('filesystem_'.length) };
  }
  if (t.startsWith('shell_executor_')) {
    return { serverName: SHELL_EXECUTOR_SERVER_NAME, toolName: t.slice('shell_executor_'.length) };
  }
  if (t.startsWith('web_search_')) {
    return { serverName: WEB_SEARCH_SERVER_NAME, toolName: t.slice('web_search_'.length) };
  }

  // 2) 兼容“server 缺失”的裸工具名（例如 rename_file / execute_command / search）
  const fsSet = new Set(FILESYSTEM_TOOLS.map((x) => x.name));
  if (fsSet.has(t)) return { serverName: FILESYSTEM_SERVER_NAME, toolName: t };
  if (t === 'read' || t === 'write' || t === 'list' || t === 'dir' || t === 'mkdir' || t === 'create' || t === 'delete') {
    return { serverName: FILESYSTEM_SERVER_NAME, toolName: t };
  }

  const shSet = new Set(SHELL_EXECUTOR_TOOLS.map((x) => x.name));
  if (shSet.has(t)) return { serverName: SHELL_EXECUTOR_SERVER_NAME, toolName: t };

  if (t === 'search' || t === 'fetch') return { serverName: WEB_SEARCH_SERVER_NAME, toolName: t };

  return null;
}

/**
 * 将 provider/toolcall 里的 name 归一化为 {serverName, toolName}：
 * - 优先识别 `server__tool` / `server.tool`
 * - 若 serverName 是 `default`（表示“无前缀”），则基于工具名推断 server
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
    return fromToolName;
  }

  // 2) serverName/toolName 已分离
  if (rawServer && rawServer !== 'default') {
    return { serverName: rawServer, toolName: rawTool };
  }

  // 3) serverName=default：尝试从裸工具名推断
  const inferred = inferFromBareToolName(rawTool);
  if (inferred) return inferred;

  return { serverName: rawServer || 'default', toolName: rawTool };
}

