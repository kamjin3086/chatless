import React, { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpToolListTip } from '@/components/mcp/McpToolListTip';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import AdvancedMcpSettingsDialog from '../AdvancedMcpSettingsDialog';
import { McpEnvironmentStatus } from '../McpEnvironmentStatus';
import { McpServersSettings } from '../McpServersSettings';
import ServerConfigDialog from '../ServerConfigDialog';

const { downloadJson, toastSuccess, toastError } = vi.hoisted(() => ({
  downloadJson: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/mcp/ServerManager', () => ({ serverManager: {} }));
vi.mock('@/lib/utils/downloadService', () => ({
  downloadService: { downloadJson },
}));
vi.mock('@/components/ui/sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/sonner')>()),
  toast: { success: toastSuccess, error: toastError },
}));

let locale: Locale;
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: () => ({
    locale,
    t: (key: TranslationKey) => translate(locale, key),
  }),
}));

// Render portal contents in-place under the Node test renderer. DialogContent,
// including the real close button, is still supplied by the application's UI.
vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  Portal: ({ children }: { children: ReactNode }) => children,
  Content: 'section',
  Overlay: 'div',
  Title: 'h2',
  Description: 'p',
  Close: 'button',
  Trigger: 'button',
}));

const tooltipActions = new Map<string, () => Promise<void>>();
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({
    children,
  }: {
    children: ReactElement<{
      'aria-label'?: string;
      onClick?: () => Promise<void>;
    }>;
  }) => {
    const { 'aria-label': label, onClick } = children.props;
    if (label && onClick) tooltipActions.set(label, onClick);
    return children;
  },
}));

vi.stubGlobal('React', React);

beforeEach(() => {
  locale = 'en';
  tooltipActions.clear();
  vi.resetAllMocks();
});

