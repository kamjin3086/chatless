#!/usr/bin/env node
/**
 * A comment that names a symbol is a promise that the symbol exists.
 *
 * Two review rounds in a row caught this class by hand, and the worst instance told a reader
 * to "call `normalizeModelParameters` when a complete bag is needed" (comment-symbols:ignore)
 * - the function had been
 * deleted in the same PR that wrote the sentence. That is not judgement, so it should not be
 * left to a reviewer: a camelCase name in a comment either resolves somewhere or it is stale.
 *
 * Scoped deliberately narrow, because a check with false positives gets disabled: only
 * backticked, lowerCamelCase names of 10+ characters with at least two inner capitals, in
 * comment lines of code files (`.ts/.tsx/.mjs/.js/.cjs/.cts/.mts`) - prose files are not
 * scanned, so the claim is about code comments only. A name resolves when non-test code in
 * `src` or `scripts` mentions it outside a comment; prose words and single-word identifiers
 * are not claims about the code.
 *
 *   node scripts/comment-symbols.mjs [files…]   default: tracked files under src/docs/scripts
 * Exit 0 when every promise is kept, 1 when one is not, 2 when the check could not run.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const NAME = /`([a-z][A-Za-z0-9]{9,})`/g;
const CODE_FILE = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;

/** The check could not run - which is never the same answer as "the comment is stale". */
export class CommentCheckUnavailable extends Error {}

/** The claims a block of comment lines makes about the code. */
export function commentSymbolMentions(lines) {
  const found = new Set();
  for (const line of lines) {
    const text = String(line).trim();
    if (!/^(\*|\/\/)/.test(text)) continue;
    // A line that carries the marker is quoting a name to explain it - which is exactly what
    // this file's own header and its fixtures do with the case that motivated the check.
    if (text.includes('comment-symbols:ignore')) continue;
    for (const match of text.matchAll(NAME)) {
      const name = match[1];
      if ((name.match(/[A-Z]/g) ?? []).length < 2) continue;
      found.add(name);
    }
  }
  return [...found];
}

/**
 * Does grep output actually define the name?
 *
 * A mention is not a definition: the check was written to catch a comment pointing at a
 * deleted function, and grepping for the bare name lets that comment - or the doc that
 * recounts the story, or the test that pins it - certify the very reference that is stale.
 * So a mention counts only from code that is not a comment, and not from the tests whose
 * fixtures name the missing thing on purpose (check-quoted: `comment-symbols:ignore`).
 */
export function definesSymbol(name, grepOutput) {
  const needle = new RegExp(`\\b${name}\\b`);
  return String(grepOutput || '')
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      const text = line.slice(line.indexOf(':') + 1).trim();
      return needle.test(text) && !/^(\*|\/\/)/.test(text);
    });
}

/** Which of those claims nothing defines. */
export function findMissingSymbols(names, exists) {
  return [...new Set(names)].filter((name) => !exists(name));
}

function defaultExists(root) {
  // One grep over the tree per name; the tree is text and the name list is in the tens.
  return (name) => {
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
          name,
          'src',
          'scripts',
        ],
        { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 },
      );
      return definesSymbol(name, out);
    } catch (err) {
      // grep exits 1 for "no match", which is the answer. Anything else - no grep on PATH,
      // the directory moved - would otherwise read as "nothing defines this name" and blame
      // every comment in the tree for a missing tool.
      if (err?.code === 'ENOENT') {
        throw new CommentCheckUnavailable(
          'grep is not available, so symbol promises cannot be checked',
        );
      }
      // grep exits 1 for "no match", which is the answer that the name is not defined.
      return false;
    }
  };
}

export function main(
  args,
  {
    root = process.cwd(),
    read,
    exists,
    write = (line) => process.stdout.write(`comment-symbols: ${line}\n`),
  } = {},
) {
  const files =
    args.length > 0
      ? args.filter((f) => CODE_FILE.test(f) && !f.includes('__tests__'))
      : execFileSync('git', ['ls-files', 'src', 'docs', 'scripts'], {
          cwd: root,
          encoding: 'utf8',
        })
          .split('\n')
          .filter((f) => CODE_FILE.test(f) && !f.includes('__tests__'));

  const readFile =
    read ??
    ((file) => {
      try {
        return fs
          .readFileSync(root ? `${root}/${file}` : file, 'utf8')
          .split('\n');
      } catch {
        return [];
      }
    });
  const resolves = exists ?? defaultExists(root);

  let bad = 0;
  for (const file of files) {
    let missing;
    try {
      missing = findMissingSymbols(
        commentSymbolMentions(readFile(file)),
        resolves,
      );
    } catch (err) {
      // "cannot look" is not the same answer as "nothing defines this name".
      if (err instanceof CommentCheckUnavailable) {
        write(err.message);
        return 2;
      }
      throw err;
    }
    for (const name of missing) {
      bad += 1;
      write(
        `${file}: names \`${name}\`, which no non-test code in src or scripts defines`,
      );
    }
  }
  if (bad) {
    write(
      `${bad} stale symbol reference(s) - the comment describes code that is not there; fix the comment or restore the symbol.`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('comment-symbols.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
