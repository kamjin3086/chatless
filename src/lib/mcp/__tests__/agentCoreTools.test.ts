import { describe, expect, it } from 'vitest';
import { TOOL_GROUPS, getToolsForGroup } from '@/lib/mcp/nativeTools/toolRegistry';
import { buildResultPreview, safeSlice } from '@/lib/mcp/toolResultAttachments';

describe('agent tool surface', () => {
  it('offers the codable core: filesystem edit/search and background processes', () => {
    const core = getToolsForGroup('core').map(({ server, tool }) => `${server}__${tool.name}`);

    expect(core).toEqual(expect.arrayContaining([
      'fs__read', 'fs__write', 'fs__edit', 'fs__search', 'fs__ls',
      'shell__run', 'shell__start', 'shell__logs', 'shell__stop', 'shell__list',
    ]));
  });

  it('no longer exposes the retired Coding Pack', () => {
    expect(TOOL_GROUPS.some((group) => group.id === 'coding')).toBe(false);
    const everyTool = TOOL_GROUPS.flatMap((group) => group.tools.map(({ server }) => server));
    expect(everyTool).not.toContain('code');
  });
});

describe('large tool result preview', () => {
  it('keeps both ends so a late error stays visible', () => {
    // A build prints progress first and the cause last: the tail must survive.
    const body = `${'a'.repeat(60_000)}\nBUILD FAILED: missing module\n`;
    const preview = buildResultPreview(body);

    expect(preview.startsWith('a'.repeat(100))).toBe(true);
    expect(preview).toContain('BUILD FAILED');
    expect(preview).toContain('已省略');
    expect(preview.length).toBeLessThan(9_000);
  });

  it('returns short results untouched', () => {
    expect(buildResultPreview('all done')).toBe('all done');
  });

  it('never splits an emoji in half when cutting head and tail', () => {
    // Regression: the preview of a Downloads listing cut an emoji in a file
    // name, leaving a lone surrogate.  Serialized into a request body that
    // becomes a \udXXX escape real providers cannot encode, and the whole
    // request is rejected with HTTP 400.
    // 8000 + 2 + 3999 puts the tail boundary inside the emoji's surrogate pair.
    const body = `${'a'.repeat(8_000)}👻${'b'.repeat(3_999)}`;
    const preview = buildResultPreview(body);

    expectHasNoLoneSurrogate(preview);
    expect(preview).toContain('👻');
  });

  it('keeps surrogate pairs intact when slicing at arbitrary offsets', () => {
    const text = '🎃 pumpkin';

    // Offset 1 points at the low half of the emoji: the pair is pulled back in
    // rather than emitted half-formed.
    const sliced = safeSlice(text, 1, 4);
    expect(sliced.startsWith('🎃')).toBe(true);
    expectHasNoLoneSurrogate(sliced);
    expectHasNoLoneSurrogate(safeSlice(text, 2));
  });
});

function expectHasNoLoneSurrogate(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`lone high surrogate at ${index}`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`lone low surrogate at ${index}`);
    }
  }
}
