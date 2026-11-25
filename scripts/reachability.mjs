#!/usr/bin/env node
/**
 * Which source modules can no longer be reached from anything that runs?
 *
 * A report, not a gate - the first version of this tool that ran as a gate would be a machine
 * that guesses and a human who stops trusting it. The gates that came before it
 * (`comment-symbols`, `doc-symbols`, `i18n-unused`) all check a literal claim; reachability
 * needs a model of what counts as an entry point, and this repository has never written that
 * model down. Writing it down is most of the value here.
 *
 * Why a report is needed at all: `src/lib/skills/index.ts`, `src/components/skills/index.ts`
 * and `src/store/index.ts` re-export nearly everything they contain, so `grep -rn <symbol>`
 * prints a line that looks like a caller. Both independent reviewers of PR #244 wrote their
 * own import-graph script before agreeing that a barrel line is not evidence of use, which is
 * the argument for putting the graph in the repo instead of in whoever is reviewing.
 *
 * How it reads the graph:
 *   - `ts.preProcessFile` (the compiler's scanner, no type-check): imports, `export … from`,
 *     side-effect imports. `import('./x')` and `require('x')` too. Every dynamic import in
 *     this tree is a literal (545 sites, zero computed), so nothing is missed for being lazy.
 *   - resolution understands `@/…` (tsconfig paths) and relative paths with extension/index
 *     completion, which is all this tree uses.
 *   - a module is reachable if any reachable module points at it, from any file under `src/app`
 *     (Next's file-system routing makes every one of those an entry), from
 *     `src/instrumentation-client.ts`, or from a `src/scripts` script a package.json script
 *     names.
 *
 * Where it can be wrong, and says so:
 *   - dispatch by string (a tool name looked up in a registry, a component chosen by config)
 *     is invisible to any import graph; the report counts unreachable files whose stem appears
 *     in a string somewhere else and calls them suspects rather than dead.
 *   - a file reached only from a test is unreachable from the shipped app, and says so.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLVE_EXT = [...CODE_EXT, '.json'];

/** Entry points: files the framework or a script runner loads without anyone importing them. */
export function entryPoints(root, { files, scripts } = {}) {
  const tracked = files ?? gitFiles(root, ['src']);
  const entries = new Set();
  for (const file of tracked) {
    if (!CODE_EXT.includes(path.extname(file))) continue;
    if (file.includes('__tests__/')) continue;
    if (file.startsWith('src/app/')) entries.add(file); // Next file-system routing
    if (
      file === 'src/instrumentation-client.ts' ||
      file === 'src/middleware.ts'
    )
      entries.add(file);
  }
  // `src/scripts/*` only counts when a package.json script actually runs it: a script nobody
  // runs is as dead as a module nobody imports, and usually dead earlier.
  const pkgScripts =
    scripts ??
    Object.entries(readJson(path.join(root, 'package.json'))?.scripts ?? {});
  for (const file of tracked) {
    if (!file.startsWith('src/scripts/')) continue;
    const stem = path.basename(file);
    if (pkgScripts.some(([, cmd]) => cmd.includes(stem) || cmd.includes(file)))
      entries.add(file);
  }
  return entries;
}

/** Every literal module specifier a file names: static, re-export, dynamic import, require. */
export function specifiersOf(source, fileName) {
  const specs = new Set();
  try {
    const scanned = ts.preProcessFile(source, true, true);
    for (const s of scanned.importedFiles) specs.add(s.fileName);
  } catch {
    // A file the scanner cannot read is a file whose edges are unknown; the caller counts that.
  }
  // preProcessFile skips require() with a string argument in some shapes; catch the rest by text.
  for (const m of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g))
    specs.add(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g))
    specs.add(m[1]);
  if (fileName?.endsWith('.json')) return new Set();
  return specs;
}

