/**
 * A document that names a file or a symbol is a promise that the reader can find it.
 *
 * `comment-symbols.mjs` keeps that promise for code comments. The same drift in the prose went
 * uncaught for a release cycle: `docs/prompt-language.md` pointed at
 * `SkillManager.buildSkillIndexPrompt`, a symbol deleted two PRs earlier; after a PR deleted a
 * whole subsystem, seven places in `docs/skills-architecture.md` still described it in the
 * present tense; an ADR still said it had not reached `main` six weeks after it had. None of
 * that is judgement, so none of it should be left to a reviewer.
 *
 * Three claims are checked in markdown. Fenced blocks are skipped - a sample is not a promise
 * about the current tree, and it is the prose around it that marks it as historical.
 *
 *   1. a repository path, e.g. `src/lib/skills/skillIndex.ts` - one of the real top-level
 *      directories, and it must exist;
 *   2. a dotted member claim, e.g. `SkillManager.buildSkillIndex` - the member must be defined
 *      in non-test code, which is what catches prose a rename left behind;
 *   3. a bare PascalCase name of a file this repository deleted, e.g. `ConfirmationManager` -
 *      allowed where the same block says it is history (`已删除`, `deleted`, `removed`,
 *      `former`, `留档`, `留档` …), including a heading above it, so a document can discuss
 *      something it removed without reading as current.
 *
 * Frozen documents are not scanned: anything dated in its filename, everything under
 * `docs/architecture/` and `docs/acceptance/`, and everything under `docs/history/` - that last
 * one is the archive, dated acceptance rounds and undated finished plans alike. Putting a
 * document there is how it stops being held to the live bar; a frozen file keeps its own
 * baseline and is not corrected when the tree moves.
 *
 * `<!-- doc-symbols:ignore -->` on a line skips that line.
 *
 *   node scripts/doc-symbols.mjs [files…]    default: tracked markdown in docs/, plus the
 *                                            root steering documents
 * Exit 0 when every promise is kept, 1 when one is not, 2 when the check could not run.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { definesSymbol } from './comment-symbols.mjs';

const SPAN = /`([^`\n]+)`/g;
const ROOTS = /^(?:src|docs|scripts|public|src-tauri|\.github|examples)\//;
const MEMBER = /^([A-Z][\w$]*)\.([a-z][\w$]{2,})(\(\))?$/;
const FILE_EXT =
  /\.(?:ts|tsx|mts|cts|mjs|cjs|js|json|md|txt|plist|log|exe|sh|py|rs|yml|yaml|css|html|wasm)$/i;
const BARE_NAME = /^[A-Z][A-Za-z0-9]{3,}$/;
const HISTORY =
  /(已删除|删掉|删除|已移除|移除|删除|历史|留档|曾经|曾|当年|作废|随 #\d+|not.*more|no longer|deprecat|historic|former|formerly|removed|deleted|went with)/i;
const ROOT_DOCS = /^(AGENTS|CLAUDE|CODING_STANDARDS|GLOSSARY|README)\.md$/;
const FROZEN =
  /(\/|^)[^/]*-20\d\d-\d\d-\d\d\.md$|^docs\/architecture\/|^docs\/acceptance\/|^docs\/history\//;

/** Which markdown files the check owns. */
export function proseFiles(files) {
  return files.filter(
    (f) =>
      (ROOT_DOCS.test(f) || (f.startsWith('docs/') && f.endsWith('.md'))) &&
      !FROZEN.test(f) &&
      !f.includes('node_modules'),
  );
}

/**
 * The claims one document makes, as `{ kind, text, line }` (line is 1-based).
 *
 * A block is the lines between blank lines, plus the nearest heading above it: "the component
 * was deleted" covers the list that follows it, which is how a document is actually written.
 */
export function docClaims(lines) {
  const claims = [];
  const blocks = [];
  let current = null;
  let heading = '';
  for (const [index, raw] of lines.entries()) {
    const line = String(raw);
    if (/^\s*(#{1,6})\s/.test(line)) heading = line;
    if (!line.trim()) {
      current = null;
      continue;
    }
    if (!current) {
      current = { heading, lines: [] };
      blocks.push(current);
    }
    current.lines.push({ text: line, line: index + 1 });
  }
  // A block is historical when it or the heading above it says so - "### 4. ConfirmationManager
  //（已删除，#237）" covers the section, and the list under "were deleted:" covers its items.
  for (const block of blocks) {
    block.historical =
      HISTORY.test(block.heading) ||
      HISTORY.test(block.lines.map((l) => l.text).join('\n'));
  }

  let fence = false;
  for (const block of blocks) {
    for (const { text: line, line: lineNumber } of block.lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        continue;
      }
      if (fence) continue;
      if (line.includes('doc-symbols:ignore')) continue;
      for (const [, tokenRaw] of line.matchAll(SPAN)) {
        const token = tokenRaw.trim();
        if (!token || token.length > 120 || /\s/.test(token)) continue;
        if (
          /^[a-z][a-z0-9+.-]*:\/\/|\/\*|<[A-Za-z]/i.test(token) ||
          token.includes('://')
        )
          continue;
        if (token.includes('*')) continue;
        if (ROOTS.test(token)) {
          claims.push({
            kind: 'path',
            text: token,
            line: lineNumber,
            historical: block.historical,
          });
        } else if (FILE_EXT.test(token)) {
          continue;
        } else if (MEMBER.test(token)) {
          claims.push({
            kind: 'member',
            text: token,
            member: MEMBER.exec(token)[2],
            line: lineNumber,
            historical: block.historical,
          });
        } else if (BARE_NAME.test(token)) {
          claims.push({
            kind: 'name',
            text: token,
            line: lineNumber,
            historical: block.historical,
          });
        }
      }
    }
  }
  return claims;
}

/**
 * Names this repository deleted - the file stems, not the paths.
 *
 * A document may mention a thing it removed, so long as it says so; this set is what makes
 * "it says so" checkable rather than hoped for. `git log` is the only honest source, and one
 * call covers the whole run.
 */
export function deletedNames(root, since) {
  const args = [
    'log',
    '--diff-filter=D',
    '--name-only',
    '--pretty=format:',
    '--no-renames',
  ];
  if (since) args.push(`--since=${since}`);
  args.push('--', 'src', 'scripts');
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    return new Set(
      out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /\.(ts|tsx|js|mjs|rs)$/.test(l))
        .map((l) => path.posix.basename(l).replace(/\.[^.]+$/, '')),
    );
  } catch {
    return new Set();
  }
}

