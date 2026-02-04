/**
 * 依赖检测模块
 * 
 * 检测系统中是否安装了技能所需的依赖
 * 
 * 增强功能：
 * - 检测结果缓存（避免重复检测）
 * - 用户友好的安装指引
 * - 官方下载链接
 * - 一键打开下载页面
 */

import type { SkillDependency, DependencyType } from './types';

/**
 * 依赖检测结果
 */
export interface DependencyCheckResult {
  type: DependencyType;
  name: string;
  installed: boolean;
  version?: string;
  error?: string;
  /** 安装指引 */
  installHint?: string;
  /** 官方下载链接 */
  downloadUrl?: string;
  /** 最低版本要求 */
  minVersion?: string;
  /** 检测时间 */
  checkedAt?: number;
}

/**
 * 缓存项
 */
interface CacheEntry {
  result: DependencyCheckResult;
  timestamp: number;
}

/**
 * 检测结果缓存
 */
const dependencyCache = new Map<string, CacheEntry>();

/**
 * 缓存有效期（5分钟）
 */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * 运行时信息
 */
const RUNTIME_INFO: Record<string, { 
  installHint: string; 
  downloadUrl: string; 
  minVersion: string;
  description: string;
}> = {
  python: {
    installHint: '请安装 Python 3.8 或更高版本。\n\nWindows: 从官网下载安装包\nmacOS: brew install python3\nLinux: sudo apt install python3',
    downloadUrl: 'https://www.python.org/downloads/',
    minVersion: '3.8.0',
    description: 'Python 编程语言运行时',
  },
  node: {
    installHint: '请安装 Node.js 18 或更高版本。\n\nWindows/macOS: 从官网下载安装包\nLinux: 使用 nvm 或包管理器安装',
    downloadUrl: 'https://nodejs.org/',
    minVersion: '18.0.0',
    description: 'Node.js JavaScript 运行时',
  },
};

/**
 * 获取缓存键
 */
function getCacheKey(type: DependencyType, name: string): string {
  return `${type}:${name}`;
}

/**
 * 检查缓存是否有效
 */
function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
}

/**
 * 清除缓存
 */
export function clearDependencyCache(): void {
  dependencyCache.clear();
}

/**
 * 清除特定依赖的缓存
 */
export function clearDependencyCacheFor(type: DependencyType, name: string): void {
  dependencyCache.delete(getCacheKey(type, name));
}

/**
 * 检测 Python 环境
 */
async function checkPython(): Promise<DependencyCheckResult> {
  const cacheKey = getCacheKey('python', 'Python');
  const cached = dependencyCache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return cached.result;
  }

  const info = RUNTIME_INFO.python;
  const baseResult: Partial<DependencyCheckResult> = {
    type: 'python',
    name: 'Python',
    installHint: info.installHint,
    downloadUrl: info.downloadUrl,
    minVersion: info.minVersion,
    checkedAt: Date.now(),
  };

  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    
    // 尝试 python 命令
    let command = Command.create('python', ['--version']);
    let output = await command.execute();
    
    // 如果失败，尝试 python3
    if (output.code !== 0) {
      command = Command.create('python3', ['--version']);
      output = await command.execute();
    }
    
    if (output.code === 0) {
      const match = output.stdout.match(/Python\s+(\d+\.\d+\.\d+)/i);
      const version = match ? match[1] : undefined;
      const result: DependencyCheckResult = {
        ...baseResult,
        installed: true,
        version,
      } as DependencyCheckResult;
      
      dependencyCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
    const result: DependencyCheckResult = {
      ...baseResult,
      installed: false,
      error: output.stderr || 'Python not found',
    } as DependencyCheckResult;
    
    dependencyCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const result: DependencyCheckResult = {
      ...baseResult,
      installed: false,
      error: error instanceof Error ? error.message : 'Failed to check Python',
    } as DependencyCheckResult;
    
    dependencyCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }
}

/**
 * 检测 Node.js 环境
 */
async function checkNode(): Promise<DependencyCheckResult> {
  const cacheKey = getCacheKey('node', 'Node.js');
  const cached = dependencyCache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return cached.result;
  }

  const info = RUNTIME_INFO.node;
  const baseResult: Partial<DependencyCheckResult> = {
    type: 'node',
    name: 'Node.js',
    installHint: info.installHint,
    downloadUrl: info.downloadUrl,
    minVersion: info.minVersion,
    checkedAt: Date.now(),
  };

  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    const command = Command.create('node', ['--version']);
    const output = await command.execute();
    
    if (output.code === 0) {
      const match = output.stdout.match(/v?(\d+\.\d+\.\d+)/);
      const version = match ? match[1] : undefined;
      const result: DependencyCheckResult = {
        ...baseResult,
        installed: true,
        version,
      } as DependencyCheckResult;
      
      dependencyCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
    const result: DependencyCheckResult = {
      ...baseResult,
      installed: false,
      error: output.stderr || 'Node.js not found',
    } as DependencyCheckResult;
    
    dependencyCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const result: DependencyCheckResult = {
      ...baseResult,
      installed: false,
      error: error instanceof Error ? error.message : 'Failed to check Node.js',
    } as DependencyCheckResult;
    
    dependencyCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }
}

/**
 * 检测二进制程序
 */
async function checkBinary(name: string): Promise<DependencyCheckResult> {
  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    // 尝试执行 --version 或 -v
    const command = Command.create(name, ['--version']);
    const output = await command.execute();
    
    if (output.code === 0) {
      return {
        type: 'binary',
        name,
        installed: true,
        version: output.stdout.trim().split('\n')[0],
      };
    }
    
    return {
      type: 'binary',
      name,
      installed: false,
      error: output.stderr || `${name} not found`,
    };
  } catch (error) {
    return {
      type: 'binary',
      name,
      installed: false,
      error: error instanceof Error ? error.message : `Failed to check ${name}`,
    };
  }
}

