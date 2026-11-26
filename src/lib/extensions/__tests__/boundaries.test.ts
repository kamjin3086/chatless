/**
 * Import-boundary gate (plan A01, Q6: a vitest gate, not a graph tool). The
 * repo precedent is literal-assertion gates (comment-symbols / doc-symbols);
 * reachability stays a report. This asserts the dependency matrix (§4.2) for
 * the extension boundary by scanning real import statements.
 *
 * Rules:
 *  R1  Nothing outside src/lib/extensions/** may import the extension tree in
 *      PR A; when the real assembly entry lands it is added to ASSEMBLY_ALLOWLIST
 *      (the one sanctioned exception, §4.3).
 *  R2  Production code inside extensions/** stays free of runtime machinery:
 *      no pipeline executor, no stores, no UI, no agent loop, no ServerManager -
 *      resolved to real paths so relative `../../store/...` cannot slip past
 *      an alias-only blacklist.
 *  R3  Feature directories never import sibling features; only builtin.ts may
 *      import `./<feature>/contribution`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..'); // src/
const EXT_DIR = join(ROOT, 'lib', 'extensions');

/** Files allowed to import the extension tree from outside it (§4.3 assembly entry).
 * PR B rewired the two sanctioned consumers; each import is one line of glue
 * reading the derived view, no core logic lives in the consumers' import. */
export const ASSEMBLY_ALLOWLIST = new Set<string>([
  'lib/mcp/injection/promptBuilder.ts',
  'lib/mcp/pipeline/adapters/ToolsRegistryAdapter.ts',
  // Phase 3 executor wiring: the bridge reads the enabled-groups view and
  // delegates execution to the contribution's own factory - glue, no policy.
  'lib/mcp/pipeline/adapters/ContributionAdapter.ts',
  // A05 routing guard: contributed servers never fall through to the external
  // MCP path; one read of the full groups view, no policy in the check.
  'lib/mcp/pipeline/adapters/McpAdapter.ts',
]);

/** Inside the tree, assembly.ts is the wiring point: §4.2 lets it inject the
 * services concrete contributions need (store/database closures). */
const R2_EXEMPT = new Set(['lib/extensions/assembly.ts']);

const FORBIDDEN_DIRS = [
  join(ROOT, 'store'),
  join(ROOT, 'components'),
  join(ROOT, 'hooks'),
  join(ROOT, 'lib', 'mcp', 'agentLoop'),
];
const FORBIDDEN_FILES = [
  join(ROOT, 'lib', 'mcp', 'pipeline', 'ToolExecutionPipeline'),
  join(ROOT, 'lib', 'mcp', 'ServerManager'),
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules' || entry === '.next')
      continue;
    const st = statSync(full);
    if (st.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every specifier a module pulls in: static, re-export, side-effect, require, dynamic. */
export function importSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:\bfrom|require\()\s*['"]([^'"]+)['"]/g))
    found.add(m[1]);
  for (const m of source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g))
    found.add(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g))
    found.add(m[1]);
  return [...found];
}

/** Resolve alias and relative specifiers to filesystem paths; bare packages resolve to null. */
export function resolveSpecifier(
  fromFile: string,
  spec: string,
): string | null {
  if (spec.startsWith('@/')) return normalize(join(ROOT, spec.slice(2)));
  if (spec.startsWith('.')) return normalize(resolve(dirname(fromFile), spec));
  return null;
}

function withoutExtension(p: string): string {
  return p.replace(/\.tsx?$/, '').replace(new RegExp(`${sep}index$`), '');
}

function hits(
  fromFile: string,
  spec: string,
  dirs: string[],
  files: string[],
): boolean {
  const r = resolveSpecifier(fromFile, spec);
  if (!r) return false;
  const noExt = withoutExtension(r);
  return (
    files.some((f) => noExt === withoutExtension(f)) ||
    dirs.some((d) => noExt === d || noExt.startsWith(d + sep))
  );
}

const allFiles = collectSourceFiles(ROOT);
const inside = allFiles.filter((f) => f.startsWith(EXT_DIR + sep));
const outside = allFiles.filter((f) => !f.startsWith(EXT_DIR + sep));

describe('extension import boundaries (A01)', () => {
  it('helper: catches bare side-effect imports', () => {
    expect(
      importSpecifiers(
        "import '@/lib/extensions/builtin';\nexport const x = 1;",
      ),
    ).toContain('@/lib/extensions/builtin');
  });

  it('helper: resolves relative store imports', () => {
    const fake = join(EXT_DIR, 'registry.ts');
    expect(resolveSpecifier(fake, '../../store/x')).toBe(
      normalize(join(ROOT, 'store', 'x')),
    );
    expect(resolveSpecifier(fake, '@/lib/mcp/ServerManager')).toBe(
      normalize(join(ROOT, 'lib', 'mcp', 'ServerManager')),
    );
    expect(hits(fake, '../../store/x', FORBIDDEN_DIRS, FORBIDDEN_FILES)).toBe(
      true,
    );
    expect(hits(fake, './contracts', FORBIDDEN_DIRS, FORBIDDEN_FILES)).toBe(
      false,
    );
  });

  it('only sanctioned entries import the extension tree from outside (R1)', () => {
    const offenders: string[] = [];
    for (const file of outside) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (ASSEMBLY_ALLOWLIST.has(rel)) continue;
      const hitsExt = importSpecifiers(readFileSync(file, 'utf-8')).filter(
        (spec) => {
          const r = resolveSpecifier(file, spec);
          if (!r) return /(^|[\\/])extensions[\\/]/.test(spec);
          const noExt = withoutExtension(r);
          return noExt === EXT_DIR || noExt.startsWith(EXT_DIR + sep);
        },
      );
      if (hitsExt.length > 0) offenders.push(`${rel}: ${hitsExt.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('extension production code stays data + registry only (R2, §4.2)', () => {
    const offenders: string[] = [];
    for (const file of inside) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (R2_EXEMPT.has(rel)) continue;
      for (const spec of importSpecifiers(readFileSync(file, 'utf-8'))) {
        if (hits(file, spec, FORBIDDEN_DIRS, FORBIDDEN_FILES))
          offenders.push(`${rel}: imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('feature directories never import siblings; only builtin.ts aggregates features (R3)', () => {
    const offenders: string[] = [];
    for (const file of inside) {
      const rel = relative(ROOT, file).split(sep).join('/');
      const parts = rel.split('/'); // lib/extensions/<feature>/...
      if (parts.length < 4) continue; // contracts/registry/builtin are not features
      const feature = parts[2];
      for (const spec of importSpecifiers(readFileSync(file, 'utf-8'))) {
        const m = spec.match(/@\/lib\/extensions\/([^/]+)/);
        if (
          m &&
          m[1] !== feature &&
          m[1] !== 'contracts' &&
          m[1] !== 'registry'
        ) {
          offenders.push(`${rel}: imports foreign feature via ${spec}`);
        }
        const relMatch = spec.match(/^\.\.\/([^/]+)/);
        const rootModules = ['contracts', 'registry', 'builtin', 'assembly'];
        if (
          relMatch &&
          relMatch[1] !== feature &&
          relMatch[1] !== '__tests__' &&
          !rootModules.includes(relMatch[1])
        ) {
          offenders.push(`${rel}: relative sibling import ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
