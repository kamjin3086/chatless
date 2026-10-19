/**
 * #144: the model parameter dialog read the stored JSON itself and asserted it into a
 * complete parameter bag. A hand-edited `"0.9"` then showed on a slider and looked enabled,
 * while the send path dropped the same value as untrustworthy - the screen and the wire
 * disagreeing about one stored byte. The fix is not that one call site but the rule behind
 * it: a screen reads a parameter bag through `ModelParametersService`, which is where
 * cleaning happens, and nothing in the UI reaches the store for a bag itself.
 *
 * This is a source-text gate, not a render test: there is no component harness in this repo
 * (`grep -n "testing-library" package.json` is empty, `vitest.config.ts` uses
 * `environment: 'node'`) and the surfaces involved only populate inside Tauri
 * (docs/agents/maintenance.md, "which surfaces are empty outside Tauri").
 *
 * What it can see: a bag read spelled as `specializedStorage.models.getModelParameters`,
 * `...getSessionParameters`, or through a local alias of the storage handle. What it cannot
 * see: a bag read hidden inside a `src/lib` helper a screen calls - the storage layer is the
 * real enforcement point, and this is the gate for the one way it went wrong.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

/** The storage calls that hand out a parameter bag, model- or session-scoped. */
const BAG_READERS = ['getModelParameters', 'getSessionParameters'];

/** Where a bag is read by a screen. `src/lib` is allowed to be the boundary itself. */
const UI_DIRS = ['components', 'hooks', 'app'].map((name) =>
  path.join(SRC, name),
);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Comments are removed first: a comment that names the service proves nothing, and one that
 * quotes the old call is not a violation.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Bag readers in `source` that do not go through `ModelParametersService`. */
function offences(source: string): string[] {
  const text = code(source);
  const found: string[] = [];
  for (const reader of BAG_READERS) {
    for (const match of text.matchAll(new RegExp(`\\b${reader}\\b`, 'g'))) {
      const before = text.slice(
        Math.max(0, (match.index ?? 0) - 32),
        match.index,
      );
      if (!before.includes('ModelParametersService.')) found.push(reader);
    }
  }
  return found;
}

describe('a screen reads a parameter bag through the service', () => {
  it('no UI file reaches the store for a bag', () => {
    const offenders = UI_DIRS.filter((dir) => statSync(dir).isDirectory())
      .flatMap(sourceFiles)
      .map((file) => ({ file, readers: offences(readFileSync(file, 'utf8')) }))
      .filter(({ readers }) => readers.length > 0)
      .map(
        ({ file, readers }) =>
          `${path.relative(SRC, file)} reads ${readers.join(', ')} directly`,
      );

    expect(offenders).toEqual([]);
  });

  it('the model parameter dialog asks for the same bag a send uses', () => {
    const dialog = code(
      readFileSync(
        path.join(SRC, 'components/chat/ModelParametersDialog.tsx'),
        'utf8',
      ),
    );

    expect(dialog).toMatch(
      /ModelParametersService\s*\.\s*getModelParametersOrNull/,
    );
  });
});

describe('the rule the gate applies', () => {
  it('fails the call the pre-#144 dialog made', () => {
    const before = `const savedParams = await specializedStorage.models.getModelParameters(providerName, modelId);`;
    expect(offences(before)).toEqual(['getModelParameters']);
  });

  it('sees through a local handle on the storage surface', () => {
    const aliased = `const models = specializedStorage.models;\nawait models.getModelParameters(providerName, modelId);`;
    expect(offences(aliased)).toEqual(['getModelParameters']);
  });

  it('leaves the service calls alone', () => {
    const throughService = `await ModelParametersService.getModelParameters(p, m);\nawait ModelParametersService.getSessionParameters(id);`;
    expect(offences(throughService)).toEqual([]);
  });

  it('does not mistake a longer name for the reader', () => {
    expect(
      offences(`ModelParametersService.getModelParametersOrNull(p, m)`),
    ).toEqual([]);
  });
});