describe('MCP settings localization', () => {
  it.each([
    [
      'en',
      'No servers added yet',
      'Add server',
      'Import configuration',
      'Export configuration',
      'Recheck dependencies',
      'Advanced settings',
    ],
    [
      'zh',
      '尚未添加服务器',
      '新增服务器',
      '导入配置',
      '导出配置',
      '重新检测依赖',
      '高级设置',
    ],
  ] as const)(
    'localizes the empty server list and toolbar accessible names in %s',
    (lang, empty, ...labels) => {
      locale = lang;
      const html = renderToStaticMarkup(createElement(McpServersSettings));
      expect(html).toContain(empty);
      for (const label of labels)
        expect(html).toContain(`aria-label="${label}"`);
    },
  );

  it.each([
    [
      'en',
      'Export configuration',
      'MCP configuration exported',
      'Export failed',
    ],
    ['zh', '导出配置', '已导出 MCP 配置', '导出失败'],
  ] as const)(
    'localizes export feedback in %s without changing its payload or diagnostic',
    async (lang, action, success, failure) => {
      locale = lang;
      renderToStaticMarkup(createElement(McpServersSettings));
      const exportConfig = tooltipActions.get(action);
      expect(exportConfig).toBeDefined();
      const diagnostic = 'EACCES: 无法写入 $&/mcp_servers.json';
      downloadJson
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error(diagnostic));

      await exportConfig?.();
      expect(downloadJson).toHaveBeenCalledWith(
        expect.stringMatching(/^mcp_servers-/),
        { servers: [] },
      );
      expect(toastSuccess).toHaveBeenCalledWith(success);

      await exportConfig?.();
      expect(toastError).toHaveBeenCalledWith(failure, {
        description: diagnostic,
      });
    },
  );

  it.each([
    [
      'en',
      'Advanced settings',
      'Maximum recursion depth: 8',
      'Auto-authorize by default',
      'Server configuration —',
      'Loading…',
      'Close',
    ],
    [
      'zh',
      '高级设置',
      '最大递归深度：8',
      '默认自动授权',
      '服务器配置 -',
      '加载中…',
      '关闭',
    ],
  ] as const)(
    'localizes both MCP configuration dialogs in %s',
    (
      lang,
      advancedTitle,
      depth,
      authorization,
      serverTitle,
      loading,
      close,
    ) => {
      locale = lang;
      const advanced = renderToStaticMarkup(
        createElement(AdvancedMcpSettingsDialog, {
          open: true,
          onOpenChange: vi.fn(),
          maxDepth: 8,
          onSave: vi.fn(),
        }),
      );
      expect(advanced).toContain(advancedTitle);
      expect(advanced).toContain(depth);
      const label = advanced.match(
        /<label\b[^>]*\sfor="([^"]+)"[^>]*>([^<]+)<\/label>/,
      );
      expect(label?.[2]).toBe(authorization);
      expect(advanced).toContain(
        `id="${label?.[1]}" type="button" role="switch"`,
      );
      expect(advanced).toContain(`<span class="sr-only">${close}</span>`);

      const server = renderToStaticMarkup(
        createElement(ServerConfigDialog, {
          open: true,
          onOpenChange: vi.fn(),
          serverName: '私人 $& Server',
          globalDefaults: { autoAuthorize: false, maxRecursionDepth: 8 },
        }),
      );
      expect(server).toContain(`${serverTitle} 私人 $&amp; Server`);
      expect(server).toContain(loading);
      expect(server).toContain(`<span class="sr-only">${close}</span>`);
    },
  );

  it.each([
    [
      'en',
      'Checking MCP dependencies…',
      'Could not check MCP dependencies',
      'MCP dependencies are ready',
      'Missing tools: uvx, 工具$&amp;',
    ],
    [
      'zh',
      '正在检测 MCP 依赖…',
      '暂时无法检测 MCP 依赖',
      'MCP 依赖已就绪',
      '缺少工具：uvx、工具$&amp;',
    ],
  ] as const)(
    'localizes environment statuses in %s without renaming dependencies',
    (lang, checking, unavailable, ready, missing) => {
      locale = lang;
      const unhealthy = {
        overall_healthy: false,
        tools: [],
        missing_critical_tools: ['uvx', '工具$&'],
        recommendations: [],
      };
      expect(
        renderToStaticMarkup(
          createElement(McpEnvironmentStatus, {
            health: null,
            loading: true,
            error: null,
          }),
        ),
      ).toContain(checking);
      expect(
        renderToStaticMarkup(
          createElement(McpEnvironmentStatus, {
            health: null,
            loading: false,
            error: 'upstream error',
          }),
        ),
      ).toContain(unavailable);
      expect(
        renderToStaticMarkup(
          createElement(McpEnvironmentStatus, {
            health: { ...unhealthy, overall_healthy: true },
            loading: false,
            error: null,
          }),
        ),
      ).toContain(ready);
      expect(
        renderToStaticMarkup(
          createElement(McpEnvironmentStatus, {
            health: unhealthy,
            loading: false,
            error: null,
          }),
        ),
      ).toContain(missing);
    },
  );

  it.each([
    ['en', 'Available tools (1)', 'No tools available'],
    ['zh', '可用工具列表（1）', '无可用工具'],
  ] as const)(
    'localizes the tool tooltip in %s without translating upstream metadata',
    (lang, heading, empty) => {
      locale = lang;
      const trigger = createElement('span');
      const tools = [
        { name: 'upstream_lookup', description: '工具提供方的说明 $&' },
      ];
      const populated = renderToStaticMarkup(
        createElement(McpToolListTip, {
          toolCount: 1,
          tools,
          children: trigger,
        }),
      );
      expect(populated).toContain(heading);
      expect(populated).toContain('upstream_lookup');
      expect(populated).toContain('工具提供方的说明 $&amp;');
      expect(
        renderToStaticMarkup(
          createElement(McpToolListTip, {
            toolCount: 0,
            tools: [],
            children: trigger,
          }),
        ),
      ).toContain(empty);
    },
  );
});
