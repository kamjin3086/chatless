import React, { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ChatMessage } from '../ChatMessage';

const view = vi.hoisted(() => ({ locale: 'zh' as Locale, running: false }));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: { locale: Locale }) => unknown) =>
    select(view),
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: (
    select: (state: {
      agentRuns: { message: { running: boolean } };
    }) => unknown,
  ) => select({ agentRuns: { message: { running: view.running } } }),
}));
vi.mock('../AIMessageBlock', () => ({
  AIMessageBlock: ({ content }: { content: string }) =>
    createElement('p', {}, content),
}));
vi.mock('../UserMessageBlock', () => ({ UserMessageBlock: () => null }));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

type MessageProps = ComponentProps<typeof ChatMessage>;

function renderMessage(
  locale: Locale,
  props: Partial<MessageProps> = {},
  running = false,
): string {
  view.locale = locale;
  view.running = running;
  return renderToStaticMarkup(
    createElement(ChatMessage, {
      id: 'message',
      role: 'assistant',
      timestamp: '2026-01-01T12:00:00.000Z',
      content: 'HTTP 429: provider diagnostic',
      status: 'error',
      onRetry: vi.fn(),
      ...props,
    }),
  );
}

describe('ChatMessage retry presentation', () => {
  it.each([
    ['zh', '生成失败', '重试', '重试生成'],
    ['en', 'Generation failed', 'Retry', 'Retry generation'],
  ] as const)(
    'localizes failure and both retry controls in %s while preserving diagnostics',
    (locale, failure, retry, retryLabel) => {
      const settled = renderMessage(locale);
      expect(settled).toContain(`>${failure}</span>`);
      expect(settled).toContain(`title="${retry}" aria-label="${retryLabel}"`);
      expect(settled).toContain('HTTP 429: provider diagnostic');

      const running = renderMessage(locale, {}, true);
      expect(running).toContain(`aria-label="${retryLabel}"`);
      expect(running).toContain(`</svg>${retry}</button>`);
    },
  );

  it.each([
    ['zh', '继续', '继续任务'],
    ['en', 'Continue', 'Continue task'],
  ] as const)(
    'localizes Continue for both aborted status and legacy stop notices in %s',
    (locale, label, accessibleLabel) => {
      const expected = `title="${label}" aria-label="${accessibleLabel}"`;
      expect(
        renderMessage(locale, { status: 'aborted', content: 'Partial answer' }),
      ).toContain(expected);

      const legacy = renderMessage(locale, {
        status: 'sent',
        content: 'Partial answer\n[用户停止了生成]',
      });
      expect(legacy).toContain(expected);
      expect(legacy).toContain('[用户停止了生成]');
    },
  );
});

describe('ChatMessage chatMessage localization', () => {
  it.each([
    ['zh', '复制', '复制消息', '删除', '删除消息', '收藏', '收藏消息'],
    [
      'en',
      'Copy',
      'Copy message',
      'Delete',
      'Delete message',
      'Star',
      'Star message',
    ],
  ] as const)(
    'localizes copy, delete and star action labels in %s',
    (locale, copy, copyMessage, del, deleteMessage, star, starMessage) => {
      const html = renderMessage(locale, {
        status: 'sent',
        content: 'reply',
        onStar: vi.fn(),
      });
      expect(html).toContain(`title="${copy}" aria-label="${copyMessage}"`);
      expect(html).toContain(`title="${del}" aria-label="${deleteMessage}"`);
      expect(html).toContain(`title="${star}" aria-label="${starMessage}"`);
    },
  );

  it.each([
    ['zh', '上一版本', '下一版本'],
    ['en', 'Previous version', 'Next version'],
  ] as const)(
    'localizes version switch labels in %s',
    (locale, previous, next) => {
      const html = renderMessage(locale, {
        status: 'sent',
        content: 'reply',
        versionControls: {
          current: 1,
          total: 2,
          onPrev: vi.fn(),
          onNext: vi.fn(),
        },
      });
      expect(html).toContain(`title="${previous}" aria-label="${previous}"`);
      expect(html).toContain(`title="${next}" aria-label="${next}"`);
    },
  );

  it.each([
    ['zh', '处理中...'],
    ['en', 'Processing...'],
  ] as const)('localizes the agent-loop status in %s', (locale, processing) => {
    expect(renderMessage(locale, {}, true)).toContain(processing);
  });
});
