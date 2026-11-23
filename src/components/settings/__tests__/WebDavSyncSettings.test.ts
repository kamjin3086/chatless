import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { SyncDataType } from '@/lib/sync/core/types';
import type {
  SyncHistoryEntry,
  useWebDavSyncStore,
} from '@/store/webDavSyncStore';
import { WebDavSyncSettings } from '../WebDavSyncSettings';
import { formatWebDavSyncTime } from '../webDavSyncPresentation';

type SyncState = ReturnType<typeof useWebDavSyncStore.getState>;

const mocks = vi.hoisted(() => ({
  locale: 'zh' as Locale,
  sync: {} as Partial<SyncState>,
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: { locale: Locale }) => Locale) =>
    select(mocks),
}));
vi.mock('@/store/webDavSyncStore', () => ({
  ALL_SYNC_DATA_TYPES: ['prompts', 'skills', 'providers', 'settings'],
  useWebDavSyncStore: () => mocks.sync,
}));
// Render both expandable sections so the SSR test inspects their copy as well.
vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => children,
  CollapsibleContent: ({ children }: { children: ReactNode }) => children,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) =>
    createElement('button', null, children),
}));
vi.stubGlobal('React', React);

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 5, 12, 12);
const RAW_DIAGNOSTIC = 'MKCOL 失败: 403 /dav/{detail}/$&';
const complete: SyncHistoryEntry = {
  id: 'complete',
  timestamp: NOW - 2 * MINUTE + 5,
  summary: '同步完成 (提示词、Provider 配置): ↑2 ↓1',
  pushed: 2,
  pulled: 1,
  skipped: 3,
  dataTypes: ['prompts', 'providers'],
};

function renderSettings(locale: Locale, overrides: Partial<SyncState> = {}) {
  mocks.locale = locale;
  mocks.sync = {
    enabled: true,
    url: 'https://dav.invalid/example/',
    basePath: 'custom-sync',
    username: 'example-user',
    password: 'test-value',
    autoSync: true,
    enabledDataTypes: ['skills', 'settings'],
    connectionStatus: 'connected',
    syncStatus: 'idle',
    syncHistory: [],
    ...overrides,
  };
  return renderToStaticMarkup(createElement(WebDavSyncSettings));
}

afterEach(() => vi.restoreAllMocks());

