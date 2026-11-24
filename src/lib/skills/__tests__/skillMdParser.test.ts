import { describe, expect, it } from 'vitest';
import { parseSkillMd } from '../SkillMdParser';

/**
 * The parser had no test before the hyphenated frontmatter keys were needed: the
 * key regex accepted only `\w`, so a standard field such as
 * `disable-model-invocation` was dropped without a word. These cases are the
 * shapes SKILL.md files in the wild actually use - including the two that were
 * silently wrong: hyphenated keys, and a description folded across lines.
 */
function fmOf(md: string) {
  const result = parseSkillMd(`---\n${md}\n---\nBody here.\n`);
  expect(result.success, result.error).toBe(true);
  expect(result.frontmatter).not.toBeNull();
  return result.frontmatter!;
}

describe('SKILL.md frontmatter keys', () => {
  it('reads the invocation switches, whose keys contain hyphens', () => {
    const fm = fmOf(`name: deploy
description: Deploy the app.
disable-model-invocation: true
user-invocable: false`);
    expect(fm['disable-model-invocation']).toBe(true);
    expect(fm['user-invocable']).toBe(false);
  });

  it('reads allowed-tools as a list, space-separated or YAML', () => {
    const spaceForm = fmOf('name: a\ndescription: b\nallowed-tools: Read Grep');
    expect(spaceForm['allowed-tools']).toEqual(['Read', 'Grep']);
    const listForm = fmOf(
      'name: a\ndescription: b\nallowed-tools:\n  - Read\n  - Grep',
    );
    expect(listForm['allowed-tools']).toEqual(['Read', 'Grep']);
  });

  it('drops a switch whose value is not a literal boolean instead of guessing', () => {
    const fm = fmOf('name: a\ndescription: b\ndisable-model-invocation: yes');
    expect(fm['disable-model-invocation']).toBeUndefined();
  });

  it('does not forward keys it does not read', () => {
    const fm = fmOf(
      'name: a\ndescription: b\nsome-vendor-key: whatever',
    ) as unknown as Record<string, unknown>;
    expect(fm['some-vendor-key']).toBeUndefined();
    expect(fm.name).toBe('a');
  });
});

describe('SKILL.md descriptions that span lines', () => {
  it('keeps a folded (>) description whole', () => {
    const fm = fmOf(`name: android-operations
description: >
  Handle files, documents and photos on Android.
  Use when the task touches device storage.`);
    expect(fm.description).toBe(
      'Handle files, documents and photos on Android. Use when the task touches device storage.',
    );
  });

  it('keeps a plain continuation line whole', () => {
    const fm = fmOf(`name: android-operations
description: Handle files, documents and photos on Android.
  Use when the task touches device storage.`);
    expect(fm.description).toBe(
      'Handle files, documents and photos on Android. Use when the task touches device storage.',
    );
  });

  it('keeps the line breaks of a literal (|) block', () => {
    const fm = fmOf('name: a\ndescription: |\n  line one\n  line two');
    expect(fm.description).toBe('line one\nline two');
  });

  it('still reads the shapes it already read: quoted values, hooks and triggers', () => {
    const fm = fmOf(`name: quoted
description: "Use when the user asks: something"
version: 2.1.0
category: tools
triggers:
  - pdf
  - forms
hooks:
  pre_execute: echo ready
  verify: test -f out.txt`);
    expect(fm.description).toBe('Use when the user asks: something');
    expect(fm.version).toBe('2.1.0');
    expect(fm.category).toBe('tools');
    expect(fm.triggers).toEqual(['pdf', 'forms']);
    expect(fm.hooks).toEqual({
      pre_execute: 'echo ready',
      post_execute: undefined,
      on_error: undefined,
      verify: 'test -f out.txt',
    });
  });
});
