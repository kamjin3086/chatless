import { describe, expect, test } from 'vitest';
import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '@/lib/llm/types/stream-events';
import { createPromptToolTrack } from '../promptTrack';

/**
 * A format the parser already reads today (`<use_mcp_tool>`), so this file stays
 * about the wiring: whether the track turns text into calls, and whether a
 * native run is left alone.
 */
const TEXT_CALL =
  '<use_mcp_tool><server_name>mcp</server_name><tool_name>search</tool_name><arguments>{"q":"x"}</arguments></use_mcp_tool>';

function sink() {
  const seen: StreamEvent[] = [];
  return {
    seen,
    dispatch: (event: StreamEvent) => {
      seen.push(event);
    },
  };
}

function visibleText(events: StreamEvent[]): string {
  return events
    .filter((event) => event.type === 'content_token')
    .map(
      (event) =>
        (event as Extract<StreamEvent, { type: 'content_token' }>).content,
    )
    .join('');
}

describe('createPromptToolTrack', () => {
  test('a text call becomes one tool_call, and its markup never reaches the answer', async () => {
    const { seen, dispatch } = sink();
    const track = createPromptToolTrack({ track: 'prompt', dispatch });

    await track.onEvent(createStreamEvent.contentToken('prefix '));
    await track.onEvent(createStreamEvent.contentToken(TEXT_CALL));
    await track.flush();

    expect(visibleText(seen)).toBe('prefix ');
    const calls = seen.filter((event) => event.type === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: 'tool_call',
      parsed: { serverName: 'mcp', toolName: 'search' },
    });
    expect(JSON.parse((calls[0] as any).parsed.arguments)).toEqual({ q: 'x' });
  });

  test('a native run forwards the same text and executes nothing extra', async () => {
    const { seen, dispatch } = sink();
    const track = createPromptToolTrack({ track: 'native', dispatch });

    await track.onEvent(createStreamEvent.contentToken(`prefix ${TEXT_CALL}`));
    await track.flush();

    expect(seen.some((event) => event.type === 'tool_call')).toBe(false);
    expect(visibleText(seen)).toBe(`prefix ${TEXT_CALL}`);
  });

  test('a disabled run parses no text either', async () => {
    const { seen, dispatch } = sink();
    const track = createPromptToolTrack({ track: 'disabled', dispatch });

    await track.onEvent(createStreamEvent.contentToken(TEXT_CALL));
    await track.flush();

    expect(seen.some((event) => event.type === 'tool_call')).toBe(false);
    expect(visibleText(seen)).toBe(TEXT_CALL);
  });

  test('prose without a call passes through untouched', async () => {
    const { seen, dispatch } = sink();
    const track = createPromptToolTrack({ track: 'prompt', dispatch });

    await track.onEvent(createStreamEvent.contentToken('卡布奇诺的水温'));
    await track.onEvent(
      createStreamEvent.thinkingToken('thinking is not a call'),
    );
    await track.flush();

    expect(visibleText(seen)).toBe('卡布奇诺的水温');
    expect(
      seen.filter((event) => event.type === 'thinking_token'),
    ).toHaveLength(1);
    expect(seen.some((event) => event.type === 'tool_call')).toBe(false);
  });

  test('one turn parses once, even if the provider ends the stream before onComplete', async () => {
    const { seen, dispatch } = sink();
    const track = createPromptToolTrack({ track: 'prompt', dispatch });

    await track.onEvent(createStreamEvent.contentToken(TEXT_CALL));
    await track.onEvent(createStreamEvent.streamComplete());
    await track.flush();

    expect(seen.filter((event) => event.type === 'tool_call')).toHaveLength(1);
  });

  test('a regeneration is told not to call tools, so its text is not parsed either', async () => {
    const { seen, dispatch } = sink();
    const track = createPromptToolTrack({
      track: 'prompt',
      allowTextCalls: false,
      dispatch,
    });

    await track.onEvent(createStreamEvent.contentToken(TEXT_CALL));
    await track.flush();

    expect(seen.some((event) => event.type === 'tool_call')).toBe(false);
    expect(visibleText(seen)).toBe(TEXT_CALL);
  });
});
