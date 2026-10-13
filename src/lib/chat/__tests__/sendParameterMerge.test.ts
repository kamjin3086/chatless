import { beforeEach, describe, expect, it } from 'vitest';
import { resolveConversationParameters } from '../sendParameterMerge';
import { clearMessageScope, setMessageScope } from '../messageThinkingScope';
import { readThinkingChoice } from '../thinkingScope';

const CHAT = 'conv-1';
const OPENAI = { provider: 'openai', modelId: 'gpt-5.8' };

describe("settling a run's conversation parameters", () => {
  beforeEach(() => clearMessageScope(CHAT));

  it('leaves a conversation alone when no message choice is pending', async () => {
    const session = { enableThinkingLevel: true, thinkingLevel: 'low' };
    expect(
      await resolveConversationParameters({
        conversationId: CHAT,
        ...OPENAI,
        sessionParams: session,
      }),
    ).toEqual(session);
  });

  it('applies a pending message choice to the run it was made for', async () => {
    setMessageScope(CHAT, { enableThinkingLevel: true, thinkingLevel: 'high' });
    const first = await resolveConversationParameters({
      conversationId: CHAT,
      ...OPENAI,
      sessionParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
    });
    expect(readThinkingChoice(first)).toBe('high');
    const second = await resolveConversationParameters({
      conversationId: CHAT,
      ...OPENAI,
      sessionParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
    });
    expect(readThinkingChoice(second)).toBe('low');
  });

  it("translates a conversation's stored boolean the same way a model's is translated", async () => {
    const settled = await resolveConversationParameters({
      conversationId: CHAT,
      ...OPENAI,
      sessionParams: { enableThinking: true, thinking: false },
    });
    expect(readThinkingChoice(settled)).toBe('off');
  });

  it('has no conversation opinion at all when there was none', async () => {
    expect(
      await resolveConversationParameters({
        conversationId: CHAT,
        ...OPENAI,
        sessionParams: null,
      }),
    ).toBe(null);
  });
});

describe('a regeneration does not spend the pending one-shot', () => {
  it('leaves it for the message it was chosen for', async () => {
    setMessageScope(CHAT, { enableThinkingLevel: true, thinkingLevel: 'high' });
    const regenerated = await resolveConversationParameters({
      conversationId: CHAT,
      ...OPENAI,
      sessionParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
      applyMessageScope: false,
    });
    expect(readThinkingChoice(regenerated)).toBe('low');
    const sent = await resolveConversationParameters({
      conversationId: CHAT,
      ...OPENAI,
      sessionParams: { enableThinkingLevel: true, thinkingLevel: 'low' },
    });
    expect(readThinkingChoice(sent)).toBe('high');
  });
});