/**
 * How many commits this checkout can see. A shallow clone cannot answer what was deleted,
 * which is a fact the check has to print rather than act like it knows.
 */
export function historyDepth(root) {
  try {
    return Number(
      execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    );
  } catch {
    return null;
  }
}

/** Every tracked file, so `src/lib/foo.ts` resolves without a stat storm. */
function trackedFiles(root) {
  try {
    return new Set(
      execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export function main(
  args,
  {
    root = process.cwd(),
    read,
    since = '2 years ago',
    write = (line) => process.stdout.write(`doc-symbols: ${line}\n`),
    resolvesMember,
    deleted,
    depth,
  } = {},
) {
  const files =
    args.length > 0
      ? proseFiles(args)
      : proseFiles(
          execFileSync('git', ['ls-files', 'docs', '.'], {
            cwd: root,
            encoding: 'utf8',
          })
            .split('\n')
            .filter((f) => f.endsWith('.md')),
        );

  const readFile =
    read ??
    ((file) => {
      try {
        return fs.readFileSync(path.join(root, file), 'utf8').split('\n');
      } catch {
        return [];
      }
    });
  // An axis that silently does nothing is worse than one that admits it: on a depth-1 checkout
  // `git log --diff-filter=D` returns nothing, which would read as "no stale names anywhere".
  // CI therefore checks this job out with `fetch-depth: 0`.
  const history = depth ?? historyDepth(root);
  const shallow = !deleted && Number.isFinite(history) && history < 2;
  const names = deleted ?? (shallow ? new Set() : deletedNames(root, since));
  if (shallow) {
    write(
      `history is ${history} commit(s) deep: the deleted-name axis is skipped (checkout needs fetch-depth: 0)`,
    );
  }
  const tracked = trackedFiles(root);
  const memberDefined =
    resolvesMember ??
    ((member) => {
      try {
        const out = execFileSync(
          'grep',
          [
            '-rh',
            '--include=*.ts',
            '--include=*.tsx',
            '--include=*.mjs',
            '--include=*.js',
            '--exclude-dir=__tests__',
            '-F',
            '--',
            member,
            'src',
            'scripts',
          ],
          { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 },
        );
        return definesSymbol(member, out);
      } catch {
        return false;
      }
    });

  const memberCache = new Map();
  let bad = 0;
  const report = (file, line, text, why) => {
    bad += 1;
    write(`${file}:${line}: ${why} \`${text}\``);
  };

  for (const file of files) {
    for (const claim of docClaims(readFile(file))) {
      if (claim.historical) continue;
      if (claim.kind === 'path') {
        const target = claim.text.replace(/\/+$/, '');
        const stat = fs.statSync(path.join(root, target), {
          throwIfNoEntry: false,
        });
        // A trailing slash states "directory"; without one, either reading is a fair claim, and
        // `put it in src/app` is as true a reference as `open src/app/layout.tsx`.
        const ok = claim.text.endsWith('/')
          ? stat?.isDirectory() === true
          : stat?.isDirectory() === true ||
            tracked.has(target) ||
            stat?.isFile() === true;
        if (!ok)
          report(
            file,
            claim.line,
            claim.text,
            'names a path that is not in the tree',
          );
      } else if (claim.kind === 'member') {
        const known =
          memberCache.get(claim.member) ?? memberDefined(claim.member);
        memberCache.set(claim.member, known);
        if (!known)
          report(
            file,
            claim.line,
            claim.text,
            'names a member no non-test code defines',
          );
      } else if (
        claim.kind === 'name' &&
        !claim.historical &&
        names.has(claim.text)
      ) {
        report(
          file,
          claim.line,
          claim.text,
          'names a deleted file without saying it is history',
        );
      }
    }
  }

  if (bad) {
    write(
      `${bad} stale document reference(s) - fix the prose, or mark it history in the same block.`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('doc-symbols.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
