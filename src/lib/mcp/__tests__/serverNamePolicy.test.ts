import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
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

// ---------- call-site patrol ----------
// Two review rounds in one session caught the same mistake from different sides:
// the claimed-name rename was wired into some config paths and missed in others
// (load, import dialog, merge). A partial claim check reintroduces exactly the
// connect-time surprise the mechanism exists to prevent, so the rule is
// structural, not memorable: EVERY external call that normalizes a server name
// must pass claimed names. New call sites that forget go red here.

const SRC = join(__dirname, '..', '..', '..'); // src/

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(p);
  }
  return out;
}

/** The text of the call's argument list, from its `(` to its matching `)`.
 * Naive on strings-with-parens, which no current call site has. */
function argSegment(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

describe('name-claim call-site patrol', () => {
  it('every external call that normalizes a server name passes claimed names', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      // The policy module forwards its own parameter; it must not import the
      // extension tree (boundary), so it is exempt from passing claims itself.
      if (rel === 'lib/mcp/serverNamePolicy.ts') continue;
      const src = readFileSync(file, 'utf-8');
      for (const fn of [
        'normalizeSavedServers',
        'resolveNonConflictingServerName',
      ]) {
        const re = new RegExp(`${fn}\\s*\\(`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          const args = argSegment(src, m.index + m[0].length - 1);
          if (!/claimed(Names|ExternalServerNames)/.test(args)) {
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${rel}:${line} ${fn}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
