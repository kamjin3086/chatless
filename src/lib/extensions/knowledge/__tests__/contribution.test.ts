/**
 * The knowledge pilot: the retired hand-written group expressed as a
 * contribution (plan §10 phase 2 compatibility requirements - same names,
 * same data-presence semantics, same catalog text).
 */
import { describe, expect, it } from 'vitest';
import { createKnowledgeExtension } from '../contribution';
import { buildExtensionRegistry } from '../../registry';
import { getExtensionRegistry, resetExtensionRegistry } from '../../assembly';

function fakeDeps(mounted: boolean, seen: Array<string | undefined> = []) {
  return {
    seen,
    hasConversationKnowledge: async (conversationId?: string) => {
      seen.push(conversationId);
      return mounted && conversationId !== undefined;
    },
  };
}

describe('knowledge contribution (PR B pilot)', () => {
  it('builds through the registry: risk and replaces declarations hold', () => {
    const ext = createKnowledgeExtension(fakeDeps(true));
    expect(() => buildExtensionRegistry([ext])).not.toThrow();
    const registry = buildExtensionRegistry([ext]);
    const group = registry.group('knowledge');
    expect(group?.server).toBe('knowledge');
    expect(group?.replaces).toBe('knowledge');
    expect(group?.stickyWhenLoaded).toBe(false);
    expect(registry.isSticky('knowledge')).toBe(false);
    expect(registry.isSticky('skill')).toBe(true); // unknown ids default sticky
    expect(registry.group('KNOWLEDGE')?.server).toBe('knowledge'); // normalized lookup
    expect(group?.tools.map((t) => t.definition.name).sort()).toEqual([
      'list',
      'read',
      'search',
    ]);
  });

  it('is available exactly when the conversation carries the data', async () => {
    const seen: Array<string | undefined> = [];
    const registry = buildExtensionRegistry([
      createKnowledgeExtension(fakeDeps(true, seen)),
    ]);
    expect(
      (await registry.availableGroups({ conversationId: 'c1' })).map(
        (g) => g.id,
      ),
    ).toContain('knowledge');
    expect((await registry.availableGroups({})).map((g) => g.id)).not.toContain(
      'knowledge',
    );
    expect(seen).toEqual(['c1', undefined]);

    const off = buildExtensionRegistry([
      createKnowledgeExtension(fakeDeps(false)),
    ]);
    expect(
      (await off.availableGroups({ conversationId: 'c1' })).map((g) => g.id),
    ).not.toContain('knowledge');
  });

  it('the real assembly singleton builds and exposes the knowledge group', () => {
    resetExtensionRegistry();
    const registry = getExtensionRegistry();
    expect(registry.group('knowledge')?.server).toBe('knowledge');
    resetExtensionRegistry();
  });
});
