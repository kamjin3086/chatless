import React, { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { AIMessageBlock } from '../AIMessageBlock';

const view = vi.hoisted(() => ({ locale: 'zh' as Locale }));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: { locale: Locale }) => unknown) =>
    select(view),
}));
vi.mock('@/lib/utils/fileOpener', () => ({
  FileOpener: { openDirectory: vi.fn() },
}));
vi.mock('@/lib/filesystemAllowlist/displayPathAliases', () => ({
  resolveAliasPath: ({ path }: { path: string }) => path,
}));
vi.mock('@/components/chat/MessageTextContent', () => ({
  MessageTextContent: () => null,
}));
vi.mock('@/components/chat/ThinkingBar', () => ({ ThinkingBar: () => null }));
vi.mock('@/components/chat/ToolCallGroup', () => ({
  ToolCallGroup: () => null,
}));
vi.mock('@/components/ui/FoldingLoader', () => ({ default: () => null }));
vi.mock('@/components/chat/FileHistoryPopover', () => ({
  FileHistoryPopover: () => null,
}));
vi.mock('yet-another-react-lightbox', () => ({ default: () => null }));
vi.mock('yet-another-react-lightbox/plugins/zoom', () => ({
  default: () => null,
}));
vi.mock('yet-another-react-lightbox/plugins/fullscreen', () => ({
  default: () => null,
}));
vi.mock('yet-another-react-lightbox/styles.css', () => ({}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

type BlockProps = ComponentProps<typeof AIMessageBlock>;

function renderBlock(locale: Locale, props: Partial<BlockProps> = {}): string {
  view.locale = locale;
  return renderToStaticMarkup(
    createElement(AIMessageBlock, {
      content: '',
      isStreaming: false,
      ...props,
    }),
  );
}

describe('AIMessageBlock chatMessage localization', () => {
  it.each([
    ['zh', '生成的图片', '查看', '下载', '复制到剪贴板'],
    ['en', 'Generated image', 'View', 'Download', 'Copy to clipboard'],
  ] as const)(
    'localizes inline image alt and action labels in %s',
    (locale, alt, viewLabel, downloadLabel, copyLabel) => {
      const html = renderBlock(locale, {
        segments: [{ kind: 'image', mimeType: 'image/png', data: 'abc' }],
      });
      expect(html).toContain(`alt="${alt}"`);
      expect(html).toContain(`title="${viewLabel}" aria-label="${viewLabel}"`);
      expect(html).toContain(
        `title="${downloadLabel}" aria-label="${downloadLabel}"`,
      );
      expect(html).toContain(`title="${copyLabel}" aria-label="${copyLabel}"`);
    },
  );

  it.each([
    ['zh', '正在识别工具调用指令…'],
    ['en', 'Detecting tool call instructions…'],
  ] as const)(
    'localizes the tool-call detecting status in %s',
    (locale, detectingLabel) => {
      const html = renderBlock(locale, {
        isStreaming: true,
        content: '<tool_call>{"type":"tool_call"}</tool_call>',
        segments: [{ kind: 'text', text: 'placeholder' }],
      });
      expect(html).toContain(detectingLabel);
    },
  );
});
