import { describe, expect, it } from 'vitest';
import {
  presentToolCard,
  previewCommand,
  previewResult,
} from '../toolCardPresentation';
import { translate } from '@/i18n';

/**
 * The one-line tool row is the only part of a tool call most users read. The two shapes
 * that were unreadable in practice are pinned here: a shell command cut in the middle, and
 * an external (MCP) tool that named itself but said nothing about what it was asked.
 */
describe('command preview', () => {
  const PS =
    "powershell -NoProfile -Command \"$exts=@('jpg','png','gif','webp'); " +
    '(Get-ChildItem -Path $env:USERPROFILE\\Downloads -File | ' +
    'Where-Object { $exts -contains $_.Extension } | Measure-Object) | ForEach-Object { \\"$($_.Count)\\" }"';

  it('collapses a long command onto one line and lets the row do the cutting', () => {
    // A character cap in the data was the wrong place for this: the row knows how much
    // room it has, the window knows it better than a constant, and a fixed cut throws
    // away text a wide window could have shown.
    const preview = previewCommand(PS);
    expect(preview.startsWith('powershell -NoProfile -Command')).toBe(true);
    expect(preview).not.toContain('...');
    expect(preview).not.toContain('\n');
    expect(preview).toContain('$env:USERPROFILE');
  });

  it('collapses the newlines of a multi-line script into one line', () => {
    const preview = previewCommand('set -e\n  make build   && \\\n  make test');
    expect(preview).toBe('set -e make build && make test');
  });

  it('leaves a short command alone', () => {
    expect(previewCommand('ls -la ~/Downloads')).toBe('ls -la ~/Downloads');
  });

  it('does not invent an ellipsis the row will draw anyway', () => {
    expect(previewCommand(`git log ${'--oneline '.repeat(20)}`)).not.toContain(
      '…',
    );
  });

  it('shows the command in full when the card is expanded', () => {
    const card = presentToolCard('zh', {
      server: 'shell_executor',
      tool: 'execute',
      args: { command: PS },
    });
    expect(card.titleLine).toBe('运行');
    expect(card.detailLineFull).toBe(PS);
    expect(card.detailLineShort).toBe(previewCommand(PS));
  });
});

describe('external tool preview', () => {
  it('reads as a sentence about what was asked', () => {
    const card = presentToolCard('zh', {
      server: 'weather',
      tool: 'get_forecast',
      args: { city: '上海', units: 'metric', lang: 'zh-CN' },
    });
    expect(card.titleLine).toBe('天气查询');
    // The title already names the call, so the detail is the value: `天气查询 上海`, not
    // `天气查询 → city=上海`.
    expect(card.detailLineShort).toBe('上海');
    // Settings that tune the call are noise in a one-line preview.
    expect(card.detailLineShort).not.toContain('metric');
    expect(card.detailLineShort).not.toContain('zh-CN');
  });

  it('falls back to the meaningful scalars when no well-known key is present', () => {
    const card = presentToolCard('zh', {
      server: 'maps',
      tool: 'search_places',
      args: { search_query: '咖啡馆', max_results: 5, pretty_print: true },
    });
    expect(card.detailLineShort).toContain('咖啡馆');
    expect(card.detailLineShort).not.toContain('pretty_print');
  });

  it('says nothing rather than dumping the argument object', () => {
    const card = presentToolCard('zh', {
      server: 'weather',
      tool: 'get_forecast',
      args: { units: 'imperial', page: 2, limit: 10 },
    });
    expect(card.detailLineShort ?? '').toBe('');
  });

  it('never prints a credential held in the arguments', () => {
    const card = presentToolCard('zh', {
      server: 'crm',
      tool: 'list_contacts',
      args: { api_key: 'sk-live-abcdef123456', query: '张三' },
    });
    expect(card.detailLineShort).toContain('张三');
    expect(card.detailLineShort ?? '').not.toContain('sk-live');
  });

  it('still prefers a URL over guessing', () => {
    const card = presentToolCard('zh', {
      server: 'whatever',
      tool: 'open',
      args: { url: 'https://example.com/a/very/long/path/here' },
    });
    expect(card.titleLine).toBe('访问链接');
    expect(card.detailLineShort).toContain('example.com');
  });

  it('quotes an unknown tool by name when there is nothing else to show', () => {
    const card = presentToolCard('zh', {
      server: 'weather',
      tool: 'ping',
      args: {},
    });
    expect(card.titleLine).toBe('weather · ping');
    expect(card.detailLineShort ?? '').toBe('');
  });

  it('keeps the raw name when no verb can be guessed safely', () => {
    // A confident wrong verb reads worse than `srvr · do_thing`, so the vocabulary stays
    // short and everything it does claim is pinned here.
    expect(
      presentToolCard('zh', {
        server: 'jira',
        tool: 'transition_issue',
        args: {},
      }).titleLine,
    ).toBe('jira · transition_issue');
  });
});

