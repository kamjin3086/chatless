import { describe, expect, it } from 'vitest';
import { toRemarkPluginList } from '@/lib/markdown/toRemarkPluginList';

describe('toRemarkPluginList', () => {
  it('converts a Streamdown-style record into plugin functions', () => {
    const gfm = () => undefined;
    const list = toRemarkPluginList({ gfm, extra: () => undefined });
    expect(list).toHaveLength(2);
    expect(list.every((p) => typeof p === 'function')).toBe(true);
  });

  it('does not wrap a record as a single empty unified preset', () => {
    const record = { gfm: () => undefined };
    const list = toRemarkPluginList(record);
    expect(list).not.toEqual([record]);
    expect(list[0]).toBe(record.gfm);
  });

  it('keeps arrays as-is', () => {
    const plugin = () => undefined;
    expect(toRemarkPluginList([plugin])).toEqual([plugin]);
  });
});
