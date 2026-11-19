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

  // #165: the three text-call shapes seen in the field. Each is one fixture at
  // this seam, because the seam is where "the markup is hidden" and "the call is
  // understood" are decided together.
  function runThrough(tokens: string[]) {
    const parser = new ToolChannelParser();
    return parser.rewriteEvents([
      ...tokens.map((content) => createStreamEvent.contentToken(content)),
      createStreamEvent.streamComplete(),
    ]);
  }

  function calls(events: ReturnType<typeof runThrough>) {
    return events.filter((e) => e.type === 'tool_call') as Array<
      Extract<ReturnType<typeof runThrough>[number], { type: 'tool_call' }>
    >;
  }

  function visible(events: ReturnType<typeof runThrough>) {
    return events
      .filter((e) => e.type === 'content_token')
      .map((e) => (e as Extract<ReturnType<typeof runThrough>[number], { type: 'content_token' }>).content)
      .join('');
  }

  test('bracketed calling form: one call, no markup in the answer', () => {
    const events = runThrough([
      '我先查一下。\n',
      '[[calling knowledge__search with query: 卡布奇诺 温度要求]]',
    ]);

    expect(visible(events)).toBe('我先查一下。\n');
    expect(calls(events)).toHaveLength(1);
    expect(calls(events)[0].parsed).toMatchObject({
      serverName: 'knowledge',
      toolName: 'search',
      arguments: JSON.stringify({ query: '卡布奇诺 温度要求' }),
    });
  });

  test('a bracketed sentence that is not a call stays in the answer', () => {
    const text = '这里只是说明 [[note: 温度以 92 度为准]]，不是工具调用。';
    const events = runThrough([text]);

    expect(visible(events)).toBe(text);
    expect(calls(events)).toHaveLength(0);
  });

  test('Gemma tool_call opener: one call, no markup in the answer', () => {
    const events = runThrough([
      '先列出可用文档。',
      '<|tool_call>call:knowledge__list{}<tool_call|>',
    ]);

    expect(visible(events)).toBe('先列出可用文档。');
    expect(calls(events)).toHaveLength(1);
    expect(calls(events)[0].parsed).toMatchObject({
      serverName: 'knowledge',
      toolName: 'list',
      arguments: '{}',
    });
  });

  test('DeepSeek DSML invoke: one call with its parameter, no markup in the answer', () => {
    const events = runThrough([
      '我来查询知识库。\n',
      '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="knowledge__search">\n<｜DSML｜parameter name="query" string="true">卡布奇诺 温度</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>',
    ]);

    expect(visible(events)).toBe('我来查询知识库。\n');
    expect(calls(events)).toHaveLength(1);
    expect(calls(events)[0].parsed).toMatchObject({
      serverName: 'knowledge',
      toolName: 'search',
      arguments: JSON.stringify({ query: '卡布奇诺 温度' }),
    });
  });
});