describe('result preview', () => {
  it('reads the text an external tool actually returned', () => {
    // An MCP result is an envelope; printing it is what made a weather query unreadable.
    const envelope = {
      content: [
        { type: 'text', text: '上海：晴，28°C，湿度 60%' },
        { type: 'image', data: 'AAAA' },
      ],
      isError: false,
    };
    expect(previewResult('zh', envelope)).toContain('上海：晴，28°C');
    expect(previewResult('zh', envelope)).not.toContain('AAAA');
    expect(previewResult('zh', envelope)).not.toContain('isError');
  });

  it('unwraps a result carried one level deeper', () => {
    expect(
      previewResult('zh', {
        result: { content: [{ type: 'text', text: 'Berlin: sunny' }] },
      }),
    ).toBe('Berlin: sunny');
  });

  it('handles a result that arrived as a JSON string', () => {
    expect(previewResult('zh', '{"temp_c":28,"city":"上海"}')).toBe(
      'temp_c=28 · city=上海',
    );
  });

  it('shows the scalars of a plain object, not its braces', () => {
    expect(
      previewResult('zh', { temp_c: 28, city: '上海', hours: [1, 2, 3] }),
    ).toBe('temp_c=28 · city=上海 · hours=1、2、3');
  });

  it('counts a list instead of dumping it', () => {
    expect(previewResult('zh', [{ id: 1 }, { id: 2 }, { id: 3 }])).toBe('3 项');
  });

  it('leaves prose as prose', () => {
    expect(previewResult('zh', '已找到 3 个文件')).toBe('已找到 3 个文件');
  });

  it('keeps a store-side truncation whole instead of squeezing it', () => {
    const result = previewResult('zh', {
      summary: 'Object(9000 chars)',
      preview: '{"lots":"of json"}',
    });
    expect(result).toContain('Object(9000 chars)');
    expect(result).toContain('"lots":"of json"');
  });

  it('keeps what it cannot understand rather than hiding it', () => {
    expect(
      previewResult('zh', { nested: { deep: { deeper: true } } }),
    ).toContain('deeper');
  });
});

