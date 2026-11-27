/**
 * PR B compatibility premise (review S2): knowledge tools reach the model
 * exactly once per step, exactly when the conversation carries the data.
 * The OLD hand-written block got this right by merging detected+pending in a
 * Set; the retired TOOL_GROUPS entry must not leave a second source behind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { resetExtensionRegistry } from '@/lib/extensions/assembly';

const mount = vi.hoisted(() => ({ kb: false, rows: '0' }));

vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: {
    getState: () => ({
      getKnowledgeBase: () => (mount.kb ? { id: 'kb1' } : undefined),
    }),
  },
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({ select: async () => [{ n: mount.rows }] }),
    }),
  },
}));

import { buildNativeToolDefinitions } from '../promptBuilder';

async function toolNames(conversationId: string): Promise<string[]> {
  const tools = await buildNativeToolDefinitions({
    servers: [],
    includeWebSearch: true,
    conversationId,
  } as any);
  return tools.map((t) => t.name);
}

describe('native tool assembly with the knowledge contribution (PR B)', () => {
  beforeEach(() => {
    mount.kb = false;
    mount.rows = '0';
    useToolLoadRequestStore.getState().reset('c1');
    resetExtensionRegistry();
  });

  it('injects knowledge__* exactly once iff the conversation carries data', async () => {
    let names = await toolNames('c1');
    expect(names).toContain('tools__search'); // core + discovery intact
    expect(names.filter((n) => n === 'knowledge__search')).toHaveLength(0);

    mount.kb = true;
    names = await toolNames('c1');
    expect(names.filter((n) => n === 'knowledge__search')).toHaveLength(1);

    // A prior discovery hit (pending) plus a live mount must still yield one.
    useToolLoadRequestStore.getState().requestLoad('knowledge', 'c1');
    names = await toolNames('c1');
    expect(names.filter((n) => n === 'knowledge__search')).toHaveLength(1);

    // Revoked mount: history only decides disclosure of STILL-AVAILABLE
    // capabilities (review P0-2) - the pending request from the step above
    // must not re-inject tools whose data is gone. No store reset here:
    // the pending record is still in the store, and it is deliberately not
    // enough (this is the behavior change the external review asked for,
    // overriding the pre-migration sticky-pending leak).
    mount.kb = false;
    names = await toolNames('c1');
    expect(names.filter((n) => n === 'knowledge__search')).toHaveLength(0);
  });

  it('document mappings alone also mount the capability (same SQL semantics)', async () => {
    mount.rows = '2';
    const names = await toolNames('c1');
    expect(names.filter((n) => n === 'knowledge__read')).toHaveLength(1);
  });

  it('prompt tools are discover-then-load: absent until hit, then sticky (no predicate)', async () => {
    // A predicate-less contribution group is never auto-detected - a fresh
    // conversation must NOT get the six system__ tools just because the
    // group is constantly available (regression pinned by review round 2:
    // treating "available" as "detected" injected them into every request).
    const fresh = await toolNames('c1');
    expect(fresh.filter((n) => n.startsWith('system__'))).toHaveLength(0);

    useToolLoadRequestStore.getState().requestLoad('prompt', 'c1');
    const names = await toolNames('c1');
    expect(names.filter((n) => n.startsWith('system__'))).toHaveLength(6);
    // Second step: pending is consumed as sticky-loaded, injection survives.
    const again = await toolNames('c1');
    expect(again.filter((n) => n.startsWith('system__'))).toHaveLength(6);
  });
});
