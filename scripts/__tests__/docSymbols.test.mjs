import { describe, expect, it } from 'vitest';
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
        'docs/streaming-render-acceptance-2026-09-24.md',
        'docs/architecture/codebase-map-2026-10-24.md',
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
