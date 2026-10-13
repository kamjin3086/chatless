import { describe, expect, it } from 'vitest';
import {
  dropInheritedThatSessionDisabled,
  readSessionThinkingChoice,
  withSessionThinkingChoice,
} from '../sessionParameterMerge';

/**
 * The session is allowed to contradict the model. `false` on an enable flag is that
 * contradiction and has to remove the inherited value; anything else inherits. The
 * thinking-level case is what this replaced: a conversation could not switch off a
 * level the model default had set, because the send path did not know the flag existed.
 */
describe('dropInheritedThatSessionDisabled', () => {
  it('inherits everything when the session has no opinion', () => {
    const inherited = {
      temperature: 0.2,
      thinkingLevel: 'high',
      streaming: true,
    };
    expect(dropInheritedThatSessionDisabled(inherited, {})).toEqual(inherited);
    expect(dropInheritedThatSessionDisabled(inherited, null)).toEqual(
      inherited,
    );
    expect(dropInheritedThatSessionDisabled(inherited, undefined)).toEqual(
      inherited,
    );
  });

  it('removes only what the session explicitly disabled', () => {
    const inherited = {
      temperature: 0.2,
      maxTokens: 400,
      thinkingLevel: 'high',
      thinking: true,
    };
    expect(
      dropInheritedThatSessionDisabled(inherited, {
        enableTemperature: false,
        enableThinkingLevel: false,
      }),
    ).toEqual({ maxTokens: 400, thinking: true });
  });

  it('treats thinking, streaming and format the same way everywhere', () => {
    const inherited = { thinking: true, streaming: true, format: 'json' };
    expect(
      dropInheritedThatSessionDisabled(inherited, {
        enableThinking: false,
        enableStreaming: false,
        enableFormat: false,
      }),
    ).toEqual({});
  });

  it('round-trips the three things a conversation can say about thinking', () => {
    expect(readSessionThinkingChoice({})).toBe('inherit');
    expect(
      readSessionThinkingChoice(withSessionThinkingChoice({}, 'low')),
    ).toBe('low');
    expect(
      readSessionThinkingChoice(withSessionThinkingChoice({}, 'suppress')),
    ).toBe('suppress');
    // choosing a level then going back to inherit must not leave a level behind
    const back = withSessionThinkingChoice(
      withSessionThinkingChoice({}, 'low'),
      'inherit',
    );
    expect(back.enableThinkingLevel).toBeUndefined();
    expect(back.thinkingLevel).toBe('low'); // stored but not sent: choice governs
    expect(readSessionThinkingChoice(back)).toBe('inherit');
    // and a suppressed choice really removes the inherited value
    expect(
      dropInheritedThatSessionDisabled(
        { thinkingLevel: 'high' },
        withSessionThinkingChoice({}, 'suppress'),
      ),
    ).toEqual({});
  });

  it('leaves an untouched copy behind', () => {
    const inherited = { temperature: 0.2 };
    const out = dropInheritedThatSessionDisabled(inherited, {
      enableTemperature: false,
    });
    expect(inherited).toEqual({ temperature: 0.2 });
    expect(out).toEqual({});
  });
});