describe('WebDavSyncSettings', () => {
  it('renders the inline form, sync data labels, and values in either app locale', () => {
    const en = renderSettings('en');
    expect(en).toContain('Sync settings');
    expect(en).toContain('Enable sync');
    expect(en).toContain('Automatic sync');
    expect(en).toContain('Skill settings, User settings');
    expect(en).toContain(
      'Model provider display and preferences (excluding API keys)',
    );
    expect(en).toContain(
      'WebDAV server address. A trailing slash is recommended.',
    );
    expect(en).toContain('Remote folder');
    expect(en).toContain('Username');
    expect(en).toContain('aria-label="Show password"');
    expect(en).toContain('type="password"');
    expect(en).toContain('Check connection');
    expect(en).toContain('Sync now');

    const zh = renderSettings('zh');
    expect(zh).toContain('同步设置');
    expect(zh).toContain('自动同步');
    expect(zh).toContain('技能配置、用户设置');
    expect(zh).toContain('模型服务商的显示和偏好设置（不含密钥）');
    expect(zh).toContain('远端目录');
    expect(zh).toContain('aria-label="显示密码"');
    expect(zh).toContain('检测连接');
    expect(zh).toContain('立即同步');

    for (const html of [en, zh]) {
      expect(html).toContain('value="https://dav.invalid/example/"');
      expect(html).toContain('value="custom-sync"');
      expect(html).toContain('value="example-user"');
      expect(html).toContain('value="test-value"');
      expect(html).not.toContain('settings.sync.');
    }
  });

  it.each([
    ['unknown', 'Not checked', '未检测'],
    ['checking', 'Checking…', '检测中…'],
    ['connected', 'Connected', '已连接'],
    ['error', 'Connection failed', '连接失败'],
  ] as const)(
    'localizes the %s connection state',
    (connectionStatus, en, zh) => {
      expect(renderSettings('en', { connectionStatus })).toContain(`>${en}<`);
      expect(renderSettings('zh', { connectionStatus })).toContain(`>${zh}<`);
    },
  );

  it('localizes the syncing and selection states', () => {
    const allTypes: SyncDataType[] = [
      'prompts',
      'skills',
      'providers',
      'settings',
    ];
    expect(
      renderSettings('en', {
        syncStatus: 'syncing',
        enabledDataTypes: allTypes,
      }),
    ).toContain('Syncing…');
    expect(renderSettings('en', { enabledDataTypes: allTypes })).toContain(
      '>All<',
    );
    expect(renderSettings('zh', { enabledDataTypes: [] })).toContain(
      '>未选择<',
    );
    expect(renderSettings('en', { enabled: false })).not.toContain(
      'Check connection',
    );
  });

  it('localizes recent and historical results using saved counts and types, not the current selection', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const state = {
      lastSyncAt: NOW - 2 * MINUTE,
      lastSyncSummary: complete.summary,
      syncHistory: [
        { ...complete, id: 'failed', timestamp: NOW, error: RAW_DIAGNOSTIC },
        complete,
      ],
    };
    const en = renderSettings('en', state);
    expect(en).toContain(
      'Last sync: Sync complete (Prompts, Provider settings): ↑2 ↓1 (2 minutes ago)',
    );
    expect(en).toContain('>Sync complete (Prompts, Provider settings): ↑2 ↓1<');
    expect(en).toContain('Sync history (2)');
    expect(en).toContain('Clear history');
    expect(en).toContain('Sync failed: MKCOL 失败: 403 /dav/{detail}/$&amp;');
    expect(en).not.toContain(complete.summary);

    const zh = renderSettings('zh', state);
    expect(zh).toContain(
      '上次同步：同步完成（提示词、Provider 配置）：↑2 ↓1（2分钟前）',
    );
    expect(zh).toContain('同步历史（2）');
    expect(zh).toContain('清除历史');
    expect(zh).toContain('同步失败：MKCOL 失败: 403 /dav/{detail}/$&amp;');
  });

  it('preserves legacy summaries and raw latest errors', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const legacySummary = '旧版摘要: custom text ↑0 ↓0';
    const legacy = {
      ...complete,
      dataTypes: undefined,
      summary: legacySummary,
    };
    const state = {
      lastSyncAt: NOW,
      lastSyncSummary: legacySummary,
      syncHistory: [legacy],
    };
    expect(renderSettings('en', state)).toContain(
      `Last sync: ${legacySummary} (Just now)`,
    );
    expect(renderSettings('en', state)).toContain(`>${legacySummary}<`);
    expect(renderSettings('en', { ...state, syncHistory: [] })).toContain(
      `Last sync: ${legacySummary} (Just now)`,
    );
    expect(renderSettings('en', { lastSyncAt: NOW })).toContain(
      'Last sync: Just now',
    );
    expect(
      renderSettings('en', { ...state, lastError: RAW_DIAGNOSTIC }),
    ).toContain('Error: MKCOL 失败: 403 /dav/{detail}/$&amp;');
    expect(
      renderSettings('zh', { ...state, lastError: RAW_DIAGNOSTIC }),
    ).toContain('错误：MKCOL 失败: 403 /dav/{detail}/$&amp;');
  });
});

describe('formatWebDavSyncTime', () => {
  it('uses the app locale for relative time and falls back to a localized date after seven days', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    for (const [minutesAgo, en, zh] of [
      [0, 'Just now', '刚刚'],
      [1, '1 minute ago', '1分钟前'],
      [60, '1 hour ago', '1小时前'],
      [24 * 60, '1 day ago', '1天前'],
    ] as const) {
      expect(formatWebDavSyncTime('en', NOW - minutesAgo * MINUTE)).toBe(en);
      expect(formatWebDavSyncTime('zh', NOW - minutesAgo * MINUTE)).toBe(zh);
    }
    const older = NOW - 7 * 24 * 60 * MINUTE;
    const date = new Date(older);
    expect(formatWebDavSyncTime('en', older)).toBe(
      date.toLocaleDateString('en-US'),
    );
    expect(formatWebDavSyncTime('zh', older)).toBe(
      date.toLocaleDateString('zh-CN'),
    );
  });
});