/**
 * 检测 MCP 服务器
 */
async function checkMcpServer(serverName: string): Promise<DependencyCheckResult> {
  try {
    // 动态导入 MCP 相关模块
    const { useMcpStore } = await import('@/store/mcpStore');
    const serverStatuses = useMcpStore.getState().serverStatuses;
    
    const status = serverStatuses[serverName];
    const isConnected = status === 'connected';
    
    return {
      type: 'mcp_server',
      name: serverName,
      installed: isConnected,
      error: isConnected ? undefined : `MCP server "${serverName}" is not connected`,
    };
  } catch (error) {
    return {
      type: 'mcp_server',
      name: serverName,
      installed: false,
      error: error instanceof Error ? error.message : `Failed to check MCP server ${serverName}`,
    };
  }
}

/**
 * 检测单个依赖
 */
export async function checkDependency(dep: SkillDependency): Promise<DependencyCheckResult> {
  switch (dep.type) {
    case 'python':
      return checkPython();
    case 'node':
      return checkNode();
    case 'binary':
      return checkBinary(dep.name);
    case 'mcp_server':
      return checkMcpServer(dep.name);
    default:
      return {
        type: dep.type,
        name: dep.name,
        installed: false,
        error: `Unknown dependency type: ${dep.type}`,
      };
  }
}

/**
 * 检测多个依赖
 */
export async function checkDependencies(deps: SkillDependency[]): Promise<DependencyCheckResult[]> {
  // 并行检测所有依赖
  const results = await Promise.all(deps.map(dep => checkDependency(dep)));
  return results;
}

/**
 * 更新技能的依赖安装状态
 */
export async function updateSkillDependencyStatus(
  dependencies: SkillDependency[]
): Promise<SkillDependency[]> {
  const results = await checkDependencies(dependencies);
  
  return dependencies.map((dep, index) => ({
    ...dep,
    installed: results[index]?.installed ?? false,
    version: results[index]?.version,
  }));
}

/**
 * 检测所有常见依赖的状态（用于全局检测）
 */
export async function checkAllCommonDependencies(): Promise<DependencyCheckResult[]> {
  const commonDeps: SkillDependency[] = [
    { type: 'python', name: 'Python', installed: false },
    { type: 'node', name: 'Node.js', installed: false },
  ];
  
  return checkDependencies(commonDeps);
}

/**
 * 版本比较
 * 检查安装的版本是否满足要求
 * 
 * @param installed 已安装的版本
 * @param required 要求的版本（支持 >=, >, <, <=, = 前缀）
 * @returns 是否满足要求
 */
export function meetsVersionRequirement(installed: string, required: string): boolean {
  if (!installed || !required) {
    return true; // 如果没有版本信息，默认满足
  }

  // 解析运算符
  const operatorMatch = required.match(/^([><=]+)?(.+)$/);
  if (!operatorMatch) {
    return true;
  }

  const operator = operatorMatch[1] || '>=';
  const requiredVersion = operatorMatch[2].trim();

  // 比较版本
  const comparison = compareVersions(installed, requiredVersion);

  switch (operator) {
    case '>=':
      return comparison >= 0;
    case '>':
      return comparison > 0;
    case '<=':
      return comparison <= 0;
    case '<':
      return comparison < 0;
    case '=':
    case '==':
      return comparison === 0;
    default:
      return comparison >= 0;
  }
}

/**
 * 版本比较函数
 * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = v2.split('.').map(p => parseInt(p, 10) || 0);
  
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  
  return 0;
}

/**
 * 打开下载链接（在默认浏览器中）
 */
export async function openDownloadUrl(url: string): Promise<boolean> {
  try {
    const opener = await import('@tauri-apps/plugin-opener');
    await opener.openUrl(url);
    return true;
  } catch (error) {
    console.error('Failed to open download URL:', error);
    return false;
  }
}

/**
 * 获取环境检测摘要
 * 返回友好的状态信息
 */
export async function getEnvironmentSummary(): Promise<{
  allReady: boolean;
  summary: string;
  details: DependencyCheckResult[];
  missingRuntimes: string[];
  installInstructions: string[];
}> {
  const results = await checkAllCommonDependencies();
  
  const missingRuntimes: string[] = [];
  const installInstructions: string[] = [];
  
  for (const result of results) {
    if (!result.installed) {
      missingRuntimes.push(result.name);
      if (result.installHint) {
        installInstructions.push(`${result.name}:\n${result.installHint}`);
      }
    }
  }
  
  const allReady = missingRuntimes.length === 0;
  
  let summary: string;
  if (allReady) {
    summary = '所有运行时环境已就绪';
  } else if (missingRuntimes.length === 1) {
    summary = `缺少运行时: ${missingRuntimes[0]}`;
  } else {
    summary = `缺少运行时: ${missingRuntimes.join(', ')}`;
  }
  
  return {
    allReady,
    summary,
    details: results,
    missingRuntimes,
    installInstructions,
  };
}

/**
 * 快速检测特定运行时
 * 使用缓存加速
 */
export async function quickCheckRuntime(
  runtime: 'python' | 'node'
): Promise<{ available: boolean; version?: string; hint?: string }> {
  let result: DependencyCheckResult;
  
  switch (runtime) {
    case 'python':
      result = await checkPython();
      break;
    case 'node':
      result = await checkNode();
      break;
    default:
      return { available: false, hint: `不支持的运行时: ${runtime}` };
  }
  
  return {
    available: result.installed,
    version: result.version,
    hint: result.installed ? undefined : result.installHint,
  };
}

