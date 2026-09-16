import { beforeEach, describe, expect, it } from 'vitest';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';

describe('tool loading scope', () => {
  beforeEach(() => {
    useToolLoadRequestStore.getState().reset('conversation-a');
    useToolLoadRequestStore.getState().reset('conversation-b');
  });

  it('keeps requested groups isolated per conversation', () => {
    const store = useToolLoadRequestStore.getState();
    store.requestLoad('skill', 'conversation-a');

    expect(store.getPendingRequests('conversation-a')).toEqual(['skill']);
    expect(store.getPendingRequests('conversation-b')).toEqual([]);
  });

  it('does not expose a group from one session after switching the active session', () => {
    const store = useToolLoadRequestStore.getState();
    store.requestLoad('knowledge', 'conversation-a');
    store.markLoaded(['knowledge'], 'conversation-a');
    store.reset('conversation-b');

    expect(useToolLoadRequestStore.getState().loadedGroups).toEqual(['core']);
    expect(store.getPendingRequests('conversation-a')).toEqual([]);
    expect(store.getPendingRequests('conversation-b')).toEqual([]);
  });
});
