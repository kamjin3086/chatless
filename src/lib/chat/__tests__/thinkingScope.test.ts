import { describe, expect, it } from 'vitest';
import {
  applyThinkingChoice,
  foldMessageScopeIntoSession,
  migrateLegacyThinkingBoolean,
  cycleThinkingLevel,
  effectiveThinking,
  readThinkingChoice,
} from '../thinkingScope';
import { dropInheritedThatSessionDisabled } from '../sessionParameterMerge';
import type { ThinkingLevel } from '@/lib/llm/thinkingLevels';
import { ModelParametersService } from '@/lib/model-parameters';
import {
  DEFAULT_MODEL_PARAMETERS,
  type ModelParameters,
} from '@/types/model-params';

const KNOWN = { provider: 'openai', modelId: 'gpt-5.8' };
const UNKNOWN = { provider: 'somegateway', modelId: 'mystery-9000' };
const OFF_CAPABLE = { provider: 'openai', modelId: 'gpt-5.8' };
const NO_OFF = {
  provider: 'google-gemini',
  modelId: 'gemini-3.1-flash-lite-image',
};

describe('effective thinking level', () => {
  it('follows the model default when nothing above it has an opinion', () => {
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
    });
    expect(view.level).toBe('high');
    expect(view.source).toBe('model');
  });

  it('says the model decides when no scope chose anything', () => {
    const view = effectiveThinking({ ...KNOWN, modelParams: {} });
    expect(view.level).toBe('auto');
    expect(view.source).toBe('model-default');
  });

  it('a conversation overrides the model default, and says so', () => {
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
    });
    expect(view.level).toBe('low');
    expect(view.source).toBe('conversation');
  });

  it('a conversation can refuse to send a level the model default set', () => {
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: { enableThinkingLevel: false },
    });
    // Nothing goes on the wire, but the conversation is still what decided that, and the
    // UI has to say where the "do not think" came from.
    expect(view.level).toBe('auto');
    expect(view.source).toBe('conversation');
  });

  it('a single message outranks both, without touching either', () => {
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
      messageParams: { enableThinkingLevel: true, thinkingLevel: 'minimal' },
    });
    expect(view.level).toBe('minimal');
    expect(view.source).toBe('message');
  });

  it('offers the generic tiers on a provider it has not verified, and says who they are', () => {
    const view = effectiveThinking({ ...UNKNOWN, modelParams: {} });
    expect(view.level).toBe('auto');
    expect(view.source).toBe('unverified');
    expect(view.verified).toBe(false);
    expect(view.options).toEqual(['auto', 'minimal', 'low', 'medium', 'high']);
  });

  it('shows a saved level on an unverified model and marks it generic', () => {
    // It will be sent, through the generic field, so hiding the choice would be the lie;
    // `verified: false` is where the uncertainty belongs.
    const view = effectiveThinking({
      ...UNKNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
    });
    expect(view.level).toBe('high');
    expect(view.source).toBe('model');
    expect(view.verified).toBe(false);
  });

  it('marks a tier no generic field can express as not going out', () => {
    const view = effectiveThinking({
      ...UNKNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'xhigh' },
    });
    expect(view.level).toBe('auto');
    expect(view.stale).toBe(true);
  });

  it('choosing auto at a scope hands the question back to the scope below', () => {
    const next = applyThinkingChoice({
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
      conversationParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      messageParams: null,
      scope: 'conversation',
      level: 'inherit',
    });
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: next.modelParams,
      conversationParams: next.conversationParams,
      messageParams: next.messageParams,
    });
    expect(view.level).toBe('low');
    expect(view.source).toBe('model');
  });

  it('lets one message refuse the level its session set', () => {
    // The "none" the control needs: suppressing outranks a lower scope rather than
    // inheriting past it, so a single message can go out with no thinking level.
    const session: Partial<ModelParameters> = {
      enableThinkingLevel: true,
      thinkingLevel: 'high',
    };
    const next = applyThinkingChoice({
      modelParams: {},
      conversationParams: session,
      messageParams: null,
      scope: 'message',
      level: 'suppress',
    });
    expect(readThinkingChoice(next.messageParams)).toBe('suppress');
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: next.modelParams,
      conversationParams: next.conversationParams,
      messageParams: next.messageParams,
    });
    expect(view.level).toBe('auto');
    expect(view.source).toBe('message');
  });

  it('offers auto plus the tiers this model actually has', () => {
    const view = effectiveThinking({ ...KNOWN, modelParams: {} });
    expect(view.options[0]).toBe('auto');
    expect(view.options).toContain('xhigh');
  });

  it('does not claim a level the model cannot take', () => {
    // The stored value outlives the mapping table: a model can lose a tier, or the choice
    // can be copied from another model. Showing it as in force would be a lie on screen,
    // and silently swapping it for a neighbour would be a guess.
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'max' },
    });
    expect(view.options).not.toContain('max');
    expect(view.level).toBe('auto');
    expect(view.source).toBe('model');
    expect(view.stale).toBe(true);
  });
});

