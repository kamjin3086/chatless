import { describe, expect, test } from 'vitest';
import { ToolChannelParser } from '../ToolChannelParser';
import { createStreamEvent } from '@/lib/llm/types/stream-events';

describe('ToolChannelParser', () => {
  test('并发 stream 实例互不污染', () => {
    const parserA = new ToolChannelParser();
    const parserB = new ToolChannelParser();

    const eventsA = parserA.rewriteEvents([
      createStreamEvent.contentToken('Hello '),
      createStreamEvent.streamComplete(),
    ]);
    const eventsB = parserB.rewriteEvents([
      createStreamEvent.contentToken('World'),
      createStreamEvent.streamComplete(),
    ]);

    expect(eventsA.some((e) => e.type === 'content_token' && e.content === 'Hello ')).toBe(true);
    expect(eventsB.some((e) => e.type === 'content_token' && e.content === 'World')).toBe(true);
  });

  test('工具指令不会泄漏到可见文本', () => {
    const parser = new ToolChannelParser();
    const events = parser.rewriteEvents([
      createStreamEvent.contentToken('prefix '),
      createStreamEvent.contentToken('<use_mcp_tool><server_name>mcp</server_name><tool_name>search</tool_name><arguments>{"q":"x"}</arguments></use_mcp_tool>'),
      createStreamEvent.streamComplete(),
    ]);

    const visible = events
      .filter((e) => e.type === 'content_token')
      .map((e) => e.content)
      .join('');
    expect(visible).toBe('prefix ');
    expect(visible).not.toContain('<use_mcp_tool');
  });
});
