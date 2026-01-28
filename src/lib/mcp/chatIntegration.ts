import StorageUtil from '@/lib/storage';
import { McpServerConfig } from './McpClient'; // Added for getAllConfiguredServersWithStatus
import { normalizeSavedServers } from './serverNamePolicy';

const STORE_FILE = 'mcp-status.json'; // For conversation-specific MCP status
const SETTINGS_FILE = 'mcp-settings.json'; // For global enabled MCP list
const SERVERS_CONFIG_FILE = 'mcp_servers.json'; // For server configurations

// 解析模型输出中的 MCP 工具调用
// 支持：
// 1) 推荐格式：<use_mcp_tool><server_name>...</server_name><tool_name>...</tool_name><arguments>{...}</arguments></use_mcp_tool>
// 2) 兼容格式：<tool_call>{"type":"tool_call","server":"filesystem","tool":"list","parameters":{...}}</tool_call>
// 3) 纯 JSON：{"type":"tool_call","server":"filesystem","tool":"list","parameters":{...}}
// 3) 前缀/代码块包裹 ```json ... ```
// 旧版文本解析器已废弃；统一由 StreamTokenizer 负责工具调用解析，thinking由Provider层处理

// Retrieves all configured servers from settings, optionally filtered by 'enabled' status
export async function getAllConfiguredServers(onlyEnabled: boolean = false): Promise<string[]> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load(SERVERS_CONFIG_FILE);
    type Saved = { name: string; enabled?: boolean; config?: unknown };
    const raw = (await store.get<Saved[]>('servers')) || [];
    const { list, renames } = normalizeSavedServers<Saved>(Array.isArray(raw) ? raw : []);
    if (renames.length) {
      try {
        await store.set('servers', list);
        await store.save();
      } catch {
        // ignore
      }
    }
    return Array.isArray(list)
      ? list.filter((s: any) => !onlyEnabled || s.enabled !== false).map((s: any) => s.name).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

// Retrieves all configured servers with their full config and current connection status
export async function getAllConfiguredServersWithStatus(): Promise<Array<{ name: string; config: McpServerConfig; status: string; enabled: boolean }>> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load(SERVERS_CONFIG_FILE);
    type Saved = { name: string; config: McpServerConfig; enabled?: boolean };
    const raw = (await store.get<Saved[]>('servers')) || [];
    const { list, renames } = normalizeSavedServers<Saved>(Array.isArray(raw) ? raw : []);
    if (renames.length) {
      try {
        await store.set('servers', list);
        await store.save();
      } catch {
        // ignore
      }
    }
    
    // 使用zustand store获取当前状态
    const { useMcpStore } = await import('@/store/mcpStore');
    const currentStatuses = useMcpStore.getState().serverStatuses;
    
    return Array.isArray(list)
      ? list.map(s => ({
          name: s.name,
          config: s.config,
          status: currentStatuses[s.name] || 'disconnected',
          enabled: s.enabled !== false, // Default to true if not set
        }))
      : [];
  } catch (e) {
    console.error('Failed to load configured servers with status:', e);
    return [];
  }
}

// Retrieves names of currently connected servers (runtime or persisted)
export async function getConnectedServers(): Promise<string[]> {
  try {
    const allEnabled = await getAllConfiguredServers(true);
    // 使用zustand store获取当前状态
    const { useMcpStore } = await import('@/store/mcpStore');
    const currentStatuses = useMcpStore.getState().serverStatuses;
    
    // 仅依据运行时状态，避免历史脏值造成"已连接"假象
    return allEnabled.filter((name) => currentStatuses[name] === 'connected');
  } catch (error) {
    console.error('Failed to get connected servers:', error);
    return [];
  }
}

// Retrieves conversation-specific enabled servers (deprecated in favor of global)
export async function getEnabledServersForConversation(conversationId: string): Promise<string[]> {
  if (!conversationId) return [];
  return (
    (await StorageUtil.getItem<string[]>(`conv_${conversationId}_enabled_mcp`, [], STORE_FILE)) || []
  );
}

// Sets conversation-specific enabled servers (deprecated in favor of global)
export async function setEnabledServersForConversation(conversationId: string, servers: string[]): Promise<void> {
  if (!conversationId) return;
  await StorageUtil.setItem(`conv_${conversationId}_enabled_mcp`, Array.from(new Set(servers)), STORE_FILE);
}

// Retrieves globally enabled servers (shared across all conversations)
export async function getGlobalEnabledServers(): Promise<string[]> {
  try {
    const list = await StorageUtil.getItem<string[]>('enabled_mcp_servers', [], SETTINGS_FILE);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Sets globally enabled servers
export async function setGlobalEnabledServers(servers: string[]): Promise<void> {
  await StorageUtil.setItem('enabled_mcp_servers', Array.from(new Set(servers)), SETTINGS_FILE);
}

// 已配置且启用的服务器（用于列表控制）
export async function getEnabledConfiguredServers(): Promise<string[]> {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    const store = await Store.load('mcp_servers.json');
    type Saved = { name: string; enabled?: boolean; config?: unknown };
    const raw = (await store.get<Saved[]>('servers')) || [];
    const { list, renames } = normalizeSavedServers<Saved>(Array.isArray(raw) ? raw : []);
    if (renames.length) {
      try {
        await store.set('servers', list);
        await store.save();
      } catch {
        // ignore
      }
    }
    return (list as any[]).filter((s) => s && s.enabled !== false).map((s) => s.name);
  } catch { return []; }
}

