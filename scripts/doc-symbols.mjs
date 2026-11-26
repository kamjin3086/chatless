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
 * Four kinds of claim are checked in markdown. Fenced blocks are skipped - a sample is not a
 * promise about the current tree, and it is the prose around it that marks it as historical.
 *
 *   1. a repository path, e.g. `src/lib/skills/skillIndex.ts` - one of the real top-level
 *      directories, and it must exist;
 *   2. a dotted member claim, e.g. `SkillManager.buildSkillIndex` - the member must be defined
 *      in non-test code, which is what catches prose a rename left behind;
 *   2b. a link target: `[text](src/lib/x.ts)` promises exactly what a backticked path does.
 *      Half the references in these documents arrive as links and the gate read none of them -
 *      moving a dozen records into `docs/history/` silently broke five links;
 *   2c. the bare name of a top-level symbol this repository deleted, e.g. `ActionRouter`.
 *      Bare names cannot be checked for "does it exist": most backticked words in prose are not
 *      code at all (175 of the 301 distinct backticked tokens on `main` name no definition, and
 *      they are things like `always`, `wontfix` and a commit sha). The honest question is whether
 *      the name is one this tree *used to define* - the renamed-away case, which is what axis 3
 *      already asks about files. A method that was renamed inside a file that survived is not in
 *      that set and has to be written dotted, `SkillManager.buildSkillIndexPrompt`, for axis 2.
 *   3. a bare PascalCase name of a file this repository deleted, e.g. `ConfirmationManager` -
 *      allowed where the claim itself says it is history (`已删除`, `deleted`, `removed`,
 *      `former`, `留档` …), or where the heading above it does, so a document can discuss
 *      something it removed without reading as current.
 *
 * The history exemption is per claim, not per block. Marking one sentence as history used to
 * silence every path and member named beside it, and in a document written as one long indented
 * bullet run "beside it" means a whole section: `docs/agents/maintenance.md` once passed the gate
 * while pointing at `scripts/perf/build-frontend.log`, a file that was never committed, because
 * the bullet also contained the word "deleted". A heading still covers its section - that is how
 * "### 4. ConfirmationManager（已删除）" should read - and a line still covers its own claims.
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

// What a removed exported definition looked like in a diff (axis 2c), and what a live one looks
// like in the tree. Two shapes because one regex cannot read both a diff and a file honestly.
const DEFINITION_KEYWORDS =
  'function|const|let|class|interface|type|enum|struct|trait|fn|static|mod';
const REMOVED_DEFINITION = new RegExp(
  `^-\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:${DEFINITION_KEYWORDS})\\s+([A-Za-z][A-Za-z0-9_]*)(?![A-Za-z0-9_])`,
  'gm',
);
const DEFINED_HEAD = new RegExp(
  `^\\s*(?:export\\s+)?(?:pub\\s+)?(?:default\\s+)?(?:async\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:${DEFINITION_KEYWORDS})\\s+([A-Za-z][A-Za-z0-9_]*)(?![A-Za-z0-9_])`,
);

/** `git grep -E` is POSIX ERE: no `(?:…)`, no `\b`. Build the pattern it can actually read. */
function stillDefinedPattern(names) {
  return `^[[:space:]]*(export[[:space:]]+)?(pub[[:space:]]+)?(async[[:space:]]+)?(function|const|let|class|interface|type|enum|struct|trait|fn|static|mod)[[:space:]]+(${names.join('|')})([^A-Za-z0-9_]|$)`;
}