/** `@/…` (tsconfig paths) and relative paths, with extension and index completion. */
export function resolveSpecifier(spec, fromFile, existing) {
  let base;
  if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromFile), spec),
    );
  else return null; // bare specifier: node_modules or a package export, not this graph
  if (existing.has(base)) return base;
  if (RESOLVE_EXT.some((e) => spec.endsWith(e)) && !existing.has(base)) {
    // a path that already looks complete but is not tracked is not an internal module
  }
  for (const ext of RESOLVE_EXT)
    if (existing.has(base + ext)) return base + ext;
  for (const ext of RESOLVE_EXT)
    if (existing.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

/** Build the graph: nodes are tracked files, edges are literal specifiers that resolve. */
export function buildGraph(root, { files, readText } = {}) {
  const tracked = new Set(files ?? gitFiles(root, ['src']));
  const read = readText ?? ((f) => readSafe(path.join(root, f)));
  const code = [...tracked].filter((f) => CODE_EXT.includes(path.extname(f)));
  const nodes = new Set(code.filter((f) => !isTest(f)));
  const tests = new Set(code.filter(isTest));
  const edges = new Map();
  const sources = new Map();
  const unresolved = [];
  for (const file of code) {
    const source = read(file);
    sources.set(file, source);
    const outs = new Set();
    for (const spec of specifiersOf(source, file)) {
      const internal =
        spec.startsWith('@/') ||
        spec.startsWith('./') ||
        spec.startsWith('../');
      if (!internal) continue; // bare specifier: a package, not this graph
      const target = resolveSpecifier(spec, file, tracked);
      if (target && nodes.has(target)) outs.add(target);
      else if (target)
        continue; // resolved to a test or an asset: not a shipped-code edge
      else if (CODE_EXT.some((e) => spec.startsWith('@/') || spec.endsWith(e)))
        unresolved.push({ from: file, spec });
    }
    edges.set(file, outs);
  }
  return { nodes, tests, edges, unresolved, sources };
}

function isTest(file) {
  return (
    file.includes('__tests__/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
  );
}

export function reachableFrom(entries, edges) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of edges.get(file) ?? [])
      if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/** Who points at a file. A barrel re-export shows up here, which is the point of keeping it. */
export function reverseEdges(edges) {
  const back = new Map();
  for (const [from, outs] of edges) {
    for (const to of outs) {
      if (!back.has(to)) back.set(to, new Set());
      back.get(to).add(from);
    }
  }
  return back;
}

/** Connected components inside the unreachable set: dead code travels in groups. */
export function clusters(unreachable, edges) {
  const undirected = new Map();
  for (const file of unreachable) {
    for (const to of edges.get(file) ?? []) {
      if (!unreachable.has(to)) continue;
      (undirected.get(file) ?? undirected.set(file, new Set()).get(file)).add(
        to,
      );
      (undirected.get(to) ?? undirected.set(to, new Set()).get(to)).add(file);
    }
  }
  const done = new Set();
  const groups = [];
  for (const start of unreachable) {
    if (done.has(start)) continue;
    const group = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const file = stack.pop();
      done.add(file);
      for (const next of undirected.get(file) ?? [])
        if (!group.has(next)) {
          group.add(next);
          stack.push(next);
        }
    }
    groups.push([...group].sort());
  }
  return groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * Files whose stem appears in a string outside themselves: name-based dispatch is the one way a
 * "dead" module is actually alive, so the report separates suspects from candidates.
 */
/**
 * The one way "unreachable" is wrong: dispatch by string, where a live file names a module in a
 * string and something loads it from that. A string counts only if it *resolves* to the
 * candidate from the file it sits in - matching the bare stem instead called four live modules
 * suspects, because `Tokenizer` is inside `HuggingFaceTokenizer` and `types` is inside
 * `@/lib/llm/types`. And a string inside an already-unreachable file proves nothing.
 */
export function namedInStrings({ candidates, live, tracked, sources }) {
  if (!candidates.size) return new Map();
  const quoted = /['"`]([^'"`\n]*)['"`]/g;
  const suspects = new Map();
  for (const [from, source] of sources) {
    if (!live.has(from)) continue; // a string inside dead code certifies nothing
    let isComment = false;
    for (const line of source.split('\n')) {
      // A commented-out import is a feature switched off, not a live edge. "The only mention is
      // a comment" is a fact a deletion wants, so it is labelled rather than quietly dropped.
      isComment = /^\s*(\/\/|\*|\/\*|#)/.test(line);
      for (const m of line.matchAll(quoted)) {
        // Resolve the whole string, do not prefilter on the file stem: `retry` is a stem, and so
        // is a word in a sentence; `@/lib/chat/actions/retry` is a specifier. Group 1 here is the
        // quoted text, which is the only thing worth resolving.
        const target = resolveSpecifier(m[1], from, tracked);
        if (!target || !candidates.has(target)) continue;
        const list = suspects.get(target) ?? [];
        list.push(`${isComment ? 'comment' : 'string'} in ${from}: '${m[1]}'`);
        suspects.set(target, list);
      }
    }
  }
  return suspects;
}

export function analyze({
  root = process.cwd(),
  files,
  readText,
  scripts,
} = {}) {
  const entries = entryPoints(root, { files, scripts: scripts ?? undefined });
  const { nodes, tests, edges, unresolved, sources } = buildGraph(root, {
    files,
    readText,
  });
  const live = reachableFrom(entries, edges);
  // With the tests wired in as extra roots, anything that lights up only then is code a test
  // keeps breathing on: dead in the app, and deleting it takes the test with it.
  const liveWithTests = reachableFrom([...entries, ...tests], edges);
  const testOnly = [...nodes]
    .filter((f) => !live.has(f) && liveWithTests.has(f))
    .sort();
  const unreachable = [...nodes]
    .filter((f) => !live.has(f) && !liveWithTests.has(f))
    .sort();
  const back = reverseEdges(edges);
  const groups = clusters(new Set(unreachable), edges);
  return {
    counts: {
      source: nodes.size,
      entries: entries.size,
      live: live.size,
      unreachable: unreachable.length,
      testOnly: testOnly.length,
      noImportersAtAll: unreachable.filter(
        (f) => (back.get(f) ?? new Set()).size === 0,
      ).length,
      unresolved: unresolved.length,
      testFiles: tests.size,
    },
    unreachable,
    testOnly,
    clusters: groups,
    unresolved,
    suspects: namedInStrings({
      candidates: new Set(unreachable),
      live,
      tracked: new Set([...nodes, ...tests]),
      sources,
    }),
    importersOf: (file) => [...(back.get(file) ?? [])].sort(),
  };
}

export function report(
  result,
  write = (line) => process.stdout.write(`${line}\n`),
) {
  const c = result.counts;
  write(
    `reachability: ${c.source} source modules, ${c.entries} entry points, ${c.live} reachable, ` +
      `${c.unreachable} unreachable (${c.noImportersAtAll} nothing imports at all)`,
  );
  write(
    `kept alive by tests only: ${c.testOnly} - deleting those takes their tests too, so they are listed, not called dead`,
  );
  write(
    `blind spots: ${c.unresolved} internal specifiers did not resolve, ${result.suspects.size} unreachable files are named by a module-path string elsewhere (name-based dispatch is the one way "dead" is wrong), ${c.testFiles} test files as roots only`,
  );
  for (const [file, strings] of result.suspects)
    write(`  suspect ${file}: ${strings.join(' ')}`);
  write(
    '(a suspect whose only mention is a comment is a feature switched off, not a live edge)',
  );
  if (c.testOnly) {
    write(`\ntest-only (${c.testOnly}):`);
    for (const f of result.testOnly) write(`    ${f}`);
  }
  const big = result.clusters.filter((g) => g.length > 1);
  write(
    `clusters: ${big.length} groups hold ${big.reduce((n, g) => n + g.length, 0)} of them`,
  );
  for (const group of big.slice(0, 12)) {
    write(`\n  ${group.length} files`);
    for (const f of group.slice(0, 8)) write(`    ${f}`);
    if (group.length > 8) write(`    … ${group.length - 8} more`);
  }
  const singles = result.clusters
    .filter((g) => g.length === 1)
    .map((g) => g[0]);
  if (singles.length) {
    write(
      `\n  alone, nothing else in this set points at them (${singles.length}):`,
    );
    for (const f of singles.slice(0, 20)) write(`    ${f}`);
    if (singles.length > 20) write(`    … ${singles.length - 20} more`);
  }
  return result;
}

export function main(argv = [], { root = process.cwd(), write } = {}) {
  const json = argv.includes('--json');
  const result = analyze({ root });
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...result, suspects: [...result.suspects] }, null, 2)}\n`,
    );
    return 0;
  }
  report(result, write);
  return 0;
}

function gitFiles(root, dirs) {
  try {
    return execFileSync('git', ['ls-files', '--', ...dirs], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exit(main(process.argv.slice(2)));
