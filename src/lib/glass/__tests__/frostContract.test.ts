/**
 * The glass theme's surface system, as a check rather than a document.
 *
 * The theme used to hold four blur numbers (40 / 28 / 12 / none) across two files, a rail card
 * drawn inside a window card, and a three-hue backdrop behind everything - which is why it read
 * as a navy wash with outlines, and why every edit could quietly add one more layer. The rules
 * that replaced it are only worth what the next edit respects, so they are asserted here:
 *
 *   tokens (globals.css)  ←  rules (the injected sheet)
 *
 * Both files are read. A `glass-` value may only live in one of them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const globals = readFileSync(path.join(ROOT, 'styles/globals.css'), 'utf8');
const sheetRaw = readFileSync(
  path.join(ROOT, 'lib/glass/frostStyle.ts'),
  'utf8',
);

/** Comments are stripped: a comment quoting a rule is not the rule. */
function noComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const GLOBALS = noComments(globals);
const SHEET = noComments(sheetRaw);

/** The declaration body of the first block whose selector starts with `selector`. */
function block(css: string, selector: string): string | null {
  const index = css.indexOf(selector);
  if (index < 0) return null;
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return css.slice(open + 1, close);
}

function countBlurs(css: string): number {
  return (css.match(/(?<!-webkit-)backdrop-filter\s*:\s*blur\(/g) || []).length;
}

describe('one sheet, one blur', () => {
  it('the injected sheet carries exactly one live blur', () => {
    expect(countBlurs(SHEET)).toBe(1);
  });

  it('and that blur is the window sheet spending the token', () => {
    const shell = block(SHEET, 'html.glass-ui .glass-shell {');
    expect(shell).toContain('backdrop-filter: blur(var(--glass-blur))');
    expect(shell).toContain('-webkit-backdrop-filter');
  });

  it('the rail is a flat region, not a card', () => {
    const rail = block(SHEET, 'html.glass-ui .glass-nav {');
    expect(rail).toContain('background: transparent');
    const globalsRail = block(GLOBALS, '.glass-ui .glass-nav {');
    expect(globalsRail).toContain('background: transparent !important');
    expect(globalsRail).toContain('border: none');
    expect(globalsRail).toContain('box-shadow: none');
    expect(globalsRail).toContain('backdrop-filter: none');
  });

  it('a divider marks it, and the token exists', () => {
    expect(GLOBALS).toContain('--glass-divider');
    expect(GLOBALS).toContain('.glass-ui .glass-nav::after');
  });

  it('nothing inside the sheet blurs on its own', () => {
    for (const selector of [
      'html.glass-ui .glass-panel,',
      'html.glass-ui .chat-rail {',
      'html.glass-ui .glass-field:not(.inline-edit) {',
      'html.glass-ui .prompt-chip,',
      'html.glass-ui .settings-rail,',
    ]) {
      const body = block(SHEET, selector);
      expect(body, selector).toBeTruthy();
      expect(body, selector).not.toContain('backdrop-filter: blur');
    }
  });
});

describe('text-bearing overlays leave the glass channel', () => {
  it('dialogs, menus, toasts and tips are opaque enough to carry text', () => {
    for (const selector of [
      'html.glass-ui .glass-float-dialog,',
      'html.glass-ui .glass-float-menu,',
      'html.glass-ui [data-sonner-toast] {',
      'html.glass-ui .glass-float-tip,',
    ]) {
      const body = block(SHEET, selector);
      expect(body, selector).toBeTruthy();
      expect(body, selector).not.toContain('backdrop-filter: blur');
    }
  });

  it('the overlay fill is the token, and it is nearly opaque in both themes', () => {
    expect(GLOBALS).toContain(
      '--glass-overlay-fill: rgba(250, 252, 255, 0.95)',
    );
    expect(GLOBALS).toContain('--glass-overlay-fill: rgba(17, 20, 27, 0.95)');
    const dialog = block(SHEET, 'html.glass-ui .glass-float-dialog,');
    expect(dialog).toContain('background-color: var(--glass-overlay-fill)');
  });
});

describe('the backdrop is owned by one file, in one hue', () => {
  it('the injected sheet no longer paints the backdrop', () => {
    expect(SHEET).not.toContain('radial-gradient(880px');
    expect(SHEET).not.toContain('linear-gradient(165deg');
  });

  it('two layers at most, in one colour family', () => {
    const light = block(GLOBALS, 'html.glass-ui:not(.dark) {');
    expect(light).toBeTruthy();
    const gradients = (light!.match(/gradient\(/g) || []).length;
    expect(gradients).toBeLessThanOrEqual(2);
    // The three-hue stack this replaced: cyan, teal and amber behind every accent.
    expect(light).not.toContain('56, 189, 248');
    expect(light).not.toContain('45, 212, 191');
    expect(light).not.toContain('251, 191, 36');
  });

  it('ships the elevation tokens the surfaces spend', () => {
    for (const token of [
      '--glass-base-fill',
      '--glass-surface-fill',
      '--glass-overlay-fill',
      '--glass-veil',
      '--glass-divider',
    ]) {
      expect(GLOBALS, token).toContain(token);
    }
    // The old names stay as aliases, because components read them.
    expect(GLOBALS).toContain('--glass-fill: var(--glass-base-fill)');
    expect(GLOBALS).toContain('--glass-fill-strong: var(--glass-surface-fill)');
  });
});

describe('the wallpaper is atmosphere, not a gallery', () => {
  it('the veil sits over the image and its blur is only the fallback', () => {
    expect(GLOBALS).toContain('.glass-wallpaper-veil');
    expect(GLOBALS).toContain('background: var(--glass-veil)');
    const fallback = block(GLOBALS, '.glass-wallpaper-image-fallback {');
    expect(fallback).toContain('blur(var(--glass-veil-blur))');
  });

  it('reduced motion turns the blur off rather than shrinking it', () => {
    const reduced = block(GLOBALS, '.glass-ui.reduced-motion {');
    expect(reduced).toContain('--glass-blur: 0px');
  });
});
