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

  it('and it is tinted as a region, so it is not invisible either', () => {
    // "Flat" is a fill claim, not a "no fill" claim: an untinted rail and the sheet are the
    // same surface, which is how the first pass lost the sidebar entirely.
    expect(GLOBALS).toContain('--glass-rail-fill');
    const band = block(GLOBALS, '.glass-ui .glass-nav::before {');
    expect(band).toContain('background: var(--glass-rail-fill)');
  });

  it('the content rails are the sheet with a divider, not a second surface', () => {
    // Tinting them put a tonal step beside the message column, which read as a gap, and the
    // settings rail was clipped by a rounded inner container - a second arc inside the
    // sheet's corner. The boundary is the divider their right border already draws.
    for (const selector of ['.glass-ui .chat-rail {', '.glass-ui .settings-rail {']) {
      const rail = block(GLOBALS, selector);
      expect(rail, selector).toContain('background: transparent !important');
      expect(rail, selector).toContain('var(--glass-border)');
    }
    for (const selector of [
      'html.glass-ui .chat-rail {',
      'html.glass-ui .settings-rail,',
    ]) {
      expect(block(SHEET, selector), selector).toContain('background: transparent !important');
    }
  });

  it('the sheet owns the rounded clip, so nothing draws an interior arc', () => {
    const shell = block(GLOBALS, '.glass-ui .glass-shell {');
    expect(shell).toContain('border-radius: 16px');
    expect(shell).toContain('overflow: hidden');
    // A second radius on the inset inner container landed inside the rail, not at the corner.
    const inner = block(GLOBALS, '.glass-ui .glass-shell-inner {');
    expect(inner).toContain('border-radius: 0');
  });

  it('the current page is a mark, not only a colour shift', () => {
    expect(GLOBALS).toContain('--glass-active-fill');
    const active = block(SHEET, 'html.glass-ui .glass-nav .nav-item-active {');
    expect(active).toContain('background-color: var(--glass-active-fill)');
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

describe('controls keep a surface of their own', () => {
  it('the control level is a token, and chips, composer and triggers spend it', () => {
    expect(GLOBALS).toContain('--glass-control-fill');
    expect(block(GLOBALS, '.glass-ui .prompt-chip {')).toContain(
      'background-color: var(--glass-control-fill)',
    );
    expect(block(GLOBALS, '.glass-ui .input-area .composer-box {')).toContain(
      'background-color: var(--glass-control-fill)',
    );
    // The model selector sits in the header, not on it: no fill at rest, hover only.
    const ghost = block(SHEET, 'html.glass-ui [data-slot="select-trigger"][data-variant="ghost"] {');
    expect(ghost).toContain('background-color: transparent !important');
    expect(ghost).toContain('border-color: transparent !important');
    expect(ghost).toContain('box-shadow: none !important');
  });

  it('the pane catches a light source instead of being one flat fill', () => {
    expect(GLOBALS).toContain('--glass-sheen');
    expect(SHEET).toContain('background-image: var(--glass-sheen)');
  });

  it('the settings page scrolls without drawing a bar', () => {
    // The sheet sets `thin` on every element; hiding the settings scroller's bar has to say so
    // by name, or Chromium keeps the standard property over the pseudo-element.
    expect(block(SHEET, 'html.glass-ui .settings-main {')).toContain(
      'scrollbar-width: none !important',
    );
    expect(block(SHEET, 'html.glass-ui .settings-main::-webkit-scrollbar {')).toContain(
      'display: none !important',
    );
  });
});

describe('text-bearing overlays leave the glass channel', () => {  it('dialogs, menus, toasts and tips are opaque enough to carry text', () => {
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
