/**
 * Tool-call timings (#133).
 *
 * The row wants to say how long a call took (`运行命令 … · 1.2s`). That needs a stamp on the
 * card and a number on the row, and three ways to get it wrong:
 *
 * - a card that never got a reply (stopped, awaiting approval) must not show a duration - the
 *   number would be "how long we waited", not "how long it ran";
 * - a sub-second call must not round to `0s`, which is why the point of the column exists;
 * - a row stored before the field existed must render exactly as it did, with no placeholder.
 *
 * These are the rules, asserted on the segment layer and on the formatter the row uses.
 */
import { describe, expect, it } from 'vitest';
import {
  cardDurationSeconds,
  insertRunningCard,
  updateCardStatus,
  type MessageSegment,
  type ToolCardSegment,
} from '../segments';
import { formatToolDuration } from '@/components/chat/toolCardPresentation';

function emptyMessage(): MessageSegment[] {
  return [{ kind: 'text', text: '' }];
}

function runningCard(startTime: number = Date.now()): MessageSegment[] {
  const segments = insertRunningCard(emptyMessage(), {
    id: 'card-1',
    server: 'knowledge',
    tool: 'knowledge__search',
    args: { query: '卡布奇诺 温度' },
    messageId: 'msg-1',
  });
  return segments.map((s) =>
    s.kind === 'toolCard' ? ({ ...s, startTime } as ToolCardSegment) : s,
  );
}

/** A row persisted before the field existed: a running card with no start stamp. */
function legacyCard(): MessageSegment[] {
  return [
    { kind: 'text', text: '' },
    {
      kind: 'toolCard',
      id: 'card-1',
      server: 'knowledge',
      tool: 'knowledge__search',
      args: { query: '卡布奇诺 温度' },
      status: 'running',
      messageId: 'msg-1',
    } as ToolCardSegment,
  ];
}

function card(segments: MessageSegment[]): ToolCardSegment {
  const found = segments.find((s) => s.kind === 'toolCard');
  expect(found).toBeTruthy();
  return found as ToolCardSegment;
}

describe('a running card starts a clock', () => {
  it('stamps the moment the call is inserted', () => {
    const before = Date.now();
    const inserted = card(runningCard());
    expect(typeof inserted.startTime).toBe('number');
    expect(inserted.startTime).toBeGreaterThanOrEqual(before);
    expect(inserted.duration).toBeUndefined();
  });

  it('keeps an existing stamp when the run resumes after approval', () => {
    const started = 1_000;
    const resumed = insertRunningCard(runningCard(started), {
      id: 'card-1',
      server: 'knowledge',
      tool: 'knowledge__search',
      messageId: 'msg-1',
    });
    expect(card(resumed).startTime).toBe(started);
  });
});

describe('a finished card carries the duration', () => {
  it('records success in one-decimal seconds from the stamp', () => {
    const finished = updateCardStatus(
      runningCard(10_000),
      { id: 'card-1', server: 'knowledge', tool: 'knowledge__search' },
      { status: 'success', resultPreview: 'ok' },
      11_240,
    );
    expect(card(finished).duration).toBe(1.2);
    expect(card(finished).status).toBe('success');
  });

  it('records an error the same way, keeping the message', () => {
    const finished = updateCardStatus(
      runningCard(10_000),
      { id: 'card-1', server: 'knowledge', tool: 'knowledge__search' },
      { status: 'error', errorMessage: 'boom' },
      13_050,
    );
    expect(card(finished).duration).toBe(3.1);
    expect(card(finished).errorMessage).toBe('boom');
  });

  it('does not invent a duration for a card with no stamp', () => {
    // Rows stored before this field existed: the update still runs, and adds nothing.
    const finished = updateCardStatus(
      legacyCard(),
      { id: 'card-1', server: 'knowledge', tool: 'knowledge__search' },
      { status: 'success', resultPreview: 'ok' },
      11_240,
    );
    expect(card(finished).duration).toBeUndefined();
  });

  it('drops the duration when a call is stopped, and on approval', () => {
    const stopped = updateCardStatus(
      runningCard(10_000),
      { id: 'card-1', server: 'knowledge', tool: 'knowledge__search' },
      { status: 'stopped', errorMessage: 'stopped' },
      11_240,
    );
    expect(card(stopped).duration).toBeUndefined();

    const awaiting = updateCardStatus(
      runningCard(10_000),
      { id: 'card-1', server: 'knowledge', tool: 'knowledge__search' },
      { status: 'pending_auth', errorMessage: 'pending_auth' },
      11_240,
    );
    expect(card(awaiting).duration).toBeUndefined();
  });
});

describe('seconds are rounded where it matters', () => {
  it('keeps a sub-second call visible instead of showing 0', () => {
    expect(cardDurationSeconds(1_000, 1_040)).toBe(0.1);
    expect(cardDurationSeconds(1_000, 1_005)).toBe(0.1);
    expect(formatToolDuration(cardDurationSeconds(1_000, 1_040))).toBe('0.1s');
    expect(formatToolDuration(cardDurationSeconds(1_000, 1_420))).toBe('0.4s');
  });

  it('keeps one decimal below ten seconds and rounds above', () => {
    expect(formatToolDuration(1.24)).toBe('1.2s');
    expect(formatToolDuration(9.96)).toBe('10.0s');
    expect(formatToolDuration(12.4)).toBe('12s');
    expect(formatToolDuration(83.6)).toBe('84s');
  });

  it('renders nothing for a missing or nonsense value', () => {
    expect(formatToolDuration(undefined)).toBeNull();
    expect(formatToolDuration(null)).toBeNull();
    expect(formatToolDuration(0)).toBeNull();
    expect(formatToolDuration(-1)).toBeNull();
    expect(formatToolDuration(Number.NaN)).toBeNull();
  });
});
