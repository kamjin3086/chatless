import { describe, expect, it } from 'vitest';
import { findUnresolvedAlias, findUnresolvedAliasInValues } from '../unresolvedAlias';

describe('findUnresolvedAlias', () => {
  it('finds aliases that would otherwise become literal folders', () => {
    expect(findUnresolvedAlias('cd @WorkDir')).toBe('@WorkDir');
    expect(findUnresolvedAlias('@WorkDir/notes.txt')).toBe('@WorkDir');
    expect(findUnresolvedAlias('type "@WorkDir/a b.txt"')).toBe('@WorkDir');
    expect(findUnresolvedAlias('copy @docs\\x.txt .')).toBe('@docs');
    expect(findUnresolvedAlias('echo hi & @WorkDir/run.bat')).toBe('@WorkDir');
  });

  it('ignores resolved absolute paths', () => {
    expect(findUnresolvedAlias('C:/Users/x/Documents/Chatless/a-3f9a21/notes.txt')).toBeUndefined();
    expect(findUnresolvedAlias('node -e "process.exit(3)"')).toBeUndefined();
    expect(findUnresolvedAlias('')).toBeUndefined();
  });

  it('does not mistake emails, PowerShell arrays or here-strings for aliases', () => {
    expect(findUnresolvedAlias('git config user.email dev@example.com')).toBeUndefined();
    expect(findUnresolvedAlias('$list = @(1,2,3)')).toBeUndefined();
    expect(findUnresolvedAlias('@{ name = "x" }')).toBeUndefined();
    expect(findUnresolvedAlias('echo user@host:/path')).toBeUndefined();
  });

  it('scans a set of path values and reports the first one', () => {
    expect(findUnresolvedAliasInValues(['C:/ok', '@Alias/x', '@Other/y'])).toBe('@Alias');
    expect(findUnresolvedAliasInValues([undefined, null, 'C:/ok'])).toBeUndefined();
  });
});
