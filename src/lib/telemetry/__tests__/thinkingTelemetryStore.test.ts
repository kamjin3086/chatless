import type { ThinkingTurnRecord } from '@/lib/llm/thinkingTelemetry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
// The mock closes over this, so a test can make writing fail without reaching into the
// module object, whose bindings are read-only.
let poisonDisk = false;
// The real store is an async read that may still be in flight when the second
// completion of a burst lands.
let slowRead = false;

vi.mock('@/lib/storage', () => ({
  StorageUtil: {
    getItem: (key: string, fallback: unknown) => {
      // Snapshot when asked, answer later: that is what an in-flight read means.
      const snapshot = store.has(key) ? store.get(key) : fallback;
      return slowRead
        ? new Promise((resolve) => setTimeout(() => resolve(snapshot), 20))
        : Promise.resolve(snapshot);
    },
    setItem: (key: string, value: unknown) => {
      if (poisonDisk) return Promise.reject(new Error('disk gone'));
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([]),
  },
}));

function turn(over: Partial<ThinkingTurnRecord> = {}): ThinkingTurnRecord {
  return {
    at: 1_700_000_000_000,
    provider: 'openai',
    model: 'gpt-5.8',
    level: 'low',
    sent: true,
    carrier: 'reasoning_effort',
    durationMs: 1000,
    usageReported: true,
    completionTokens: 100,
    ...over,
  };
}

async function load() {
  return await import('../thinkingTelemetryStore');
}

describe('the thinking turn store', () => {
  beforeEach(() => {
    store.clear();
    poisonDisk = false;
    slowRead = false;
  });

  it('reads back what was recorded, oldest first', async () => {
    const t = await load();
    t.resetThinkingTurnsForTests();
    await t.recordThinkingTurn(turn({ messageId: 'm1' }));
    await t.recordThinkingTurn(turn({ messageId: 'm2', durationMs: 2000 }));
    const turns = await t.readThinkingTurns();
    expect(turns.map((x) => x.messageId)).toEqual(['m1', 'm2']);
  });

  it('finds the turn behind one message, which is what a message footer needs', async () => {
    const t = await load();
    t.resetThinkingTurnsForTests();
    await t.recordThinkingTurn(turn({ messageId: 'm1' }));
    expect((await t.getTurnForMessage('m1'))?.messageId).toBe('m1');
    expect(await t.getTurnForMessage('nobody')).toBe(null);
  });

  it('keeps only the recent window, because "recent turns" is the promise', async () => {
    const t = await load();
    t.resetThinkingTurnsForTests();
    for (let i = 0; i < t.THINKING_TURN_HISTORY + 20; i += 1) {
      await t.recordThinkingTurn(turn({ messageId: `m${i}` }));
    }
    const turns = await t.readThinkingTurns();
    expect(turns.length).toBe(t.THINKING_TURN_HISTORY);
    expect(turns[turns.length - 1].messageId).toBe(
      `m${t.THINKING_TURN_HISTORY + 19}`,
    );
  });

  it('survives a restart, since the aggregate spans conversations and sessions', async () => {
    const first = await load();
    first.resetThinkingTurnsForTests();
    await first.recordThinkingTurn(turn({ messageId: 'kept' }));
    expect([...store.values()].flat()).toHaveLength(1);

    vi.resetModules();
    const again = await load();
    expect((await again.readThinkingTurns()).map((x) => x.messageId)).toEqual([
      'kept',
    ]);
  });

  it('wakes a listener on a new turn and stops when unsubscribed', async () => {
    const t = await load();
    t.resetThinkingTurnsForTests();
    const seen: number[] = [];
    const off = t.subscribeThinkingTurns((next) => seen.push(next.length));
    await t.recordThinkingTurn(turn({ messageId: 'a' }));
    expect(seen).toEqual([1]);
    off();
    await t.recordThinkingTurn(turn({ messageId: 'b' }));
    expect(seen).toEqual([1]);
  });

  it('still works when storage is unreachable', async () => {
    // The app must keep answering even when nothing can be written: telemetry is not
    // allowed to become the reason a reply fails.
    const t = await load();
    t.resetThinkingTurnsForTests();
    poisonDisk = true;
    await expect(
      t.recordThinkingTurn(turn({ messageId: 'still-here' })),
    ).resolves.toMatchObject({ messageId: 'still-here' });
    expect(await t.readThinkingTurns()).toHaveLength(1);
    poisonDisk = false;
  });

  it('keeps a burst of completions that arrive while the first read is still running', async () => {
    // Every entry point awaits the load, so a completion landing mid-read must not be erased
    // by the array that read brings back - losing turns loses the whole point of the store.
    slowRead = true;
    const t = await load();
    t.resetThinkingTurnsForTests();
    await t.recordThinkingTurn(turn({ messageId: 'on-disk' }));
    // Like a restart: the file holds history, memory does not, and the read answers from a
    // snapshot taken before the completions below arrive.
    t.resetThinkingTurnsForTests();
    slowRead = true;
    const first = t.recordThinkingTurn(turn({ messageId: 'burst-1' }));
    await t.recordThinkingTurn(turn({ messageId: 'burst-2' }));
    await first;
    const ids = (await t.readThinkingTurns()).map((x) => x.messageId);
    expect(ids).toEqual(
      expect.arrayContaining(['on-disk', 'burst-1', 'burst-2']),
    );
  });

  it('folds the rounds of one answer into one record', async () => {
    // An agent-loop reply is several requests under one message id: the store must show the
    // answer's total, and the aggregate must not count one answer as two turns.
    const t = await load();
    t.resetThinkingTurnsForTests();
    await t.recordThinkingTurn(
      turn({ messageId: 'answer-1', durationMs: 3000 }),
    );
    await t.recordThinkingTurn(
      turn({ messageId: 'answer-1', durationMs: 2000 }),
    );
    const all = await t.readThinkingTurns();
    expect(all).toHaveLength(1);
    expect(all[0].durationMs).toBe(5000);
    expect(await t.readThinkingTurns()).toHaveLength(1);
  });

  it('lets every listener see a turn even when one of them throws', async () => {
    // A view that breaks on its own rendering must not take the other views, or the reply,
    // down with it.
    const t = await load();
    t.resetThinkingTurnsForTests();
    const seen: number[] = [];
    const offBad = t.subscribeThinkingTurns(() => {
      throw new Error('this view is broken');
    });
    const offGood = t.subscribeThinkingTurns((list) => seen.push(list.length));
    await t.recordThinkingTurn(turn({ messageId: 'after-a-broken-view' }));
    expect(seen).toEqual([1]);
    offBad();
    offGood();
  });

  it('finds a turn that lands after the first look came back empty', async () => {
    // A completed reply is recorded after its message component mounted; a lookup that only
    // worked before the record landed would leave every fresh answer without a report.
    const t = await load();
    t.resetThinkingTurnsForTests();
    expect(await t.getTurnForMessage('late-message')).toBeNull();
    await t.recordThinkingTurn(turn({ messageId: 'late-message' }));
    expect((await t.getTurnForMessage('late-message'))?.messageId).toBe(
      'late-message',
    );
  });
});
