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

/** The call's argument list, from its `(` to its matching `)`.
 * Quoted strings (', ", `) are skipped when counting depth, so parens inside
 * literals do not shift the boundary; a depth that never returns to zero
 * throws instead of silently swallowing the rest of the file (a silently
 * huge segment would let any later "claimed" text mask a missing argument).
 * Regex literals are unquoted parens in principle; no current call site
 * passes one, and a new one hits the throw, not a silent pass. */
function argSegment(src: string, openIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error(`unbalanced parens in call segment at offset ${openIdx}`);
}

describe('name-claim call-site patrol', () => {
  it('every external call that normalizes a server name passes claimed names', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      // The policy module is exempt wholesale: it defines the two functions
      // (the generic definition matches the call regex too, so exemption is
      // by file, not by pattern) and forwards its own claimedNames parameter
      // without importing the extension tree (boundary rule). Test fixtures
      // elsewhere under __tests__ are deliberately in scope - a fixture that
      // normalized a server name without claims is a real finding.
      if (rel === 'lib/mcp/serverNamePolicy.ts') continue;
      const src = readFileSync(file, 'utf-8');
      // Imported aliases (normalizeSavedServers as normSaved) must not
      // bypass the patrol.
      const fns = [
        'normalizeSavedServers',
        'resolveNonConflictingServerName',
        ...[
          ...src.matchAll(
            /\b(?:normalizeSavedServers|resolveNonConflictingServerName)\s+as\s+(\w+)/g,
          ),
        ].map((m) => m[1]),
      ];
      for (const fn of fns) {
        // One level of nesting tolerated in the generic argument: the load
        // path calls normalizeSavedServers<Saved>(...) and a plain `fn\s*(`
        // regex would make all three load callsites invisible.
        const re = new RegExp(
          `${fn}\\s*(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?\\s*\\(`,
          'g',
        );
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          const args = argSegment(src, m.index + m[0].length - 1);
          // The actual supplier, not any "claimed" token: `claimedNames: []`
          // or a comment alone must not satisfy the patrol.
          if (!/claimedExternalServerNames\s*\(\s*\)/.test(args)) {
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${rel}:${line} ${fn}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
