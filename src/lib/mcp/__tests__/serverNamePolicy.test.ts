import { describe, expect, it } from 'vitest';
import {
  normalizeSavedServers,
  resolveNonConflictingServerName,
} from '../serverNamePolicy';

describe('server name claims at config time', () => {
  it('claimed names rename exactly like reserved ones', () => {
    const r = resolveNonConflictingServerName({
      desiredName: 'system',
      existingNames: [],
      claimedNames: ['system'],
    });
    expect(r.name).toBe('system_external');
    expect(r.renames[0]).toMatchObject({ reason: 'reserved' });
  });

  it('the canonical spelling claims the raw spelling too (web === web_search)', () => {
    // The caller passes both spellings (assembly.claimedExternalServerNames);
    // a config saved as `web` must rename when the contribution's canonical
    // name web_search owns the slot.
    const r = resolveNonConflictingServerName({
      desiredName: 'web',
      existingNames: [],
      claimedNames: ['web', 'web_search'],
    });
    expect(r.name).toBe('web_external');
  });

  it('unclaimed names pass through untouched', () => {
    const r = resolveNonConflictingServerName({
      desiredName: 'research-mcp',
      existingNames: [],
      claimedNames: ['system', 'web', 'web_search', 'knowledge'],
    });
    expect(r.name).toBe('research-mcp');
    expect(r.renames).toHaveLength(0);
  });

  it('normalizeSavedServers carries claims through the load path', () => {
    const { list, renames } = normalizeSavedServers(
      [{ name: 'web' }, { name: 'papers' }],
      ['web', 'web_search'],
    );
    expect(list.map((s) => s.name)).toEqual(['web_external', 'papers']);
    expect(renames).toHaveLength(1);
  });
});
