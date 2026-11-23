import { expect, it, vi } from 'vitest';
import { createMessageMenuItems } from '../context-menu';

it.each([
  ['zh', '重新生成', '复制内容'],
  ['en', 'Regenerate', 'Copy'],
] as const)(
  'localizes Regenerate and Copy in %s without changing their callbacks',
  (locale, label, copyLabel) => {
    const onRetry = vi.fn();
    const onCopy = vi.fn();
    const items = createMessageMenuItems(
      locale,
      'message',
      'Raw content',
      true,
      onCopy,
      undefined,
      onRetry,
    );

    const retry = items.find((item) => item.id === 'retry');
    expect(retry?.text).toBe(label);
    retry?.action?.();
    expect(onRetry).toHaveBeenCalledExactlyOnceWith('message');
    expect(items.find((item) => item.id === 'copy')?.text).toBe(copyLabel);
  },
);

it('does not add a regenerate command to a user message', () => {
  const items = createMessageMenuItems(
    'en',
    'message',
    'Raw content',
    false,
    vi.fn(),
    undefined,
    vi.fn(),
  );

  expect(items.some((item) => item.id === 'retry')).toBe(false);
});
