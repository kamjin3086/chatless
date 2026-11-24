/**
 * `ChatInput` has no render harness for its send path (the existing tests render static
 * markup and mock half the stores), so the ordering that decides *who* a leading token
 * belongs to is asserted here, on the source.
 *
 * The rule: `/skill-id` names a skill, and only in text the user typed. A saved prompt
 * shortcut renders first (`#name` → template text), and template text is not the user
 * naming anything - a `/api` inside somebody's saved template would otherwise quietly
 * request a skill called `api` on every send of that shortcut. Reordering this makes the
 * skill scan read rendered output, which looks identical until a model loads a skill
 * nobody asked for.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  path.resolve(process.cwd(), 'src/components/chat/ChatInput.tsx'),
  'utf8',
);

describe('who a leading token belongs to', () => {
  it('renders a shortcut before the skill scan runs', () => {
    const rendered = SOURCE.indexOf('shortcutRendered = true');
    const scanned = SOURCE.indexOf('takeSkillCommands(');

    expect(
      rendered,
      'shortcut rendering vanished from handleSend',
    ).toBeGreaterThan(0);
    expect(
      scanned,
      'skill token scan vanished from handleSend',
    ).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(scanned);
  });

  it('keeps the skill scan behind the guard that skips rendered text', () => {
    // Asserting the guard exists is what a rename trips on, which is the point: the
    // behaviour is invisible in the transcript until a skill loads unasked.
    expect(SOURCE).toMatch(/if\s*\(\s*!shortcutRendered\s*\)/);
  });

  it('matches shortcuts on #, so the two prefixes cannot collide', () => {
    // The behaviour side is pinned in skillsSlash.test.ts; this pins the other half,
    // where a shortcut token is read.
    expect(SOURCE).toContain('text.match(/^(\\s*)#(');
  });
});
