/**
 * Chat-template turn boundaries.
 *
 * The regression these cover: a leaked `<|im_end|>` let the model keep writing
 * and invent the next turns of the conversation, and the app rendered that
 * invented turn as the answer.
 */

import {
  createTurnBoundaryGuard,
  findEarliestTerminator,
  guardTurnBoundaries,
  holdBackFrom,
} from '../turnBoundary';
import { StandardThinkingStrategy } from '../standard-thinking-strategy';

/** Verbatim shape of the stored thinking of the message that exposed the bug. */
const LEAKED_CONTENT =
  "<think>This is just casual conversation, so I'll respond naturally without overthinking it.<|im_end|>\n" +
  '<|im_start|>user\n你能<|im_end|>\n' +
  "<|im_start|>assistant\n<think>\nThe user's message appears to have been cut off midway. I should simply ask them to complete it.";

describe('findEarliestTerminator', () => {
  it('finds an end-of-turn token', () => {
    expect(findEarliestTerminator('answer<|im_end|>tail', false)).toEqual({ index: 6, token: '<|im_end|>' });
  });

  it('ignores a turn-opening token when only end tokens count', () => {
    expect(findEarliestTerminator('<|im_start|>assistant', false)).toBeNull();
  });

  it('counts a turn-opening token when asked', () => {
    expect(findEarliestTerminator('answer<|im_start|>assistant', true)).toEqual({
      index: 6,
      token: '<|im_start|>',
    });
  });

  it('does not treat the GPT-OSS harmony tags as boundaries', () => {
    expect(findEarliestTerminator('<|start|>assistant<|channel|>final<|message|>hi<|end|>', true)).toBeNull();
  });
});

describe('holdBackFrom', () => {
  it('holds a partial token at the tail', () => {
    expect(holdBackFrom('answer<|im_')).toBe('answer'.length);
  });

  it('holds a complete strip-only token so its role word is removed together', () => {
    expect(holdBackFrom('answer<|im_start|>')).toBe('answer'.length);
  });

  it('forwards ordinary text unchanged', () => {
    expect(holdBackFrom('answer <|end|> done')).toBe('answer <|end|> done'.length);
  });
});

describe('createTurnBoundaryGuard', () => {
  it('passes ordinary text through', () => {
    const guard = createTurnBoundaryGuard();
    const token = guard.filterToken({ content: '你好，有什么可以帮你？' });
    expect(token.content).toBe('你好，有什么可以帮你？');
    expect(guard.ended).toBe(false);
  });

  it('keeps the text before the boundary and drops everything after it', () => {
    const guard = createTurnBoundaryGuard();
    const token = guard.filterToken({ content: 'answer<|im_end|>you never asked for this' });
    expect(token.content).toBe('answer');
    expect(guard.ended).toBe(true);
    // Everything from the boundary token onwards is gone.
    expect(guard.droppedChars).toBe('<|im_end|>you never asked for this'.length);
  });

  it('drops later deltas entirely', () => {
    const guard = createTurnBoundaryGuard();
    guard.filterToken({ content: 'answer<|im_end|>' });
    expect(guard.filterToken({ content: 'more hallucinated turns' }).content).toBe('');
  });

  it('matches a token split across two chunks', () => {
    const guard = createTurnBoundaryGuard();
    expect(guard.filterToken({ content: 'answer<|im_' }).content).toBe('answer');
    expect(guard.ended).toBe(false);
    expect(guard.filterToken({ content: 'end|>dropped' }).content).toBe('');
    expect(guard.ended).toBe(true);
  });

  it('treats a leading <|im_start|>assistant as template noise, not as a boundary', () => {
    const guard = createTurnBoundaryGuard();
    const token = guard.filterToken({ content: '<|im_start|>assistant\n你好' });
    expect(token.content).toBe('你好');
    expect(guard.ended).toBe(false);
  });

  it('treats <|im_start|> as a boundary once text was produced', () => {
    const guard = createTurnBoundaryGuard();
    const token = guard.filterToken({ content: '你好<|im_start|>user\n你没说过的话' });
    expect(token.content).toBe('你好');
    expect(guard.ended).toBe(true);
  });

  it('filters the reasoning channel too', () => {
    const guard = createTurnBoundaryGuard();
    const token = guard.filterToken({ reasoning_content: 'thinking<|eot_id|>invented' });
    expect(token.reasoning_content).toBe('thinking');
    expect(guard.ended).toBe(true);
  });

  it('reset() restores a usable guard', () => {
    const guard = createTurnBoundaryGuard();
    guard.filterToken({ content: 'x<|im_end|>' });
    guard.reset();
    expect(guard.ended).toBe(false);
    expect(guard.filterToken({ content: 'hello' }).content).toBe('hello');
  });
});

describe('guarded strategy', () => {
  it('never renders the turn the model invented for itself', () => {
    const strategy = guardTurnBoundaries(new StandardThinkingStrategy());

    const first = strategy.processToken({ content: LEAKED_CONTENT, done: false });
    expect(first.turnEnded).toBe(true);
    expect(first.isComplete).toBe(false);

    const text = first.events
      .map((event: any) => String(event.content || ''))
      .join('');
    expect(text).toContain('This is just casual conversation');
    expect(text).not.toContain('你能');
    expect(text).not.toContain('cut off');

    // The stream still has to close properly once the provider reports done.
    const last = strategy.processToken({ done: true });
    expect(last.events).toContainEqual(expect.objectContaining({ type: 'thinking_end' }));
    expect(last.events).toContainEqual(expect.objectContaining({ type: 'stream_complete' }));
  });

  it('keeps dropping deltas after the boundary', () => {
    const strategy = guardTurnBoundaries(new StandardThinkingStrategy());
    strategy.processToken({ content: 'answer<|im_end|>', done: false });
    const later = strategy.processToken({ content: 'invented turn', done: false });
    expect(later.events).toEqual([]);
    expect(later.turnEnded).toBe(true);
  });

  it('has no effect on clean streams', () => {
    const strategy = guardTurnBoundaries(new StandardThinkingStrategy());
    const out = strategy.processToken({ content: '<think>想一下</think>答案', done: false });
    expect(out.turnEnded).toBeUndefined();
    expect(out.events).toContainEqual(expect.objectContaining({ type: 'thinking_token', content: '想一下' }));
  });
});
