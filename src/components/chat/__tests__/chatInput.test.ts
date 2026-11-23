import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ChatInput } from '../ChatInput';

const settings = vi.hoisted(() => ({ locale: 'zh' as Locale }));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => unknown) =>
    select(settings),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', { innerHeight: 800 });
});
afterAll(() => vi.unstubAllGlobals());

function render(
  locale: Locale,
  props: Partial<React.ComponentProps<typeof ChatInput>> = {},
) {
  settings.locale = locale;
  return renderToStaticMarkup(
    createElement(ChatInput, { onSendMessage: vi.fn(), ...props }),
  );
}

describe('ChatInput locale', () => {
  it.each([
    [
      'en',
      'Send a message',
      'Turn on plan-only mode',
      'Add attachments',
      'Web search',
      'MCP servers',
    ],
    ['zh', '发送消息', '开启仅规划', '附加内容', '网络搜索', 'MCP 服务器'],
  ] as const)(
    'renders composer controls in %s',
    (locale, send, planOnly, attach, search, mcp) => {
      const html = render(locale);
      expect(html).toContain(`placeholder="${send}"`);
      for (const label of [send, planOnly, attach, search, mcp]) {
        expect(html).toContain(`aria-label="${label}"`);
      }
    },
  );

  it.each([
    ['en', 'Choose a model first', 'Cancel editing', 'Stopping generation…'],
    ['zh', '请先选择模型', '取消编辑', '正在停止生成…'],
  ] as const)(
    'renders disabled, editing, and stopping states in %s',
    (locale, chooseModel, cancelEdit, stopping) => {
      expect(
        render(locale, {
          disabled: true,
          editingMessage: { content: '原始内容' },
        }),
      ).toContain(`placeholder="${chooseModel}"`);
      expect(
        render(locale, { editingMessage: { content: '原始内容' } }),
      ).toContain(`>${cancelEdit}</button>`);
      const busy = render(locale, {
        isLoading: true,
        isStoppingGeneration: true,
        onStopGeneration: vi.fn(),
      });
      expect(busy).toContain(`aria-label="${stopping}"`);
      expect(busy).toContain(`>${stopping}</span>`);
    },
  );
});
