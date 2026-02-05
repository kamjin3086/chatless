import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import StorageUtil from '@/lib/storage';
import type { SyncDataType, FullSyncResult, SyncDirection } from '@/lib/sync/core/types';
import { SYNC_DATA_TYPE_INFO } from '@/lib/sync/core/types';

const STORE_NAME = 'webdav-sync.json';

const ENABLED_KEY = 'enabled';
const URL_KEY = 'url';
const BASE_PATH_KEY = 'basePath';
const USERNAME_KEY = 'username';
const PASSWORD_KEY = 'password';
const AUTO_SYNC_KEY = 'autoSync';
const SYNC_HISTORY_KEY = 'syncHistory';
const ENABLED_DATA_TYPES_KEY = 'enabledDataTypes';

/** 所有支持的数据类型 */
export const ALL_SYNC_DATA_TYPES: SyncDataType[] = ['prompts', 'skills', 'providers', 'settings'];

/** 默认启用的数据类型 */
export const DEFAULT_ENABLED_DATA_TYPES: SyncDataType[] = ['prompts'];

/** 同步历史条目 */
export interface SyncHistoryEntry {
  id: string;
  timestamp: number;
  summary: string;
  pushed: number;
  pulled: number;
  skipped: number;
  error?: string;
  /** 同步的数据类型 */
  dataTypes?: SyncDataType[];
}

export interface WebDavSyncConfig {
  enabled: boolean;
  url: string;
  basePath: string;
  username: string;
  password: string;
  autoSync: boolean; // 自动同步开关
  /** 启用同步的数据类型 */
  enabledDataTypes: SyncDataType[];
}

/** 连接状态类型 */
export type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'error';

/** 同步状态类型 */
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

