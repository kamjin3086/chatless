/**
 * The unreadable look-alike card (#166).
 *
 * A prompt-track turn whose text looked like a call but could not be read must
 * end in a card that says so, not in an answer that stops without a reason. That
 * card is asserted here at the segment layer, the way `toolCardTiming` asserts the
 * timing rules: the state comes from the pure helper, then through the same
 * insert/update functions the FSM uses.
 */
import { describe, expect, it } from 'vitest';
import { notExecutedCardState } from '../notExecutedCard';
import {
  insertRunningCard,
  updateCardStatus,
  type MessageSegment,
  type ToolCardSegment,
} from '../segments';

function notExecutedSegments(rawText: string): MessageSegment[] {
  const state = notExecutedCardState(rawText);
  const withCard = insertRunningCard([{ kind: 'text', text: '' }], {
    id: 'not-executed-1',
    server: state.server,
    tool: state.tool,
    args: {},
    messageId: 'msg-1',
  });
  return updateCardStatus(
    withCard,
    { id: 'not-executed-1', server: state.server, tool: state.tool },
    { status: 'error', errorMessage: state.errorMessage },
  );
}

function card(segments: MessageSegment[]): ToolCardSegment {
  const found = segments.find((segment) => segment.kind === 'toolCard');
  expect(found).toBeTruthy();
  return found as ToolCardSegment;
}

describe('an unreadable look-alike call', () => {
  const rawText = '[[calling knowledge__search with query: 卡布奇诺 温度]]';

  it('ends as an error card that names the call, the raw text and the remedy', () => {
    const state = notExecutedCardState(rawText);
    const segment = card(notExecutedSegments(rawText));

    // The existing status vocabulary: an `error` card, not a second state.
    expect(segment.status).toBe('error');
    // Nothing ran, so there is nothing to approve.
    expect(segment.status).not.toBe('pending_auth');
    expect(segment.server).toBe('knowledge');
    expect(segment.tool).toBe('search');
    expect(state.errorMessage.startsWith('未执行')).toBe(true);
    expect(state.errorMessage).toContain(rawText);
    expect(state.errorMessage).toContain('原生API');
    expect(segment.errorMessage).toBe(state.errorMessage);
  });

  it('shows the wording first, so the collapsed row is not the raw markup', () => {
    const state = notExecutedCardState(rawText);
    expect(state.errorMessage.split('\n')[0]).toBe('未执行：模型把工具调用写成了文字，应用没有执行。');
  });

  it('falls back to neutral names when the markup names no tool', () => {
    const state = notExecutedCardState('<|tool_call>call:???');
    expect(state.server).toBe('未知服务');
    expect(state.tool).toBe('工具调用');
    expect(state.errorMessage).toContain('<|tool_call>call:???');
  });
});

describe('a parsed call', () => {
  it('keeps the ordinary running card, unaffected by the not-executed state', () => {
    const segments = insertRunningCard([{ kind: 'text', text: '' }], {
      id: 'card-1',
      server: 'knowledge',
      tool: 'search',
      args: { query: '卡布奇诺 温度' },
      messageId: 'msg-1',
    });
    const segment = card(segments);
    expect(segment.status).toBe('running');
    expect(segment.errorMessage).toBeUndefined();
    expect(segment.resultPreview).toBeUndefined();
  });
});
