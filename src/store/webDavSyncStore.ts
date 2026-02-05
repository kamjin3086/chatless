import { create } from 'zustand';
import StorageUtil from '@/lib/storage';

const STORE_NAME = 'webdav-sync.json';

const ENABLED_KEY = 'enabled';
const URL_KEY = 'url';
const BASE_PATH_KEY = 'basePath';
const USERNAME_KEY = 'username';
const PASSWORD_KEY = 'password';
const STORE_PASSWORD_KEY = 'storePassword';

export interface WebDavSyncConfig {
  enabled: boolean;
  url: string;
  basePath: string;
  username: string;
  password: string;
  storePassword: boolean;
}

interface WebDavSyncState extends WebDavSyncConfig {
  initialized: boolean;
  lastSyncAt?: number;
  lastSyncSummary?: string;
  lastError?: string;
  setConfig: (input: Partial<WebDavSyncConfig>) => void;
  setLastSync: (input: { at: number; summary: string }) => void;
  setLastError: (message: string | undefined) => void;
  clearPassword: () => void;
}

export const useWebDavSyncStore = create<WebDavSyncState>((set, get) => ({
  enabled: false,
  url: '',
  basePath: 'chatless',
  username: '',
  password: '',
  storePassword: true,
  initialized: false,
  lastSyncAt: undefined,
  lastSyncSummary: undefined,
  lastError: undefined,

  setConfig: (input) => {
    const next: WebDavSyncConfig = { ...get(), ...input };
    set({
      enabled: next.enabled,
      url: next.url,
      basePath: next.basePath,
      username: next.username,
      password: next.password,
      storePassword: next.storePassword,
    });
    StorageUtil.setItem(ENABLED_KEY, next.enabled, STORE_NAME);
    StorageUtil.setItem(URL_KEY, next.url, STORE_NAME);
    StorageUtil.setItem(BASE_PATH_KEY, next.basePath, STORE_NAME);
    StorageUtil.setItem(USERNAME_KEY, next.username, STORE_NAME);
    StorageUtil.setItem(STORE_PASSWORD_KEY, next.storePassword, STORE_NAME);
    if (next.storePassword) {
      StorageUtil.setItem(PASSWORD_KEY, next.password, STORE_NAME);
    } else {
      StorageUtil.removeItem(PASSWORD_KEY, STORE_NAME);
    }
  },

  setLastSync: (input) => {
    set({ lastSyncAt: input.at, lastSyncSummary: input.summary, lastError: undefined });
    StorageUtil.setItem('lastSyncAt', input.at, STORE_NAME);
    StorageUtil.setItem('lastSyncSummary', input.summary, STORE_NAME);
    StorageUtil.removeItem('lastError', STORE_NAME);
  },

  setLastError: (message) => {
    set({ lastError: message });
    if (message) StorageUtil.setItem('lastError', message, STORE_NAME);
    else StorageUtil.removeItem('lastError', STORE_NAME);
  },

  clearPassword: () => {
    set({ password: '' });
    StorageUtil.removeItem(PASSWORD_KEY, STORE_NAME);
  },
}));

// 异步初始化（仅客户端生效，服务端会返回默认值）
void (async () => {
  const [enabled, url, basePath, username, storePassword, password, lastSyncAt, lastSyncSummary, lastError] =
    await Promise.all([
      StorageUtil.getItem<boolean>(ENABLED_KEY, false, STORE_NAME),
      StorageUtil.getItem<string>(URL_KEY, '', STORE_NAME),
      StorageUtil.getItem<string>(BASE_PATH_KEY, 'chatless', STORE_NAME),
      StorageUtil.getItem<string>(USERNAME_KEY, '', STORE_NAME),
      StorageUtil.getItem<boolean>(STORE_PASSWORD_KEY, true, STORE_NAME),
      StorageUtil.getItem<string>(PASSWORD_KEY, '', STORE_NAME),
      StorageUtil.getItem<number>('lastSyncAt', undefined as any, STORE_NAME),
      StorageUtil.getItem<string>('lastSyncSummary', undefined as any, STORE_NAME),
      StorageUtil.getItem<string>('lastError', undefined as any, STORE_NAME),
    ]);

  useWebDavSyncStore.setState({
    enabled: !!enabled,
    url: url || '',
    basePath: basePath || 'chatless',
    username: username || '',
    storePassword: storePassword !== false,
    password: storePassword === false ? '' : (password || ''),
    lastSyncAt: typeof lastSyncAt === 'number' ? lastSyncAt : undefined,
    lastSyncSummary: lastSyncSummary || undefined,
    lastError: lastError || undefined,
    initialized: true,
  });
})();