interface WebDavSyncState extends WebDavSyncConfig {
  initialized: boolean;
  lastSyncAt?: number;
  lastSyncSummary?: string;
  lastError?: string;
  connectionStatus: ConnectionStatus;
  syncStatus: SyncStatus;
  syncHistory: SyncHistoryEntry[];
  setConfig: (input: Partial<WebDavSyncConfig>) => void;
  setLastSync: (input: { at: number; summary: string }) => void;
  setLastError: (message: string | undefined) => void;
  clearPassword: () => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setSyncStatus: (status: SyncStatus) => void;
  checkConnection: () => Promise<void>;
  addSyncHistory: (entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'>) => void;
  clearSyncHistory: () => void;
  /** 设置启用的数据类型 */
  setEnabledDataTypes: (types: SyncDataType[]) => void;
  /** 切换单个数据类型的启用状态 */
  toggleDataType: (type: SyncDataType) => void;
  /** 执行完整同步 */
  performSync: (direction?: SyncDirection) => Promise<FullSyncResult | null>;
}

const MAX_SYNC_HISTORY = 20; // 最多保存20条同步历史

export const useWebDavSyncStore = create<WebDavSyncState>((set, get) => ({
  enabled: false,
  url: '',
  basePath: 'chatless',
  username: '',
  password: '',
  autoSync: false,
  enabledDataTypes: DEFAULT_ENABLED_DATA_TYPES,
  initialized: false,
  lastSyncAt: undefined,
  lastSyncSummary: undefined,
  lastError: undefined,
  connectionStatus: 'unknown',
  syncStatus: 'idle',
  syncHistory: [],

  setConfig: (input) => {
    const prev = get();
    const next: WebDavSyncConfig = { 
      enabled: input.enabled ?? prev.enabled,
      url: input.url ?? prev.url,
      basePath: input.basePath ?? prev.basePath,
      username: input.username ?? prev.username,
      password: input.password ?? prev.password,
      autoSync: input.autoSync ?? prev.autoSync,
      enabledDataTypes: input.enabledDataTypes ?? prev.enabledDataTypes,
    };
    set({
      enabled: next.enabled,
      url: next.url,
      basePath: next.basePath,
      username: next.username,
      password: next.password,
      autoSync: next.autoSync,
      enabledDataTypes: next.enabledDataTypes,
    });
    StorageUtil.setItem(ENABLED_KEY, next.enabled, STORE_NAME);
    StorageUtil.setItem(URL_KEY, next.url, STORE_NAME);
    StorageUtil.setItem(BASE_PATH_KEY, next.basePath, STORE_NAME);
    StorageUtil.setItem(USERNAME_KEY, next.username, STORE_NAME);
    StorageUtil.setItem(PASSWORD_KEY, next.password, STORE_NAME);
    StorageUtil.setItem(AUTO_SYNC_KEY, next.autoSync, STORE_NAME);
    StorageUtil.setItem(ENABLED_DATA_TYPES_KEY, next.enabledDataTypes, STORE_NAME);
  },

  setLastSync: (input) => {
    set({ lastSyncAt: input.at, lastSyncSummary: input.summary, lastError: undefined });
    StorageUtil.setItem('lastSyncAt', input.at, STORE_NAME);
    StorageUtil.setItem('lastSyncSummary', input.summary, STORE_NAME);
    StorageUtil.removeItem('lastError', STORE_NAME);
  },

  setLastError: (message) => {
    set({ lastError: message, connectionStatus: message ? 'error' : get().connectionStatus });
    if (message) StorageUtil.setItem('lastError', message, STORE_NAME);
    else StorageUtil.removeItem('lastError', STORE_NAME);
  },

  clearPassword: () => {
    set({ password: '' });
    StorageUtil.removeItem(PASSWORD_KEY, STORE_NAME);
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  checkConnection: async () => {
    const state = get();
    if (!state.url.trim() || !state.username.trim() || !state.password.trim()) {
      set({ connectionStatus: 'unknown' });
      return;
    }
    set({ connectionStatus: 'checking' });
    try {
      const { WebDavClient } = await import('@/lib/sync/webdav/WebDavClient');
      const client = new WebDavClient({
        url: state.url,
        basePath: state.basePath,
        auth: { username: state.username, password: state.password },
        timeoutMs: 10_000,
      });
      await client.propfind('', '0');
      set({ connectionStatus: 'connected', lastError: undefined });
    } catch (e: any) {
      set({ connectionStatus: 'error', lastError: e?.message || String(e) });
    }
  },

  addSyncHistory: (entry) => {
    const newEntry: SyncHistoryEntry = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...entry,
    };
    const updated = [newEntry, ...get().syncHistory].slice(0, MAX_SYNC_HISTORY);
    set({ syncHistory: updated });
    StorageUtil.setItem(SYNC_HISTORY_KEY, updated, STORE_NAME);
  },

  clearSyncHistory: () => {
    set({ syncHistory: [] });
    StorageUtil.removeItem(SYNC_HISTORY_KEY, STORE_NAME);
  },

  setSyncStatus: (status) => {
    set({ syncStatus: status });
  },

  setEnabledDataTypes: (types) => {
    set({ enabledDataTypes: types });
    StorageUtil.setItem(ENABLED_DATA_TYPES_KEY, types, STORE_NAME);
  },

  toggleDataType: (type) => {
    const current = get().enabledDataTypes;
    const isEnabled = current.includes(type);
    const next = isEnabled
      ? current.filter(t => t !== type)
      : [...current, type];
    get().setEnabledDataTypes(next);
  },

  performSync: async (direction = 'both') => {
    const state = get();
    
    if (!state.enabled || !state.url || !state.username || !state.password) {
      return null;
    }
    
    if (state.syncStatus === 'syncing') {
      return null;
    }
    
    set({ syncStatus: 'syncing' });
    
    try {
      // 动态导入同步模块
      const { createSyncManager } = await import('@/lib/sync/core/SyncManager');
      const { createWebDAVTransport } = await import('@/lib/sync/transports/WebDAVTransport');
      const { getOrCreateSyncDeviceId } = await import('@/lib/sync/deviceId');
      const { createPromptAdapter } = await import('@/lib/sync/adapters/PromptAdapter');
      const { createSkillAdapter } = await import('@/lib/sync/adapters/SkillAdapter');
      const { createProviderAdapter } = await import('@/lib/sync/adapters/ProviderAdapter');
      const { createSettingsAdapter } = await import('@/lib/sync/adapters/SettingsAdapter');
      
      const deviceId = await getOrCreateSyncDeviceId();
      
      // 创建传输层
      const transport = createWebDAVTransport({
        url: state.url,
        basePath: state.basePath,
        username: state.username,
        password: state.password,
      });
      
      // 创建同步管理器
      const manager = createSyncManager(deviceId, transport);
      
      // 注册适配器
      manager.registerAdapter(createPromptAdapter());
      manager.registerAdapter(createSkillAdapter());
      manager.registerAdapter(createProviderAdapter());
      manager.registerAdapter(createSettingsAdapter());
      
      // 执行同步
      const result = await manager.syncAll(state.enabledDataTypes, direction);
      
      // 生成摘要
      const typeLabels = state.enabledDataTypes
        .map(t => SYNC_DATA_TYPE_INFO[t]?.label || t)
        .join('、');
      const summary = `同步完成 (${typeLabels}): ↑${result.totalPushed} ↓${result.totalPulled}`;
      
      // 更新状态
      set({
        syncStatus: result.hasErrors ? 'error' : 'success',
        lastSyncAt: result.timestamp,
        lastSyncSummary: summary,
        lastError: result.hasErrors 
          ? result.results.flatMap(r => r.errors).join('; ')
          : undefined,
      });
      
      // 添加历史记录
      get().addSyncHistory({
        summary,
        pushed: result.totalPushed,
        pulled: result.totalPulled,
        skipped: result.totalSkipped,
        dataTypes: state.enabledDataTypes,
        error: result.hasErrors 
          ? result.results.flatMap(r => r.errors).join('; ')
          : undefined,
      });
      
      // 持久化最后同步信息
      StorageUtil.setItem('lastSyncAt', result.timestamp, STORE_NAME);
      StorageUtil.setItem('lastSyncSummary', summary, STORE_NAME);
      if (!result.hasErrors) {
        StorageUtil.removeItem('lastError', STORE_NAME);
      }
      
      return result;
    } catch (e: any) {
      const errorMessage = e?.message || String(e);
      set({
        syncStatus: 'error',
        lastError: errorMessage,
      });
      
      get().addSyncHistory({
        summary: '同步失败',
        pushed: 0,
        pulled: 0,
        skipped: 0,
        dataTypes: state.enabledDataTypes,
        error: errorMessage,
      });
      
      StorageUtil.setItem('lastError', errorMessage, STORE_NAME);
      return null;
    }
  },
}));

// 异步初始化（仅客户端生效，服务端会返回默认值）
void (async () => {
  const [
    enabled, 
    url, 
    basePath, 
    username, 
    password, 
    autoSync, 
    enabledDataTypes,
    lastSyncAt, 
    lastSyncSummary, 
    lastError, 
    syncHistory,
  ] = await Promise.all([
    StorageUtil.getItem<boolean>(ENABLED_KEY, false, STORE_NAME),
    StorageUtil.getItem<string>(URL_KEY, '', STORE_NAME),
    StorageUtil.getItem<string>(BASE_PATH_KEY, 'chatless', STORE_NAME),
    StorageUtil.getItem<string>(USERNAME_KEY, '', STORE_NAME),
    StorageUtil.getItem<string>(PASSWORD_KEY, '', STORE_NAME),
    StorageUtil.getItem<boolean>(AUTO_SYNC_KEY, false, STORE_NAME),
    StorageUtil.getItem<SyncDataType[]>(ENABLED_DATA_TYPES_KEY, DEFAULT_ENABLED_DATA_TYPES, STORE_NAME),
    StorageUtil.getItem<number>('lastSyncAt', undefined as any, STORE_NAME),
    StorageUtil.getItem<string>('lastSyncSummary', undefined as any, STORE_NAME),
    StorageUtil.getItem<string>('lastError', undefined as any, STORE_NAME),
    StorageUtil.getItem<SyncHistoryEntry[]>(SYNC_HISTORY_KEY, [], STORE_NAME),
  ]);

  useWebDavSyncStore.setState({
    enabled: !!enabled,
    url: url || '',
    basePath: basePath || 'chatless',
    username: username || '',
    password: password || '',
    autoSync: !!autoSync,
    enabledDataTypes: Array.isArray(enabledDataTypes) ? enabledDataTypes : DEFAULT_ENABLED_DATA_TYPES,
    lastSyncAt: typeof lastSyncAt === 'number' ? lastSyncAt : undefined,
    lastSyncSummary: lastSyncSummary || undefined,
    lastError: lastError || undefined,
    syncHistory: Array.isArray(syncHistory) ? syncHistory : [],
    initialized: true,
  });
})();

