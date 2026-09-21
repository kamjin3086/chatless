import { describe, expect, it } from 'vitest';
import { TOOL_GROUPS, getToolsForGroup } from '@/lib/mcp/nativeTools/toolRegistry';
import { buildResultPreview } from '@/lib/mcp/toolResultAttachments';

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
});
