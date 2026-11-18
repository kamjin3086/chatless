import { beforeEach, expect, it, vi } from 'vitest';
import { useKnowledgeBaseSelection } from '../useKnowledgeBaseSelection';

// A deterministic effect scheduler exercises the real hook without a DOM or a
// new test dependency. It retains state, compares deps and runs effect cleanup.
const harness = vi.hoisted(() => ({
  cells: [] as Array<{
    value?: unknown;
    deps?: unknown[];
    cleanup?: () => void;
  }>,
  cursor: 0,
  dirty: false,
  pending: [] as Array<() => void>,
  mounts: {} as Record<string, { id: string; name: string } | undefined>,
  load: vi.fn(),
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    harness.cells[index] ??= { value: initial };
    return [
      harness.cells[index].value,
      (next: unknown) => {
        if (!Object.is(harness.cells[index].value, next)) {
          harness.cells[index].value = next;
          harness.dirty = true;
        }
      },
    ];
  },
  useRef: (value: unknown) => {
    const index = harness.cursor++;
    harness.cells[index] ??= { value: { current: value } };
    return harness.cells[index].value;
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = harness.cursor++;
    const cell = (harness.cells[index] ??= {});
    if (!cell.deps || deps.some((dep, i) => !Object.is(dep, cell.deps?.[i]))) {
      cell.deps = deps;
      harness.pending.push(() => {
        cell.cleanup?.();
        cell.cleanup = effect();
      });
    }
  },
}));
vi.mock('@/lib/knowledgeService', () => ({
  KnowledgeService: { getKnowledgeBase: harness.load },
}));
vi.mock('@/store/conversationAttachmentStore', () => {
  const state = {
    knowledgeBaseByConversation: harness.mounts,
    setKnowledgeBase: (id: string, kb: { id: string; name: string }) => {
      harness.mounts[id] = kb;
      harness.dirty = true;
    },
    clearKnowledgeBase: (id: string) => {
      delete harness.mounts[id];
      harness.dirty = true;
    },
  };
  return {
    useConversationAttachmentStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

beforeEach(() => {
  harness.cells = [];
  harness.pending = [];
  harness.cursor = 0;
  harness.dirty = false;
  for (const id of Object.keys(harness.mounts)) delete harness.mounts[id];
  harness.load
    .mockReset()
    .mockImplementation(async (id: string) => ({ id, name: id }));
});

function setup(
  initial: Partial<Parameters<typeof useKnowledgeBaseSelection>[0]> = {},
) {
  const props: Parameters<typeof useKnowledgeBaseSelection>[0] = {
    conversationId: 'a',
    consumeDeepLink: vi.fn(),
    ...initial,
  };
  let result: ReturnType<typeof useKnowledgeBaseSelection>;
  function render() {
    harness.cursor = 0;
    harness.dirty = false;
    result = useKnowledgeBaseSelection(props);
    for (const run of harness.pending.splice(0)) run();
  }
  async function flush() {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      if (harness.dirty) render();
    }
    return result;
  }
  render();
  return { props, render, flush };
}

it('consumes a deep link once and preserves a different conversation mount even before the URL updates', async () => {
  harness.mounts.b = { id: 'kb-b', name: 'kb-b' };
  const ui = setup({ deepLinkId: 'kb-a' });
  await ui.flush();
  expect(harness.mounts.a?.id).toBe('kb-a');
  ui.props.conversationId = 'b';
  ui.render();
  expect((await ui.flush()).selectedKnowledgeBase?.id).toBe('kb-b');
  expect(harness.mounts.b?.id).toBe('kb-b');
  expect(ui.props.consumeDeepLink).toHaveBeenCalledTimes(1);
});

it('does not attach the old deep link to a new empty conversation', async () => {
  const ui = setup({ deepLinkId: 'kb-a' });
  await ui.flush();
  ui.props.conversationId = 'new';
  ui.render();
  expect((await ui.flush()).selectedKnowledgeBase).toBeNull();
  expect(harness.mounts.new).toBeUndefined();
});

it('waits for the URL destination instead of mounting into the previously active chat', async () => {
  const ui = setup({ deepLinkId: 'kb-b', deepLinkConversationId: 'b' });
  await ui.flush();
  expect(harness.mounts.a).toBeUndefined();
  expect(ui.props.consumeDeepLink).not.toHaveBeenCalled();
  ui.props.conversationId = 'b';
  ui.render();
  await ui.flush();
  expect(harness.mounts.b?.id).toBe('kb-b');
});

it('keeps an unsent draft selection after consuming the URL', async () => {
  const ui = setup({ conversationId: null, deepLinkId: 'kb-a' });
  await ui.flush();
  ui.props.deepLinkId = undefined;
  ui.render();
  expect((await ui.flush()).selectedKnowledgeBase?.id).toBe('kb-a');
});

it('cancels a slow lookup after switching conversations', async () => {
  let resolve!: (kb: { id: string; name: string }) => void;
  harness.load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const ui = setup({ deepLinkId: 'kb-a' });
  await ui.flush();
  ui.props.conversationId = 'b';
  ui.render();
  await ui.flush();
  resolve({ id: 'kb-a', name: 'kb-a' });
  expect((await ui.flush()).selectedKnowledgeBase).toBeNull();
  expect(harness.mounts.b).toBeUndefined();
});

it('removal and manual replacement take precedence over a pending deep link', async () => {
  const ui = setup({ deepLinkId: 'kb-a' });
  const selected = await ui.flush();
  selected.selectKnowledgeBase({
    id: 'kb-b',
    name: 'kb-b',
    description: '',
    icon: 'database',
    isEncrypted: false,
    createdAt: 0,
    updatedAt: 0,
  });
  expect((await ui.flush()).selectedKnowledgeBase?.id).toBe('kb-b');
  (await ui.flush()).removeSelectedKnowledgeBase();
  expect((await ui.flush()).selectedKnowledgeBase).toBeNull();
  expect(harness.mounts.a).toBeUndefined();
});

it('accepts a new explicit destination using the same library ID', async () => {
  const ui = setup({ deepLinkId: 'kb', deepLinkConversationId: 'a' });
  await ui.flush();
  ui.props.deepLinkConversationId = 'b';
  ui.render();
  await ui.flush();
  expect(harness.mounts.b).toBeUndefined();
  ui.props.conversationId = 'b';
  ui.render();
  await ui.flush();
  expect(harness.mounts.b?.id).toBe('kb');
});

it('defers a cold-start deep link until conversation loading has finished', async () => {
  const ui = setup({ conversationId: null, deepLinkId: 'kb-a', ready: false });
  await ui.flush();
  expect(ui.props.consumeDeepLink).not.toHaveBeenCalled();
  ui.props.conversationId = 'a';
  ui.props.ready = true;
  ui.render();
  await ui.flush();
  expect(harness.mounts.a?.id).toBe('kb-a');
});

it('does not let a delayed deep-link lookup overwrite a manual replacement', async () => {
  let resolve!: (kb: { id: string; name: string }) => void;
  harness.load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const ui = setup({ deepLinkId: 'kb-a' });
  const selected = await ui.flush();
  selected.selectKnowledgeBase({
    id: 'kb-b',
    name: 'kb-b',
    description: '',
    icon: 'database',
    isEncrypted: false,
    createdAt: 0,
    updatedAt: 0,
  });
  await ui.flush();
  resolve({ id: 'kb-a', name: 'kb-a' });
  expect((await ui.flush()).selectedKnowledgeBase?.id).toBe('kb-b');
  expect(harness.mounts.a?.id).toBe('kb-b');
});

it('clears a deleted library when restoring its persisted mount', async () => {
  harness.mounts.a = { id: 'deleted', name: 'deleted' };
  harness.load.mockResolvedValueOnce(null);
  const ui = setup();
  expect((await ui.flush()).selectedKnowledgeBase).toBeNull();
  expect(harness.mounts.a).toBeUndefined();
});