describe('reading one scope', () => {
  it('reads the tri-state a params bag carries', () => {
    expect(readThinkingChoice({})).toBe('inherit');
    expect(readThinkingChoice(null)).toBe('inherit');
    expect(readThinkingChoice({ enableThinkingLevel: false })).toBe('suppress');
    expect(
      readThinkingChoice({ enableThinkingLevel: true, thinkingLevel: 'low' }),
    ).toBe('low');
    expect(
      readThinkingChoice({ enableThinkingLevel: true, thinkingLevel: 'auto' }),
    ).toBe('inherit');
  });
});

describe('cycling levels with the keyboard', () => {
  const opts: ThinkingLevel[] = [
    'auto',
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ];

  it('walks the documented order and wraps', () => {
    expect(cycleThinkingLevel({ options: opts, current: 'auto' })).toBe('off');
    expect(cycleThinkingLevel({ options: opts, current: 'low' })).toBe(
      'medium',
    );
    expect(cycleThinkingLevel({ options: opts, current: 'xhigh' })).toBe(
      'auto',
    );
  });

  it('goes backwards just as far', () => {
    expect(
      cycleThinkingLevel({ options: opts, current: 'auto', shift: -1 }),
    ).toBe('xhigh');
    expect(
      cycleThinkingLevel({ options: opts, current: 'medium', shift: -1 }),
    ).toBe('low');
  });

  it('visits every tier a model has and none it lacks', () => {
    // A model with two tiers: the cycle is the model's list, not the global one, so no
    // click can land on a tier this model was never documented to serve.
    const narrow: ThinkingLevel[] = ['auto', 'minimal', 'high'];
    const seen: string[] = [];
    let at: ThinkingLevel = 'auto';
    for (let i = 0; i < narrow.length; i += 1) {
      at = cycleThinkingLevel({ options: narrow, current: at });
      seen.push(at);
    }
    expect(seen).toEqual(['minimal', 'high', 'auto']);
  });

  it('starts from the first real tier when the saved level is not on the list', () => {
    expect(cycleThinkingLevel({ options: opts, current: 'max' })).toBe('off');
    expect(cycleThinkingLevel({ options: [], current: 'high' })).toBe('auto');
  });
});

