/**
 * A locale key nobody asks for is a key that was left behind.
 *
 * Deleting a component without its strings is easy and invisible: `skillRisk.*` - ten keys -
 * survived the store that rendered them, and the PR that pruned three other namespaces printed
 * "checked key by key" while missing exactly those. Reviewers found it by hand, twice, each
 * writing their own census. A key is either asked for somewhere or it is not, so this is a
 * check, not a review note.
 *
 * What counts as asked for:
 *   - the exact key appears in a string literal anywhere outside `src/i18n` (`t('skill.risk')`);
 *   - or a composed key covers it: ``t(`provider.${name}.label`)`` reaches
 *     `provider.anything.label` - prefix and suffix both have to match, because a looser rule
 *     (prefix only) reads `` `skills.${id}` `` as certifying every `skills.*` key in the
 *     catalog and hides real orphans. Those are reported as dynamic, not unused.
 *
 * Keys that were already orphaned before this script existed are listed in
 * `scripts/i18n-unused.allowlist.json` and tolerated: the point is that a new deletion cannot
 * add to the pile, not that history must be cleaned in one PR. An allowlisted key that becomes
 * used again is an error too, so the list cannot rot into a dump.
 *
 *   node scripts/i18n-unused.mjs [--json] [--all]   --all prints the pre-existing orphans too
 * Exit 0 when nothing new is orphaned, 1 when something is (or the list is stale).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY_DECL = /^\s*(?:\|\s*)?'([^']+)'\s*(?:,|$)/;
const KEY_VALUE = /^\s*'([^']+)':\s*/;
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** Keys declared in a locale catalog (`en-US.ts` / `zh-CN.ts`) or the union in `types.ts`. */
export function declaredKeys(text, kind) {
  const out = new Set();
  for (const line of String(text).split('\n')) {
    const m = (kind === 'types' ? KEY_DECL : KEY_VALUE).exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * What the code asks for, in one pass: exact literals, and template prefixes cut at `${`.
 *
 * Literals rather than a substring search, because keys overlap with prose ("copy", "error"),
 * and because a search over a whole tree per key is what makes people write this check by hand.
 */
export function usageOf(texts) {
  const exact = new Set();
  const raw = [];
  const patterns = [];
  for (const text of texts) {
    for (const [, , body] of String(text).matchAll(STRING_LITERAL)) {
      const trimmed = body.trim();
      if (!trimmed) continue;
      // A template literal keeps its `${}` holes: `t(`${x}`)` hides the key inside them, and
      // the substring pass below is what finds it. Nine keys were reported as orphans before
      // this was handled, all of them inside `${t('…')}`.
      raw.push(trimmed);
      if (body.includes('${')) {
        const first = body.indexOf('${');
        const last = body.lastIndexOf('${');
        const cut = body.slice(0, first);
        const tail = body.slice(body.indexOf('}', last) + 1);
        // Both ends must match a real key: prefix only is too generous, see the header.
        if (cut.includes('.')) patterns.push({ prefix: cut, suffix: tail });
        for (const hole of body.matchAll(/\$\{([^{}]*)\}/g)) {
          if (hole[1].trim()) exact.add(hole[1].trim());
        }
      } else {
        exact.add(trimmed);
      }
    }
  }
  return { exact, raw, patterns };
}

/**
 * Which declared keys nothing asks for.
 *
 * `dynamic` is not `unused`: a composed key cannot be grepped by hand and would otherwise be
 * reported forever.
 */
export function unusedKeys(declared, usage) {
  const unused = [];
  const dynamic = [];
  for (const key of declared) {
    if (usage.exact.has(key)) continue;
    if (
      usage.patterns.some(
        ({ prefix, suffix }) => key.startsWith(prefix) && key.endsWith(suffix),
      )
    ) {
      dynamic.push(key);
      continue;
    }
    // A literal that merely *contains* the key is not a use: `settings.advanced.logLevel` is
    // inside the literal of `settings.advanced.logLevelChanged`, and a prefix rule that loose
    // certifies half the catalog from the other half. These shapes are uses, though - a
    // concatenated key, a lookup table, and the key quoted inside a template hole:
    // `t(`x: ${t('a.b')}`)`.
    const quoted = [`'${key}'`, `"${key}"`, '`' + key + '`'];
    const seen = (usage.raw ?? usage.exact).some(
      (literal) =>
        literal === key ||
        literal.startsWith(`${key}.`) ||
        literal.endsWith(`.${key}`) ||
        quoted.some((q) => literal.includes(q)),
    );
    if (!seen) unused.push(key);
  }
  return { unused: unused.sort(), dynamic: dynamic.sort() };
}

function readRepoTexts(root) {
  const files = execFileSync(
    'git',
    ['ls-files', 'src', 'scripts', '--', '*.ts', '*.tsx', '*.mjs', '*.js'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\n')
    .filter((f) => f && !f.includes('__tests__') && !f.startsWith('src/i18n/'));
  return files.map((f) => {
    try {
      return fs.readFileSync(path.join(root, f), 'utf8');
    } catch {
      return '';
    }
  });
}

export function main(
  args,
  {
    root = process.cwd(),
    write = (line) => process.stdout.write(line + '\n'),
    read = (file) => fs.readFileSync(path.join(root, file), 'utf8'),
  } = {},
) {
  const localeFile = 'src/i18n/locales/en-US.ts';
  const zhFile = 'src/i18n/locales/zh-CN.ts';
  const typesFile = 'src/i18n/types.ts';
  const allowlistFile = 'scripts/i18n-unused.allowlist.json';
  let allowlist;
  try {
    allowlist = new Set(JSON.parse(read(allowlistFile)));
  } catch {
    allowlist = new Set();
  }

  const declared = new Set([
    ...declaredKeys(read(localeFile), 'locale'),
    ...declaredKeys(read(typesFile), 'types'),
  ]);
  const zh = declaredKeys(read(zhFile), 'locale');
  const usage = usageOf(readRepoTexts(root));
  const { unused, dynamic } = unusedKeys(declared, usage);

  const fresh = unused.filter((k) => !allowlist.has(k));
  const staleEntries = [...allowlist].filter(
    (k) => !unused.includes(k) && !zh.has(k) && !declared.has(k),
  );

  if (args.includes('--json')) {
    write(
      JSON.stringify(
        {
          unused,
          fresh,
          dynamic: dynamic.length,
          staleAllowlist: staleEntries,
        },
        null,
        2,
      ),
    );
  } else {
    write(
      `i18n-unused: ${declared.size} keys declared, ${unused.length} unreferenced (${dynamic.length} composed dynamically)`,
    );
    if (args.includes('--all'))
      for (const key of unused)
        write(`  ${key}${allowlist.has(key) ? ' (allowlisted)' : ''}`);
    for (const key of fresh) write(`  new orphan: ${key}`);
    for (const key of staleEntries)
      write(`  stale allowlist entry: ${key} (no longer even declared)`);
  }

  if (fresh.length || staleEntries.length) {
    write(
      fresh.length
        ? `${fresh.length} key(s) nothing asks for - delete them, or say why they stay in ${allowlistFile}.`
        : `${staleEntries.length} allowlist entry(ies) no longer describe a declared key.`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('i18n-unused.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
