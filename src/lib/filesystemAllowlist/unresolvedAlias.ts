/**
 * Detects `@Alias` tokens that survived path/command resolution.
 *
 * An unresolved alias used to be passed through to the backend, where a shell
 * command happily created a literal `@WorkDir` folder next to the app data. A
 * path that still contains an alias is never a valid path, so the caller must
 * refuse it and tell the model what to do instead.
 */

/**
 * Alias-shaped token at a word boundary, followed by a path separator, space,
 * quote or end of string:
 *  - `@WorkDir/notes.txt`, `cd @WorkDir`, `"@WorkDir/x.txt"` match
 *  - `user@example.com` (preceded by a word char) does not
 *  - PowerShell `@(`, `@{`, `$x=@(1)` and here-strings do not
 */
const ALIAS_TOKEN = /(^|[\s"'=(,;|&])@([A-Za-z][A-Za-z0-9_-]{0,63})(?=[/\\\s"']|$)/;

/** Returns the first unresolved alias token (e.g. `@WorkDir`) or undefined. */
export function findUnresolvedAlias(text: unknown): string | undefined {
  const raw = String(text ?? '');
  if (!raw.includes('@')) return undefined;
  const match = ALIAS_TOKEN.exec(raw);
  return match ? `@${match[2]}` : undefined;
}

/** First unresolved alias found in a set of path-like values. */
export function findUnresolvedAliasInValues(values: unknown[]): string | undefined {
  for (const value of values) {
    const found = findUnresolvedAlias(value);
    if (found) return found;
  }
  return undefined;
}