describe('choosing a scope', () => {
  const CLEAN = {
    modelParams: {},
    conversationParams: {},
    messageParams: null,
  };

  it('writes only the model scope when that is what was chosen', () => {
    const next = applyThinkingChoice({
      ...CLEAN,
      scope: 'model',
      level: 'medium',
    });
    expect(next.modelParams).toEqual({
      enableThinkingLevel: true,
      thinkingLevel: 'medium',
    });
    expect(next.conversationParams).toEqual({});
    expect(next.messageParams).toBe(null);
  });

  it('round-trips every tier it can write', () => {
    for (const level of [
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ] as ThinkingLevel[]) {
      const next = applyThinkingChoice({ ...CLEAN, scope: 'model', level });
      expect(readThinkingChoice(next.modelParams)).toBe(level);
    }
  });

  it('choosing auto at a scope means that scope stops choosing', () => {
    const next = applyThinkingChoice({
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: {},
      messageParams: null,
      scope: 'model',
      level: 'auto',
    });
    expect(readThinkingChoice(next.modelParams)).toBe('inherit');
    // Nothing is left behind: a half-cleared bag would read as a stale choice later.
    expect(next.modelParams.enableThinkingLevel).toBeUndefined();
    expect(next.modelParams.thinkingLevel).toBeUndefined();
  });

  it('leaves the model default alone when only the conversation changes', () => {
    const next = applyThinkingChoice({
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: {},
      messageParams: null,
      scope: 'conversation',
      level: 'low',
    });
    expect(readThinkingChoice(next.modelParams)).toBe('high');
    expect(readThinkingChoice(next.conversationParams)).toBe('low');
  });

  it('a conversation that stops choosing falls back to the model default', () => {
    const next = applyThinkingChoice({
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
      messageParams: null,
      scope: 'conversation',
      level: 'auto',
    });
    const view = effectiveThinking({
      ...KNOWN,
      modelParams: next.modelParams,
      conversationParams: next.conversationParams,
      messageParams: next.messageParams,
    });
    expect(view).toMatchObject({
      level: 'high',
      source: 'model',
      stale: false,
    });
  });

  it('a message choice touches neither persistent scope', () => {
    const next = applyThinkingChoice({
      modelParams: { enableThinkingLevel: true, thinkingLevel: 'high' },
      conversationParams: { enableThinkingLevel: false },
      messageParams: null,
      scope: 'message',
      level: 'minimal',
    });
    expect(next.modelParams).toEqual({
      enableThinkingLevel: true,
      thinkingLevel: 'high',
    });
    expect(next.conversationParams).toEqual({ enableThinkingLevel: false });
    expect(readThinkingChoice(next.messageParams)).toBe('minimal');
  });

  it('writing a lasting scope retires a pending one-shot, so nothing shadows it', () => {
    // A message override is about to be consumed by the next send. Leaving it in place
    // while the user sets a conversation or model default would mean the change appears
    // to do nothing, and the control would keep reporting the old source.
    for (const scope of ['model', 'conversation'] as const) {
      const next = applyThinkingChoice({
        modelParams: {},
        conversationParams: {},
        messageParams: { enableThinkingLevel: true, thinkingLevel: 'xhigh' },
        scope,
        level: 'low',
      });
      expect(next.messageParams).toBe(null);
      expect(next.clearedMessageOverride).toBe(true);
    }
  });

  it('keeps a conversation override that outranks a newly written model default', () => {
    // A conversation choice is a real choice, not debris: the control still reports the
    // conversation as in force, which is the truth, instead of quietly erasing it.
    const next = applyThinkingChoice({
      modelParams: {},
      conversationParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
      messageParams: null,
      scope: 'model',
      level: 'high',
    });
    expect(readThinkingChoice(next.modelParams)).toBe('high');
    expect(readThinkingChoice(next.conversationParams)).toBe('low');
    expect(
      effectiveThinking({
        ...KNOWN,
        modelParams: next.modelParams,
        conversationParams: next.conversationParams,
      }).source,
    ).toBe('conversation');
  });
});

describe('folding a message choice into the send', () => {
  it('changes nothing when no message choice is pending', () => {
    const session: Partial<ModelParameters> = {
      enableThinkingLevel: true,
      thinkingLevel: 'low',
    };
    expect(foldMessageScopeIntoSession(session, null)).toEqual(session);
  });

  it('a message choice outranks the conversation one', () => {
    const merged = foldMessageScopeIntoSession(
      { enableThinkingLevel: true, thinkingLevel: 'low' },
      { enableThinkingLevel: true, thinkingLevel: 'minimal' },
    );
    expect(readThinkingChoice(merged)).toBe('minimal');
  });

  it('a message choice can refuse a level the conversation set', () => {
    const merged = foldMessageScopeIntoSession(
      { enableThinkingLevel: true, thinkingLevel: 'low' },
      { enableThinkingLevel: false },
    );
    expect(readThinkingChoice(merged)).toBe('suppress');
  });

  it('carries only the thinking keys, so nothing else rides along', () => {
    // A stray temperature is the shape of the bug worth keeping out: a control for one
    // setting must not become a way to change every setting for one message.
    const merged = foldMessageScopeIntoSession({ temperature: 0.2 }, {
      enableThinkingLevel: true,
      thinkingLevel: 'low',
      temperature: 0.9,
      maxTokens: 5,
    } as unknown as ModelParameters);
    expect(merged).toEqual({
      temperature: 0.2,
      enableThinkingLevel: true,
      thinkingLevel: 'low',
    });
  });

  it('reaches the wire: a message refusal removes the level the model default set', () => {
    // This is the whole point of the scope: it has to change what goes out, not just what
    // the control shows. The existing session filter is what applies a refusal, so the
    // folded bag has to pass through it the same way a conversation's own bag does.
    const modelOpts = { thinkingLevel: 'high', temperature: 0.5 };
    const folded = foldMessageScopeIntoSession(null, {
      enableThinkingLevel: false,
    });
    expect(dropInheritedThatSessionDisabled(modelOpts, folded)).toEqual({
      temperature: 0.5,
    });
  });
});

