/**
 * The thinking preview is one line of text under the "正在思考" header, and it used to be
 * conditional on its *own* content: `displayText.trim()` was empty whenever the streamed
 * thinking ended on a newline, which is often - every chunk boundary that lands after a line
 * break unmounted that row and the next token mounted it again. Content below moved up and
 * back down at token speed; the wrapper's `layout` animation turned each of those into a
 * visible 180 ms bounce.
 *
 * So the rule to pin is: while thinking, the preview row keeps its height whatever the tail
 * of the streamed text looks like. The preview also keeps the last *non-empty* line, so a
 * newline does not blank it.
 */
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ThinkingBar } from '../ThinkingBar';

beforeAll(() => vi.stubGlobal('React', React));

const PREVIEW = 'data-thinking-preview';

function render(content: string): string {
  return renderToStaticMarkup(
    createElement(ThinkingBar, {
      thinkingContent: content,
      durationSeconds: 3,
      isActive: true,
    }),
  );
}

/** The preview row's text, or null when the row is not in the markup at all. */
function preview(html: string): string | null {
  const match = new RegExp(`${PREVIEW}[^>]*>([^<]*)<`).exec(html);
  return match ? match[1] : null;
}

describe('the thinking preview keeps its line', () => {
  it('shows the last line while the stream is mid-sentence', () => {
    expect(preview(render('first thought\nsecond tho'))).toContain('second');
  });

  it('keeps the previous line when the stream ends on a newline', () => {
    // The old code rendered nothing here, so the row vanished until the next token.
    expect(preview(render('first thought\n'))).toContain('first thought');
    expect(preview(render('first thought\n\n\n'))).toContain('first thought');
    expect(preview(render('a\nb\n'))).toContain('b');
  });

  it('renders the row at all only once there is content', () => {
    expect(preview(render(''))).toBeNull();
    expect(preview(render('   \n  '))).toBeNull();
  });

  it('trims the preview, so indentation does not look like a layout bug', () => {
    expect(preview(render('  indented line'))).toBe('indented line');
  });
});
