/**
 * MCP服务器连接管理器
 * 
 * 负责确保MCP服务器处于连接状态，如果未连接则尝试自动重连
 */

import { serverManager } from '../ServerManager';

/**
 * 确保MCP服务器已连接，如果未连接则尝试重连
 * 
 * @param serverName - 服务器名称
 * @throws 如果无法建立连接则抛出错误
 * 
 * @example
 * ```typescript
 * try {
 *   await ensureServerConnected('filesystem');
 *   // 服务器已连接，可以调用工具
 * } catch (error) {
 *   // 连接失败
 * }
 * ```
 */
export async function ensureServerConnected(serverName: string): Promise<void> {
  try {
    const { useMcpStore } = await import('@/store/mcpStore');
    const store = useMcpStore.getState();
    const status = store.serverStatuses[serverName];
    // Enablement is an execution-time authorization boundary. A client may
    // still be connected briefly after a user disables it, so checking only
    // the connection status would let an old loaded definition bypass the
    // revocation.
    const { Store } = await import('@tauri-apps/plugin-store');
    const cfgStore = await Store.load('mcp_servers.json');
    const serverList: Array<{ name: string; config: any; enabled?: boolean }> =
      (await cfgStore.get('servers')) || [];
    const found = serverList.find(s => s.name === serverName);
    if (!found) {
      throw new Error(`服务器 ${serverName} 配置未找到`);
    }
    if (found.enabled === false) {
      throw new Error(`服务器 ${serverName} 已禁用，不能执行工具调用`);
    }
    
    console.log(`[MCP-RECONNECT] 检查服务器 ${serverName} 连接状态: ${status}`);
    
    // 如果服务器未连接，尝试重连
    if (status !== 'connected') {
      console.log(`[MCP-RECONNECT] 服务器 ${serverName} 未连接，尝试重连...`);
      
      // 尝试重连
      console.log(`[MCP-RECONNECT] 开始重连服务器 ${serverName}...`);
      await serverManager.reconnect(serverName, found.config);
      console.log(`[MCP-RECONNECT] 服务器 ${serverName} 重连成功`);
    } else {
      console.log(`[MCP-RECONNECT] 服务器 ${serverName} 已连接，无需重连`);
    }
  } catch (error) {
    console.error(`[MCP-RECONNECT] 确保服务器连接失败:`, error);
    throw error;
  }
}

