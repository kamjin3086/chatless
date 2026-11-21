import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { platform } from '@tauri-apps/plugin-os';
import { initDatabaseService } from '@/lib/db';
import { serverManager } from '@/lib/mcp/ServerManager';
import { performEnvironmentCheck } from '@/lib/utils/environment';
import { scheduleBackgroundUpdateChecks } from '@/lib/update/update-notifier';
import { initializeTauriApp } from '../initializeTauriApp';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ attachConsole: vi.fn() }));
vi.mock('@/lib/db', () => ({ initDatabaseService: vi.fn() }));
vi.mock('@/lib/mcp/ServerManager', () => ({
  serverManager: { init: vi.fn() },
}));
vi.mock('@/lib/mcp/persistentCache', () => ({
  persistentCache: { init: vi.fn() },
}));
vi.mock('@/lib/utils/environment', () => ({
  performEnvironmentCheck: vi.fn(),
}));
vi.mock('@/lib/update/update-notifier', () => ({
  scheduleBackgroundUpdateChecks: vi.fn(),
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ hasLoadedConversations: false }) },
}));
vi.mock('@/lib/sampleDataInitializer', () => ({
  SampleDataInitializer: {
    validateData: async () => ({
      isValid: true,
      summary: { knowledgeBases: 1, documents: 1 },
    }),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', { __TAURI__: {} });
  vi.stubGlobal('document', { readyState: 'complete' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ['android', false],
  ['linux', true],
] as const)(
  'restores chat at boot on %s and starts desktop services only on desktop',
  async (os, desktop) => {
    vi.mocked(platform).mockReturnValue(os);
    const loadConversations = vi.fn(async () => {
      expect(initDatabaseService).toHaveBeenCalledOnce();
    });

    await initializeTauriApp(loadConversations);
    await vi.runAllTimersAsync();

    expect(loadConversations).toHaveBeenCalledOnce();
    expect(performEnvironmentCheck).toHaveBeenCalledTimes(Number(desktop));
    expect(scheduleBackgroundUpdateChecks).toHaveBeenCalledTimes(
      Number(desktop),
    );
    expect(serverManager.init).toHaveBeenCalledTimes(Number(desktop));
  },
);
