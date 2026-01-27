/**
 * MCP工具调用授权配置管理
 */

import StorageUtil from '@/lib/storage';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';

// 可选：读取网络搜索设置，用于控制 web_search 的授权行为
const getWebSearchAutoAuth = async (): Promise<boolean | undefined> => {
  try {
    const { useWebSearchStore } = await import('@/store/webSearchStore');
    return !!useWebSearchStore.getState().autoAuthorizeWebSearch;
  } catch {
    return undefined;
  }
};

export interface ServerConfig {
  autoAuthorize?: boolean; // undefined表示使用默认值
  maxRecursionDepth?: number; // undefined表示使用默认值
}

export interface McpAuthorizationConfig {
  // 全局默认授权行为
  defaultAutoAuthorize: boolean;
  // 每个服务器的配置覆盖
  serverConfigs: Record<string, ServerConfig>;
}

const DEFAULT_CONFIG: McpAuthorizationConfig = {
  defaultAutoAuthorize: false, // 默认不自动授权
  serverConfigs: {},
};

const CONFIG_KEY = 'mcp_authorization_config';
const CONFIG_FILE = 'mcp-settings.json';

/**
 * 获取授权配置
 */
export async function getAuthorizationConfig(): Promise<McpAuthorizationConfig> {
  try {
    const config = await StorageUtil.getItem<McpAuthorizationConfig>(
      CONFIG_KEY,
      DEFAULT_CONFIG,
      CONFIG_FILE
    );
    return config || DEFAULT_CONFIG;
  } catch (error) {
    console.error('[MCP-AUTH] 获取授权配置失败:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * 设置全局默认授权行为
 */
export async function setDefaultAutoAuthorize(autoAuthorize: boolean): Promise<void> {
  try {
    const config = await getAuthorizationConfig();
    config.defaultAutoAuthorize = autoAuthorize;
    await StorageUtil.setItem(CONFIG_KEY, config, CONFIG_FILE);
  } catch (error) {
    console.error('[MCP-AUTH] 设置默认授权失败:', error);
    throw error;
  }
}

/**
 * 设置特定服务器的配置
 */
export async function setServerConfig(
  serverName: string,
  serverConfig: ServerConfig | undefined
): Promise<void> {
  try {
    const config = await getAuthorizationConfig();
    if (!serverConfig || (serverConfig.autoAuthorize === undefined && serverConfig.maxRecursionDepth === undefined)) {
      delete config.serverConfigs[serverName];
    } else {
      config.serverConfigs[serverName] = serverConfig;
    }
    await StorageUtil.setItem(CONFIG_KEY, config, CONFIG_FILE);
  } catch (error) {
    console.error('[MCP-AUTH] 设置服务器配置失败:', error);
    throw error;
  }
}

/**
 * 设置特定服务器的授权行为（兼容旧API）
 */
export async function setServerAutoAuthorize(
  serverName: string,
  autoAuthorize: boolean | undefined
): Promise<void> {
  const config = await getAuthorizationConfig();
  const serverConfig = config.serverConfigs[serverName] || {};
  serverConfig.autoAuthorize = autoAuthorize;
  await setServerConfig(serverName, serverConfig);
}

/**
 * 设置特定服务器的最大递归深度
 */
export async function setServerMaxRecursionDepth(
  serverName: string,
  maxDepth: number | undefined
): Promise<void> {
  const config = await getAuthorizationConfig();
  const serverConfig = config.serverConfigs[serverName] || {};
  serverConfig.maxRecursionDepth = maxDepth;
  await setServerConfig(serverName, serverConfig);
}

/**
 * 获取特定服务器是否需要授权
 * @param serverName 服务器名称
 * @returns true=自动授权, false=需要手动授权
 */
export async function shouldAutoAuthorize(serverName: string): Promise<boolean> {
  try {
    const config = await getAuthorizationConfig();
    // 优先使用服务器特定配置
    const serverConfig = config.serverConfigs[serverName];
    if (serverConfig?.autoAuthorize !== undefined) {
      return !!serverConfig.autoAuthorize;
    }

    // 对高敏感度服务强制要求人工确认（除非为该服务显式开启）
    const name = (serverName || '').toLowerCase().trim();
    const isSensitive =
      name === 'filesystem' || name === 'file-system' || name === 'fs' || name === 'shell_executor' || name === 'shell-executor';
    if (isSensitive) {
      return false;
    }

    // web_search 由“网络搜索设置页”单独控制（默认开启自动授权，可在设置中关闭）
    if (name === WEB_SEARCH_SERVER_NAME) {
      const fromStore = await getWebSearchAutoAuth();
      if (typeof fromStore === 'boolean') return fromStore;
    }

    // 其余使用全局默认
    return config.defaultAutoAuthorize;
  } catch (error) {
    console.error('[MCP-AUTH] 获取授权配置失败:', error);
    return DEFAULT_CONFIG.defaultAutoAuthorize;
  }
}

/**
 * 获取特定服务器的最大递归深度
 * @param serverName 服务器名称
 * @param defaultDepth 全局默认深度
 * @returns 服务器特定深度或全局默认深度
 */
export async function getServerMaxRecursionDepth(
  serverName: string,
  defaultDepth: number
): Promise<number> {
  try {
    const config = await getAuthorizationConfig();
    const serverConfig = config.serverConfigs[serverName];
    const maxDepth = serverConfig?.maxRecursionDepth;
    return maxDepth !== undefined ? maxDepth : defaultDepth;
  } catch (error) {
    console.error('[MCP-AUTH] 获取服务器递归深度失败:', error);
    return defaultDepth;
  }
}

/**
 * 获取特定服务器的配置
 */
export async function getServerConfig(serverName: string): Promise<ServerConfig> {
  try {
    const config = await getAuthorizationConfig();
    return config.serverConfigs[serverName] || {};
  } catch (error) {
    console.error('[MCP-AUTH] 获取服务器配置失败:', error);
    return {};
  }
}

/**
 * 获取所有服务器的配置（用于设置界面显示）
 */
export async function getAllServerConfigs(): Promise<Record<string, ServerConfig>> {
  try {
    const config = await getAuthorizationConfig();
    return config.serverConfigs || {};
  } catch (error) {
    console.error('[MCP-AUTH] 获取服务器配置列表失败:', error);
    return {};
  }
}

