import { describe, expect, it } from 'vitest';
import { planEmptyConversationReuse } from '../emptyConversationReuse';

describe('blank conversation reuse', () => {
  it('keeps a single blank conversation, newest first', () => {
    const plan = planEmptyConversationReuse({
      conversationIds: ['newest', 'older', 'has-messages'],
      withoutMessages: ['newest', 'older'],
    });
    expect(plan.reuse).toBe('newest');
    expect(plan.remove).toEqual(['older']);
  });

  it('creates a new conversation when every conversation has messages', () => {
    const plan = planEmptyConversationReuse({
      conversationIds: ['a', 'b'],
      withoutMessages: [],
    });
    expect(plan.reuse).toBeUndefined();
    expect(plan.remove).toEqual([]);
  });

  it('never deletes a blank conversation that holds an unsent draft', () => {
    const plan = planEmptyConversationReuse({
      conversationIds: ['kept', 'drafted', 'other'],
      withoutMessages: ['kept', 'drafted', 'other'],
      drafts: { drafted: '还没发出去的一段话' },
    });
    expect(plan.reuse).toBe('kept');
    expect(plan.remove).toEqual(['other']);
  });

  it('treats whitespace-only drafts as empty', () => {
    const plan = planEmptyConversationReuse({
      conversationIds: ['kept', 'blank-draft'],
      withoutMessages: ['kept', 'blank-draft'],
      drafts: { 'blank-draft': '   \n ' },
    });
    expect(plan.remove).toEqual(['blank-draft']);
  });

  it('ignores ids the store does not know about', () => {
    // The database may still mention a conversation that was removed locally.
    const plan = planEmptyConversationReuse({
      conversationIds: ['only'],
      withoutMessages: ['only', 'ghost'],
    });
    expect(plan.reuse).toBe('only');
    expect(plan.remove).toEqual([]);
  });
});
