import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deletedNames,
  historyDepth,
  docClaims,
  main,
  proseFiles,
} from '../doc-symbols.mjs';

/**
 * `comment-symbols.mjs` watches code comments; the prose was left to chance, and the chance did
 * not hold - a document pointed at `SkillManager.buildSkillIndexPrompt` two PRs after that
 * symbol was deleted, and a subsystem was described in the present tense after its own deletion
 * PR. "A document is a promise" only means something where it is checked.
 */
describe('what a document promises', () => {
  it('reads the three kinds of claim a line can make', () => {
    const claims = docClaims([
      'see `src/lib/skills/skillIndex.ts`; `SKILL.md` is a format, not a path here',
      'call `SkillManager.buildSkillIndexPrompt()` to get it',
      'the `ConfirmationManager` asked the user',
    ]);
    expect(claims).toEqual([
      {
        kind: 'path',
        text: 'src/lib/skills/skillIndex.ts',
        line: 1,
        historical: false,
      },
      {
        kind: 'member',
        text: 'SkillManager.buildSkillIndexPrompt()',
        member: 'buildSkillIndexPrompt',
        line: 2,
        historical: false,
      },
      { kind: 'name', text: 'ConfirmationManager', line: 3, historical: false },
    ]);
  });

  it('lets a heading that says 已删除 cover the section under it', () => {
    const claims = docClaims([
      '### 4. ConfirmationManager（已删除，#237）',
      '',
      'It used `ConfirmationManager` and `src/lib/gone/manager.ts`.',
      '',
      'A later paragraph of the same section names `ConfirmationRequest`.',
      '',
      '## Something else',
      '',
      '`SkillApprovalPanel` under a fresh heading says nothing.',
    ]);
    expect(claims.map((c) => `${c.text}@${c.line}:${c.historical}`)).toEqual([
      'ConfirmationManager@3:true',
      'src/lib/gone/manager.ts@3:true',
      'ConfirmationRequest@5:true',
      'SkillApprovalPanel@9:false',
    ]);
  });

  it("lets history mark its own claims, and no one else's", () => {
    // The exemption used to be per block, and a block in this repository's prose is often a whole
    // indented bullet run: one "was removed" sentence silenced every path named beside it. The
    // gate passed on `maintenance.md` while it pointed at `scripts/perf/build-frontend.log`,
    // a file that had never been committed, because the same bullet said "deleted".
    const claims = docClaims([
      '  - the old path was `src/lib/gone/old.ts`, since deleted;',
      '    a present-tense sentence beside it points at `src/lib/live/thing.ts`.',
    ]);
    expect(claims.map((c) => `${c.text}@${c.line}:${c.historical}`)).toEqual([
      'src/lib/gone/old.ts@1:true',
      'src/lib/live/thing.ts@2:false',
    ]);
  });

  it('fails a present-tense path claim that hides beside a historical line', () => {
    const written = [];
    const code = main(['docs/a.md'], {
      read: () => [
        '  - the old `src/lib/gone/old.ts` was removed;',
        '    and the new one lives in `src/lib/new/here.ts`.',
      ],
      // Both paths are missing from the tree; only the second one is a present-tense claim,
      // so only it may fail. The historical line must not vouch for its neighbour.
      deleted: new Set(),
      write: (l) => written.push(l),
    });
    expect(code).toBe(1);
    expect(written.join('\n')).toContain('docs/a.md:2');
    expect(written.join('\n')).not.toContain('docs/a.md:1');
  });

  it('reads a markdown link as the path claim it is, relative to its own document', () => {
    const claims = docClaims([
      'see [the index](src/lib/skills/skillIndex.ts), [the root readme](../README.md),',
      '[just an anchor](#notes), [the site](https://example.com/docs) and [adr](0003-x.md).',
    ]);
    expect(
      claims.map((c) => `${c.kind}:${c.text}${c.relative ? '~' : ''}`),
    ).toEqual([
      'path:src/lib/skills/skillIndex.ts~',
      'path:../README.md~',
      'path:0003-x.md~',
    ]);
  });

  it('checks a link against the directory of the document that carries it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doclink-'));
    try {
      mkdirSync(join(dir, 'docs/adr'), { recursive: true });
      mkdirSync(join(dir, 'docs/agents'), { recursive: true });
      writeFileSync(join(dir, 'docs/adr/0001-a.md'), 'here\n');
      writeFileSync(join(dir, 'docs/agents/domain.md'), 'here\n');
      const written = [];
      const code = main(['docs/adr/README.md'], {
        root: dir,
        read: () => [
          '[one](0001-a.md) is fine, [two](0002-b.md) is not.',
          '[up](../agents/domain.md) goes out and back, [dir](../agents/) states a directory.',
        ],
        deleted: new Set(),
        depth: 5,
        write: (l) => written.push(l),
      });
      expect(code).toBe(1);
      const out = written.join('\n');
      expect(out).toContain('0002-b.md');
      expect(out).not.toContain('0001-a.md');
      expect(out).not.toContain('domain.md');
      expect(out).not.toContain('../agents/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('claims a bare camelCase name only when this tree used to define it', () => {
    // Most backticked camelCase in prose is not code, so the axis asks whether the repository
    // deleted the name - the one thing that makes "this used to be a symbol" checkable.
    const claims = docClaims(
      ['`buildSkillIndexPrompt` did it, `metadata` and `localhost` did not.'],
      new Set(['buildSkillIndexPrompt']),
    );
    expect(claims.map((c) => `${c.kind}:${c.text}`)).toEqual([
      'symbol:buildSkillIndexPrompt',
    ]);
  });

  it('fails a present-tense mention of a deleted symbol, spares one marked as history', () => {
    const written = [];
    const code = main(['docs/a.md'], {
      read: (f) =>
        f === 'docs/a.md'
          ? [
              'The engine calls `buildSkillIndexPrompt` for every turn.',
              '`buildSkillIndexPrompt2` was removed in #237.',
              '  - a continuation line under that bullet, `buildSkillIndexPrompt3`, goes unblessed.',
            ]
          : [],
      members: new Set([
        'buildSkillIndexPrompt',
        'buildSkillIndexPrompt2',
        'buildSkillIndexPrompt3',
      ]),
      deleted: new Set(),
      depth: 5,
      write: (l) => written.push(l),
    });
    expect(code).toBe(1);
    const out = written.join('\n');
    expect(out).toContain('`buildSkillIndexPrompt`');
    expect(out).toContain('buildSkillIndexPrompt3');
    expect(out).not.toContain('buildSkillIndexPrompt2');
    expect(out).toContain('names a symbol this repository deleted');
  });

  it('skips fenced samples, and skips what a line marks as its own example', () => {
    const claims = docClaims([
      '```ts',
      'const m = getConfirmationManager(); // `ConfirmationManager` inside the fence',
      '```',
      'The `ConfirmationManager` was deleted; `ToolExecutionPipeline` asks now.',
      'A `RandomName` mentioned with `<!-- doc-symbols:ignore -->`.',
    ]);
    expect(claims.map((c) => `${c.kind}:${c.line}`)).toEqual([
      'name:4',
      'name:4',
    ]);
    expect(claims[0].historical).toBe(true);
  });

  it('owns the live prose and leaves date-stamped snapshots alone', () => {
    expect(
      proseFiles([
        'docs/skills-architecture.md',
        'AGENTS.md',
        'CODING_STANDARDS.md',
        'GLOSSARY.md',
        // A dated name: no such file any more, and none is needed - the rule reads the name.
        'docs/streaming-render-acceptance-2026-09-24.md',
        'docs/architecture/codebase-map-2026-10-24.md',
        // The archive is frozen by directory, dated records and undated plans alike.
        'docs/history/knowledge-chat-repair.md',
        'docs/history/agent-knowledge-acceptance-2026-09-17.md',
        'docs/acceptance/answerChecks.audit.test.ts',
        'src/lib/skills/index.ts',
      ]),
    ).toEqual([
      'docs/skills-architecture.md',
      'AGENTS.md',
      'CODING_STANDARDS.md',
      'GLOSSARY.md',
    ]);
  });

  it('reports each stale promise with the file and line that made it', () => {
    const written = [];
    const code = main(['docs/a.md'], {
      read: () => [
        '`src/lib/gone.ts` used to hold this',
        'and `SkillManager.buildSkillIndexPrompt` still says so',
        'while `ConfirmationManager` runs unremarked',
      ],
      deleted: new Set(['ConfirmationManager']),
      resolvesMember: () => false,
      write: (l) => written.push(l),
    });
    expect(code).toBe(1);
    expect(written.join('\n')).toContain('docs/a.md:1');
    expect(written.join('\n')).toContain('docs/a.md:2');
    expect(written.join('\n')).toContain('docs/a.md:3');
  });

  it('lets a historical mention through, and passes when nothing is stale', () => {
    const written = [];
    const code = main(['docs/a.md'], {
      read: () => ['`ConfirmationManager` 已删除（#237），此处留档'],
      deleted: new Set(['ConfirmationManager']),
      resolvesMember: () => true,
      write: (l) => written.push(l),
    });
    expect(code).toBe(0);
    expect(written).toEqual([]);
  });
});

