import { beforeEach, describe, expect, it, vi } from 'vitest';

// 导出按钮的唯一价值是把现场从手机上带走，所以「留了什么」和「怎么交出去」都得钉住。
const stored = vi.hoisted(() => new Map<string, unknown>());

const store = {
  setItem: async (key: string, value: unknown) => {
    stored.set(key, value);
    return true;
  },
  getItem: async (key: string) => stored.get(key) ?? null,
};

vi.mock('@/lib/storage', () => ({ StorageUtil: store, default: store }));

vi.mock('@/config/app-info', () => ({
  getVersionInfo: () => ({ version: '0.8.0', build: 'abcdef1' }),
}));
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'android',
  arch: () => 'aarch64',
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: {
    getState: () => ({ currentConversationId: null, conversations: [] }),
  },
}));
vi.mock('@/store/providerMetaStore', () => ({
  useProviderMetaStore: {
    getState: () => ({ list: [{ name: 'lmstudio', models: [{}] }] }),
  },
}));

/**
 * 每个用例都要新模块：日志环活在模块状态里。测试跑在 node 环境（仓库不给 jsdom），
 * 所以把装环需要的 `window`/`document`/`navigator` 摆出来。
 */
async function fresh(globals: Record<string, unknown> = {}) {
  vi.resetModules();
  stored.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    visibilityState: 'visible',
  });
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) WebView',
    ...globals,
  });
  return {
    ring: await import('../androidLogRing'),
    exported: await import('../androidLogExport'),
  };
}

describe('android log ring', () => {
  it('keeps console output that would otherwise only reach logcat', async () => {
    const { ring } = await fresh();
    ring.installAndroidLogRing();
    console.warn('新会话创建失败');
    console.error('boom', { code: 7 });

    const entries = ring.readLogRing();
    const texts = entries.map((e) => e.text);
    expect(texts).toContain('新会话创建失败');
    expect(
      texts.some((t) => t.includes('boom') && t.includes('"code":7')),
    ).toBe(true);
    expect(entries.at(-1)!.level).toBe('error');
  });

  it('caps the buffer and counts what it dropped', async () => {
    const { ring } = await fresh();
    ring.installAndroidLogRing();
    for (let i = 0; i < 1700; i += 1) console.log(`line-${i}`);

    const entries = ring.readLogRing();
    expect(entries.length).toBeLessThanOrEqual(1500);
    expect(entries.at(-1)!.text).toBe('line-1699');
    const text = await ring.buildLogExportText();
    expect(text).toContain('已丢弃更早的');
    expect(text).toContain('line-1699');
    expect(text).not.toContain('line-1\n');
  });

  it('writes a bounded tail so a restart keeps the scene', async () => {
    const { ring } = await fresh();
    ring.installAndroidLogRing();
    for (let i = 0; i < 500; i += 1) console.log(`tail-${i}`);
    await ring.flushLogRing();

    const persisted = stored.get('android_log_ring') as Array<{ text: string }>;
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted.length).toBeLessThanOrEqual(400);
    expect(persisted.at(-1)!.text).toBe('tail-499');
  });

  it('puts version, device and the current model in the header', async () => {
    const { ring } = await fresh();
    ring.installAndroidLogRing();
    console.info('准备复现');
    const text = await ring.buildLogExportText();

    expect(text).toContain('Chatless Android 日志导出');
    expect(text).toContain('version: 0.8.0 (build abcdef1)');
    expect(text).toContain('platform: android · arch aarch64');
    expect(text).toContain(
      'userAgent: Mozilla/5.0 (Linux; Android 14) WebView',
    );
    expect(text).toContain('conversation: none');
    expect(text).toContain('providers: lmstudio(1)');
    expect(text).toContain('准备复现');
  });
});

describe('android log export', () => {
  it('hands the file to the share sheet when the WebView can', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { ring, exported } = await fresh({
      canShare: (data: { files?: unknown[] }) => Boolean(data?.files),
      share,
    });
    ring.installAndroidLogRing();
    console.warn('要导的就是这条');

    expect((await exported.exportAndroidLogs()).kind).toBe('shared');
    const sent = share.mock.calls[0][0] as { files: File[] };
    expect(sent.files[0].name).toMatch(/^chatless-android-\d{8}-\d{6}\.txt$/);
    expect(await sent.files[0].text()).toContain('要导的就是这条');
  });

  it('falls back to the save dialog, then to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const downloadText = vi.fn().mockResolvedValue(false);
    vi.doMock('@/lib/utils/downloadService', () => ({
      downloadService: { downloadText },
    }));
    const { ring, exported } = await fresh({ clipboard: { writeText } });
    ring.installAndroidLogRing();
    console.warn('保存对话框不可用');

    expect((await exported.exportAndroidLogs()).kind).toBe('clipboard');
    expect(downloadText).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalled();
  });

  it('stops at the share sheet when the user cancels it', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const { ring, exported } = await fresh({
      canShare: () => true,
      share: vi.fn().mockRejectedValue(abort),
    });
    ring.installAndroidLogRing();
    console.warn('用户按了取消');

    expect((await exported.exportAndroidLogs()).kind).toBe('cancelled');
  });

  it('says so when nothing has been logged yet', async () => {
    const { exported } = await fresh();
    // 没装环也没落过盘：没现场可导，不要拿一个空文件去麻烦分享面板。
    expect((await exported.exportAndroidLogs()).kind).toBe('empty');
  });
});
