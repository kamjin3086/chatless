/**
 * The composer changed height on keystrokes that added no line, and it turned out to be four
 * assumptions that were each quietly wrong: the box was measured after paint; the ceiling was
 * written twice and the two copies disagreed (40% for the first render, 60% after the first
 * window resize); the scrollbar answered for the height (`scrollHeight > clientHeight`) while
 * the scrollbar it showed took width from the text and moved the wrap; and every keystroke
 * wrote a height whether it had changed or not - which is also what makes an open IME preedit
 * jump.
 *
 * The arithmetic below is a real unit test. The rest is a source-text gate, because there is
 * nothing here to measure: vitest runs with `environment: 'node'` (vitest.config.ts) and the
 * tree has no jsdom and no component harness (`grep -n "jsdom\|testing-library" package.json`
 * is empty), so no layout engine exists to reproduce a reflow or a one-frame flash in. Same
 * shape as `src/lib/__tests__/modelParameterReadBoundary.test.ts`.
 *
 * A source gate only earns its place if reverting the fix turns it red, so each assertion below
 * was written against the mutation it has to catch - and each is scoped to the composer's own
 * textarea rather than the whole 1360-line component, so an unrelated `transition-all` elsewhere
 * cannot make it scream (docs/agents/maintenance.md on gates that become noise).
 *
 * What it cannot see: that a real browser paints after the layout effect, or that the measured
 * `scrollHeight` matches what a real font would wrap into.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composerMaxHeight, composerNeedsScrollbar } from '../inputHeight';

const COMPOSER = path.resolve(__dirname, '../ChatInput.tsx');
const composerSource = () => readFileSync(COMPOSER, 'utf8');

/** The `<textarea>` element's own JSX, and nothing else from the component. */
function textareaMarkup(): string {
  const source = composerSource();
  const start = source.indexOf('<textarea');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('/>', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the height arithmetic', () => {
  it('takes one share of the viewport, whatever the viewport is', () => {
    expect(composerMaxHeight(760)).toBe(304);
    expect(composerMaxHeight(768)).toBe(307);
    expect(composerMaxHeight(1_000)).toBe(400);
    // A window squeezed to the layout floor still gets a usable box rather than zero.
    expect(composerMaxHeight(0)).toBe(1);
  });

  it('answers the scrollbar from the numbers, not from the element', () => {
    expect(composerNeedsScrollbar({ contentHeight: 300, height: 300 })).toBe(
      false,
    );
    expect(composerNeedsScrollbar({ contentHeight: 301, height: 300 })).toBe(
      true,
    );
  });
});

describe('the composer keeps itself still while typing', () => {
  it('asks one function for the ceiling, in both places that need it', () => {
    const source = composerSource();
    // The jump was: first render 40%, first resize 60%, both hand-written. Either operand
    // order counts as hand-writing it again.
    expect(source).not.toMatch(/innerHeight\s*\*\s*0?\.\d/);
    expect(source).not.toMatch(/0?\.\d\s*\*\s*innerHeight/);
    expect(source).toMatch(
      /useState<number>\(\s*\(\) =>[;\s]*composerMaxHeight\(window\.innerHeight\)/,
    );
    expect(source).toMatch(
      /setMaxInputHeight\(\s*composerMaxHeight\(window\.innerHeight\)\s*\)/,
    );
  });

  it('measures with the scrollbar switched off', () => {
    const source = composerSource();
    const hidden = source.indexOf("style.overflowY = 'hidden'");
    const measured = source.indexOf('textarea.scrollHeight');
    expect(hidden).toBeGreaterThan(-1);
    expect(measured).toBeGreaterThan(hidden);
    // And the scrollbar answer comes from the arithmetic, never from the element it changed.
    expect(source).not.toMatch(/scrollHeight\s*>\s*clientHeight/);
    expect(source).toContain('composerNeedsScrollbar(');
  });

  it('writes a height only when it changed', () => {
    const source = composerSource();
    expect(source).toContain('if (previous !== nextStyleHeight)');
  });

  it('sizes the box before paint, not after', () => {
    const source = composerSource();
    // The alias is the fix, so pin the alias: a client branch that falls back to `useEffect`
    // measures after paint again while every call site still reads correctly.
    expect(source).toMatch(
      /import React[^;]*\buseLayoutEffect\b[^;]*from ["']react["']/,
    );
    expect(source).toMatch(
      /const useLayoutEffectOnClient = typeof window === ["']undefined["'] \? useEffect : useLayoutEffect;/,
    );
    expect(source).toMatch(
      /useLayoutEffectOnClient\(\s*\(\) =>\s*\{\s*adjustTextareaHeight\(\);/,
    );
    expect(source).not.toMatch(
      /[^On]useEffect\(\s*\(\) =>\s*\{\s*adjustTextareaHeight\(\);/,
    );
  });

  it('leaves layout out of the textarea transition and the box height to one writer', () => {
    const markup = textareaMarkup();
    // `transition-all` animated the height change, so a keystroke that grew the box by a line
    // kept animating while the next one arrived.
    expect(markup).not.toContain('transition-all');
    expect(markup).toContain('transition-colors');
    // The effect owns height/maxHeight/overflowY; a second writer in the JSX would race it.
    expect(markup).not.toMatch(/style=\{\{[^}]*maxHeight/);
    // The two-line floor is measured from the element; a CSS min-height is a second floor that
    // can only disagree with it.
    expect(markup).not.toMatch(/min-h-\[/);
  });
});