describe('localized tool card presentation', () => {
  it.each([
    [
      {
        server: 'shell_executor',
        tool: 'execute',
        args: { command: 'ls ~/资料' },
      },
      'Run',
      'Command',
      'ls ~/资料',
    ],
    [
      {
        server: 'filesystem',
        tool: 'read_file',
        args: { path: '/工作/notes.md' },
      },
      'Read file',
      'Path',
      '/工作/notes.md',
    ],
    [
      { server: 'web', tool: 'search', args: { query: '上海 天气' } },
      'Search the web',
      'Query',
      '上海 天气',
    ],
    [
      { server: 'skill', tool: 'get_template', args: { name: '报告.md' } },
      'Get template',
      'File',
      '报告.md',
    ],
    [
      { server: 'system', tool: 'get_prompt', args: { name: '我的提示词' } },
      'Get prompt',
      'Name',
      '我的提示词',
    ],
    [
      {
        server: 'weather',
        tool: 'get_forecast',
        args: { city: '上海', units: 'metric' },
      },
      'Check weather',
      'Arguments',
      '上海',
    ],
  ] as const)(
    'translates %j without translating its detail value',
    (params, titleLine, detailLineLabel, detailLineFull) => {
      expect(presentToolCard('en', params)).toMatchObject({
        titleLine,
        detailLineLabel,
        detailLineFull,
      });
      expect(presentToolCard('zh', params).detailLineFull).toBe(detailLineFull);
    },
  );

  it('translates generated context and group summaries but preserves their arguments', () => {
    expect(
      presentToolCard('en', {
        server: 'ctx',
        tool: 'get',
        args: { type: 'errors' },
      }),
    ).toMatchObject({
      titleLine: 'Retrieve errors',
      detailLineLabel: 'Type',
      detailLineFull: 'errors',
      detailLineShort: 'Errors',
    });
    expect(
      presentToolCard('en', {
        server: 'tools',
        tool: 'load',
        args: { group: 'fs_extra' },
      }),
    ).toMatchObject({
      titleLine: 'Load tool group',
      detailLineLabel: 'Group',
      detailLineFull: 'fs_extra',
      detailLineShort: 'File management',
    });
    expect(
      presentToolCard('en', {
        server: 'ctx',
        tool: 'update_step',
        args: { stepIndex: 2, status: 'blocked $& {index}' },
      }),
    ).toMatchObject({
      titleLine: 'Update progress',
      detailLineLabel: 'Step',
      detailLineFull: 'Step 2: blocked $& {index}',
      detailLineShort: 'Step 2',
    });
  });

  it.each(['自定义 $&', 'constructor'])(
    'preserves an unknown tool group %s in both locales',
    (group) => {
      const params = { server: 'tools', tool: 'load', args: { group } };
      for (const locale of ['zh', 'en'] as const) {
        expect(presentToolCard(locale, params)).toMatchObject({
          detailLineFull: group,
          detailLineShort: group,
        });
      }
    },
  );

  it('preserves raw server names, tool names, paths, and URLs in fallbacks', () => {
    const server = 'Service $&';
    const tool = 'do_thing';
    const path = '/资料/example.md';
    const url = 'https://example.com/?key=$&';
    expect(presentToolCard('en', { server, tool }).titleLine).toBe(
      `${server} · ${tool}`,
    );
    expect(
      presentToolCard('en', { server, tool, args: { path } }),
    ).toMatchObject({
      titleLine: `${server} operation`,
      detailLineFull: path,
      detailLineShort: 'example.md',
    });
    expect(
      presentToolCard('en', { server, tool, args: { url } }),
    ).toMatchObject({
      titleLine: 'Open link',
      detailLineFull: url,
      detailLineShort: url,
    });
  });

  it('localizes generated result summaries, not tool-returned content', () => {
    expect(previewResult('en', '[]')).toBe('0 items');
    expect(previewResult('en', '[{"id":1}]')).toBe('1 item');
    expect(previewResult('en', '[{"id":1},{"id":2}]')).toBe('2 items');
    expect(previewResult('en', { places: ['上海', 'Berlin'] })).toBe(
      'places=上海, Berlin',
    );
    expect(
      previewResult('en', {
        content: [{ type: 'text', text: '上海：晴，28°C' }],
      }),
    ).toBe('上海：晴，28°C');
  });
});

describe('the previews the owner said were fine', () => {
  it('lists a directory by the directory, unchanged', () => {
    const card = presentToolCard('zh', {
      server: 'filesystem',
      tool: 'list_directory',
      args: { path: 'C:/Users/User/Downloads' },
    });
    expect(card.titleLine).toBe('列目录');
    expect(card.detailLineShort).toBe('Downloads');
  });
});

/**
 * Names the tool set no longer has (`skill__use` and its siblings, removed in PR #230)
 * still sit in stored conversations. The call already carries its result, so nothing is
 * lost - but a card that says "read the guide" for a call that could not be routed reads
 * as data loss. The card says retired instead: display only, never a route.
 */
describe('skill tool names that no longer exist (#236)', () => {
  const RETIRED = ['use', 'get', 'list_files', 'read_file', 'write_file'];

  for (const tool of RETIRED) {
    it(`says the tool is gone rather than guessing what it did: skill__${tool}`, () => {
      for (const locale of ['zh', 'en'] as const) {
        const card = presentToolCard(locale, {
          server: 'skill',
          tool,
          args: { name: 'grilling' },
        });
        expect(card.titleLine).toBe(
          translate(locale, 'toolCall.retiredSkillTool'),
        );
        expect(card.detailLineFull).toContain(tool);
      }
    });
  }

  it('keeps the names that still exist rendering as they did', () => {
    expect(
      presentToolCard('zh', {
        server: 'skill',
        tool: 'guide',
        args: { id: 'grilling' },
      }).titleLine,
    ).toBe(translate('zh', 'toolCall.getSkillGuide'));
    expect(
      presentToolCard('zh', {
        server: 'skill',
        tool: 'list_resources',
        args: { id: 'grilling' },
      }).titleLine,
    ).toBe(translate('zh', 'toolCall.listSkillResources'));
  });

  it('retires nothing on the external skills server', () => {
    // `skills` (plural) is an MCP server whose tool names are the package's own; only the
    // built-in `skill` server lost these names.
    expect(
      presentToolCard('zh', {
        server: 'skills',
        tool: 'use',
        args: { name: 'x' },
      }).titleLine,
    ).toBe(translate('zh', 'toolCall.getSkillGuide'));
  });
});