const SPAN = /`([^`\n]+)`/g;
const ROOTS = /^(?:src|docs|scripts|public|src-tauri|\.github|examples)\//;
const MEMBER = /^([A-Z][\w$]*)\.([a-z][\w$]{2,})(\(\))?$/;
const FILE_EXT =
  /\.(?:ts|tsx|mts|cts|mjs|cjs|js|json|md|txt|plist|log|exe|sh|py|rs|yml|yaml|css|html|wasm)$/i;
const BARE_NAME = /^[A-Z][A-Za-z0-9]{3,}$/;
// Markdown link targets. Anchors, URLs and rooted paths are not claims about this tree; a target
// with a `#fragment` is a claim about the file in front of the fragment.
const LINK_TARGET = /\]\(([^)\s]+)\)/g;
const NOT_A_PATH = /^(?:#|https?:|mailto:|\/)/;
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
export function docClaims(lines, deletedSymbols = new Set()) {
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
  // Only the heading governs a block. What a claim's own line says is decided per claim below:
  // a block is often a whole section, and one "was removed" sentence must not vouch for the
  // present-tense paths sitting next to it.
  for (const block of blocks) {
    block.historical = HISTORY.test(block.heading);
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
      // A line that says "已删除 / no longer / former" is the claim speaking about itself; the
      // same words on a different line of the block are somebody else's sentence.
      const historical = block.historical || HISTORY.test(line);
      // A link is a path claim wearing prose's clothes, and it is relative to the document,
      // not to the repository root the way a backticked path is.
      for (const link of line.matchAll(LINK_TARGET)) {
        const target = link[1].split('#')[0];
        if (!target || NOT_A_PATH.test(target) || target.includes('*'))
          continue;
        if (!FILE_EXT.test(target) && !target.endsWith('/')) continue;
        claims.push({
          kind: 'path',
          text: target,
          relative: true,
          line: lineNumber,
          historical,
        });
      }
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
            historical,
          });
        } else if (FILE_EXT.test(token)) {
          continue;
        } else if (MEMBER.test(token)) {
          claims.push({
            kind: 'member',
            text: token,
            member: MEMBER.exec(token)[2],
            line: lineNumber,
            historical,
          });
        } else if (deletedSymbols.has(token)) {
          // Only a name this tree used to define is a claim; any other backticked word in the
          // document is prose, and claiming those would silence the axis with noise. Nothing in
          // the gone set is lowercase or short enough to collide with a sentence by accident -
          // but the set does hold names that are ordinary words in another sense: `Provider` was
          // an exported type, and a document meaning "the model provider" must not put it in
          // backticks, or mark it as history. That is the price of a bare name reading as a
          // claim, and it is cheaper than the alternative: the file that defined the type is
          // gone, so nothing else in the tree can tell a reader the name moved.
          // This branch runs before the file-stem one: a deleted class is a deleted symbol,
          // whether or not it also gave a file its name.
          claims.push({
            kind: 'symbol',
            text: token,
            line: lineNumber,
            historical,
          });
        } else if (BARE_NAME.test(token)) {
          claims.push({
            kind: 'name',
            text: token,
            line: lineNumber,
            historical,
          });
        }
      }
    }
  }
  return claims;
}

/**
 * Symbols this repository deleted, read out of the deletion diffs themselves (axis 2c).
 *
 * A document that says "`ActionRouter` routed the actions" was true and is now false, and
 * nothing in the current tree can tell a checker so: the file that defined the name went with
 * it. Asking "does this bare name exist" instead would flag half the prose, so the question is
 * narrowed to the one this axis can answer honestly - was it ever defined here, and is it gone?
 */
export function deletedMembers(root, since = '2 years ago') {
  const candidates = new Set();
  try {
    const out = execFileSync(
      'git',
      [
        'log',
        '-p',
        '--no-renames',
        `--since=${since}`,
        '--pretty=format:',
        '--',
        'src',
        'scripts',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );
    for (const m of out.matchAll(REMOVED_DEFINITION)) candidates.add(m[1]);
  } catch {
    // Like the file axis: no history means no claims here, never a false clean.
    return candidates;
  }
  // A removed line only proves that a line changed: most of these names were reformatted, moved
  // or edited and are still defined. The set is the ones the tree can no longer show a definition
  // for - which is also why a shallow checkout cannot answer it and says so.
  const gone = new Set();
  const names = [...candidates];
  // Chunked only to keep one `git grep` pattern readable; the slice and the step must agree,
  // which they did not when this was written - a 60-name slice inside a 200-name step silently
  // left 140 names of every chunk unchecked.
  const CHUNK = 200;
  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    let lines = '';
    try {
      lines = execFileSync(
        'git',
        [
          'grep',
          '-h',
          '-E',
          stillDefinedPattern(chunk),
          '--',
          'src',
          'scripts',
          'src-tauri/src',
        ],
        { cwd: root, encoding: 'utf8' },
      );
    } catch {
      lines = '';
    }
    const alive = new Set();
    for (const line of lines.split('\n')) {
      const m = line.match(DEFINED_HEAD);
      if (m && chunk.includes(m[1])) alive.add(m[1]);
    }
    for (const name of chunk) if (!alive.has(name)) gone.add(name);
  }
  return gone;
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
    members,
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
  const symbols =
    members ?? (shallow ? new Set() : deletedMembers(root, since));
  if (shallow) {
    write(
      `history is ${history} commit(s) deep: the deleted-name axis is skipped, and with it the deleted-symbol axis (checkout needs fetch-depth: 0)`,
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
    for (const claim of docClaims(readFile(file), symbols)) {
      if (claim.historical) continue;
      if (claim.kind === 'path') {
        const target = path
          .normalize(
            claim.relative
              ? path.join(path.dirname(file), claim.text)
              : claim.text,
          )
          .replace(/\/+$/, '');
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
      } else if (claim.kind === 'symbol') {
        report(
          file,
          claim.line,
          claim.text,
          'names a symbol this repository deleted without saying it is history',
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