describe('the retired thinking boolean', () => {
  const OFF_CAPABLE = { provider: 'openai', modelId: 'gpt-5.8' };
  const NO_OFF = {
    provider: 'google-gemini',
    modelId: 'gemini-3.1-flash-lite-image',
  };

  it('does nothing to a bag that never carried the boolean', () => {
    const params = { temperature: 0.4 };
    const result = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params,
    });
    expect(result.migration).toBe('none');
    expect(result.params).toEqual(params);
  });

  it('turns "do not think" into the level that means exactly that', () => {
    const result = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params: { enableThinking: true, thinking: false },
    });
    expect(result.migration).toBe('off');
    expect(readThinkingChoice(result.params)).toBe('off');
    // The boolean is gone rather than left to double-speak behind the level's back.
    expect(result.params.thinking).toBeUndefined();
    expect(result.params.enableThinking).toBeUndefined();
  });

  it('keeps "think harder" as it was, because no single level means that', () => {
    // Mapping true onto, say, medium would be an invention: the boolean never named an
    // amount. The old setting keeps doing what it did, and the explanation says so.
    const result = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params: { enableThinking: true, thinking: true },
    });
    expect(result.migration).toBe('kept-on');
    expect(readThinkingChoice(result.params)).toBe('inherit');
    expect(result.params.thinking).toBe(true);
  });

  it('keeps the boolean when this model has no level that matches it', () => {
    const result = migrateLegacyThinkingBoolean({
      ...NO_OFF,
      params: { enableThinking: true, thinking: false },
    });
    expect(result.migration).toBe('kept-unsupported');
    expect(result.params.thinking).toBe(false);
    expect(readThinkingChoice(result.params)).toBe('inherit');
  });

  it('a real level choice outranks the old boolean', () => {
    const result = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params: {
        enableThinking: true,
        thinking: false,
        enableThinkingLevel: true,
        thinkingLevel: 'low',
      },
    });
    expect(result.migration).toBe('none');
    expect(readThinkingChoice(result.params)).toBe('low');
    expect(result.params.thinking).toBeUndefined();
  });

  it('a session that switched the boolean off for good says nothing instead', () => {
    // `enableThinking: false` is the "this conversation refuses it" flag, not a level.
    const result = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params: { enableThinking: false, thinking: false },
    });
    expect(result.migration).toBe('none');
    expect(result.params.enableThinking).toBe(false);
    expect(readThinkingChoice(result.params)).toBe('inherit');
  });
});

describe('a migrated bag still says on the wire what the boolean said', () => {
  const full = (params: Partial<ModelParameters>) => ({
    ...DEFAULT_MODEL_PARAMETERS,
    ...params,
  });

  it('keeps sending "think" when that is what was stored', () => {
    // The flag is what makes the value explicit: dropping it lets the "same as the
    // default, so omit it" rule swallow a user's stored choice, which is exactly the
    // silent drop the ticket forbids - and the control says "still in effect".
    const { params } = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params: full({ enableThinking: true, thinking: true }),
    });
    expect(ModelParametersService.convertToChatOptions(params).thinking).toBe(
      true,
    );
  });

  it('keeps a refusal able to remove an inherited thinking value', () => {
    const { params } = migrateLegacyThinkingBoolean({
      ...OFF_CAPABLE,
      params: { enableThinking: false, thinking: false },
    });
    expect(
      dropInheritedThatSessionDisabled({ thinking: true }, params).thinking,
    ).toBeUndefined();
  });

  it('keeps "do not think" where this model has no level for it', () => {
    const { params } = migrateLegacyThinkingBoolean({
      ...NO_OFF,
      params: full({ enableThinking: true, thinking: false }),
    });
    expect(ModelParametersService.convertToChatOptions(params).thinking).toBe(
      false,
    );
  });
});
