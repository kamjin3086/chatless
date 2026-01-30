/**
 * filesystem MCP server 配置同步（写入 mcp_servers.json）
 *
 * 目标：
 * - 把“允许目录列表”（目录递归白名单）写入 `mcp_servers.json` 中 filesystem server 的 stdio args
 * - 写入后 best-effort 触发重连，让新 allowlist 即刻生效
 *
 * 说明：
 * - 本模块只负责“目录列表 -> MCP config args”的同步，不负责权限/alias 等元数据（由 filesystemAllowlistStore 管理）
 * - 约定：使用 @modelcontextprotocol/server-filesystem 的标准 stdio 形式：
 *   command: npx
 *   args: ["-y", "@modelcontextprotocol/server-filesystem", ...allowedDirPaths]
 */

import type { McpServerConfig } from '@/lib/mcp/McpClient';
import { normalizeDirectoryPath } from '@/lib/filesystemAllowlist/allowlist';

const SERVERS_CONFIG_FILE = 'mcp_servers.json';
const FILESYSTEM_SERVER_NAME = 'fs';

type SavedServer = {
  name: string;
  config: McpServerConfig;
  enabled?: boolean;
};

function uniqNormalizedDirs(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of input || []) {
    const n = normalizeDirectoryPath(p);
    if (!n) continue;
    const key = n.toLowerCase(); // Windows 近似大小写不敏感；即使在 mac/linux 也不影响展示
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function buildFilesystemConfigWithDirs(dirs: string[]): McpServerConfig {
  const allowedDirs = uniqNormalizedDirs(dirs);
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', ...allowedDirs],
    env: [],
  };
}

async function loadServers(): Promise<SavedServer[]> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load(SERVERS_CONFIG_FILE);
    const list = (await store.get<SavedServer[]>('servers')) || [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveServers(servers: SavedServer[]): Promise<void> {
  const { Store } = await import('@tauri-apps/plugin-store');
  const store = await Store.load(SERVERS_CONFIG_FILE);
  await store.set('servers', servers);
  await store.save();
}

export async function ensureFilesystemServerExists(): Promise<SavedServer> {
  const list = await loadServers();
  const existing = list.find((s) => s.name === FILESYSTEM_SERVER_NAME);
  if (existing) return existing;

  const created: SavedServer = {
    name: FILESYSTEM_SERVER_NAME,
    config: buildFilesystemConfigWithDirs([]),
    enabled: true,
  };
  await saveServers([created, ...list]);
  return created;
}

export async function setFilesystemAllowedDirectories(params: {
  directories: string[];
  reconnect?: boolean;
}): Promise<{ updated: boolean; server: SavedServer }> {
  const reconnect = params.reconnect !== false;
  const list = await loadServers();
  const idx = list.findIndex((s) => s.name === FILESYSTEM_SERVER_NAME);
  const nextConfig = buildFilesystemConfigWithDirs(params.directories || []);

  const nextServer: SavedServer = idx >= 0
    ? { ...list[idx], enabled: list[idx].enabled !== false, config: nextConfig }
    : { name: FILESYSTEM_SERVER_NAME, enabled: true, config: nextConfig };

  const nextList = idx >= 0
    ? list.map((s, i) => (i === idx ? nextServer : s))
    : [nextServer, ...list];

  // 判断是否有实质变化（避免无意义 save/reconnect）
  const prevArgs = idx >= 0 ? (list[idx].config?.args || []) : [];
  const nextArgs = nextConfig.args || [];
  const changed =
    idx < 0 ||
    list[idx].config?.type !== nextConfig.type ||
    list[idx].config?.command !== nextConfig.command ||
    JSON.stringify(prevArgs) !== JSON.stringify(nextArgs);

  if (changed) {
    await saveServers(nextList);
    if (reconnect) {
      try {
        const { serverManager } = await import('@/lib/mcp/ServerManager');
        await serverManager.reconnect(FILESYSTEM_SERVER_NAME, nextServer.config);
      } catch {
        // ignore: best-effort
      }
    }
  }

  return { updated: changed, server: nextServer };
}