it('takes a directory named without a trailing slash as a fair reference', () => {
  // `put it under src/app` is as true a claim as `open src/app/layout.tsx`; demanding the
  // slash made prose say `src/app/` like a shell, and then a reviewer's own paragraph failed.
  const claims = docClaims([
    'Every page under `src/app` is an entry point, see `src/app/layout.tsx`.',
  ]);
  expect(claims.filter((c) => c.kind === 'path').map((c) => c.text)).toEqual([
    'src/app',
    'src/app/layout.tsx',
  ]);
});

describe('the deleted-name set', () => {
  it('comes from what the repository deleted, not from a list someone maintains', () => {
    const names = deletedNames(process.cwd(), '2 years ago');
    // A shallow checkout (CI before this file's fetch-depth: 0) legitimately sees one commit
    // and no deletions; the depth guard is what keeps this honest instead of environment-fragile.
    if (historyDepth(process.cwd()) > 1) expect(names.size).toBeGreaterThan(0);
    expect(names instanceof Set).toBe(true);
  });

  it('admits when the history is too shallow to know what was deleted', () => {
    // An axis that silently does nothing reads as "clean". A depth-1 CI clone was exactly this
    // until the checkout was fixed, and the test that caught it asserted on live history instead.
    const written = [];
    const code = main([], {
      root: process.cwd(),
      depth: 1,
      write: (l) => written.push(l),
    });
    expect(code).toBe(0);
    expect(written.join('\n')).toContain('deleted-name axis is skipped');
  });
});
