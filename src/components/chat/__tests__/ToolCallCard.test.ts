import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import { ToolCallCard } from '../ToolCallCard';

let locale: Locale = 'zh';
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: { locale: Locale }) => Locale) =>
    select({ locale }),
}));
vi.mock('@/store/chatStore', () => ({ useChatStore: {} }));

afterEach(() => {
  locale = 'zh';
});

function render(props: Partial<ComponentProps<typeof ToolCallCard>>) {
  return renderToStaticMarkup(
    createElement(ToolCallCard, {
      server: 'shell_executor',
      tool: 'execute',
      status: 'success',
      ...props,
    }),
  );
}

describe('ToolCallCard localization', () => {
  it('renders titles, status, timing, and detail headings in the interface locale', () => {
    const props = {
      args: { command: 'ls ~/资料' },
      resultPreview: '{"content":[{"type":"text","text":"报告.md"}]}',
      duration: 1.42,
    };
    const zh = render(props);
    expect(zh).toContain('>运行</span>');
    expect(zh).toContain('aria-label="执行成功"');
    expect(zh).toContain('title="用时 1.4 秒"');
    expect(zh).toContain('>参数</div>');
    expect(zh).toContain('>结果</div>');

    locale = 'en';
    const en = render(props);
    expect(en).toContain('>Run</span>');
    expect(en).toContain('aria-label="Succeeded"');
    expect(en).toContain('title="Elapsed: 1.4s"');
    expect(en).toContain('>Arguments</div>');
    expect(en).toContain('>Result</div>');
    for (const html of [zh, en]) {
      expect(html).toContain('&quot;command&quot;: &quot;ls ~/资料&quot;');
      expect(html).toContain('>报告.md</pre>');
    }
  });

  it.each([
    ['running', 'Running'],
    ['pending_auth', 'Awaiting approval'],
    ['stopped', 'Stopped'],
    ['error', 'Failed'],
  ] as const)(
    'labels the %s icon without adding elapsed time',
    (status, label) => {
      locale = 'en';
      const html = render({ status });
      expect(html).toContain(`title="${label}" aria-label="${label}"`);
      expect(html).not.toContain('Elapsed:');
    },
  );

  it('localizes the execution warning and hint label without replacing the raw diagnostic or schema hint', () => {
    locale = 'en';
    const html = render({
      status: 'error',
      errorMessage: 'EXECUTION_UNKNOWN: 服务未响应 $&',
      schemaHint: '{"path":"路径"}',
    });
    expect(html).toContain('The app will not retry automatically.');
    expect(html).toContain('>Error</div>');
    expect(html).toContain('EXECUTION_UNKNOWN: 服务未响应 $&amp;</div>');
    expect(html).toContain('>Hint: </span>{&quot;path&quot;:&quot;路径&quot;}');
  });

  it('translates the card-generated rejection and default error', () => {
    locale = 'en';
    expect(render({ status: 'error', errorMessage: '用户拒绝' })).toContain(
      'User rejected the call',
    );
    expect(render({ status: 'error' })).toContain('Unknown error');
    expect(
      render({ status: 'error', errorMessage: '工具返回：用户拒绝' }),
    ).toContain('工具返回：用户拒绝');
  });
});
