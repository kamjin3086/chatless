import { describe, expect, it } from 'vitest';
import {
  presentToolCard,
  previewCommand,
  previewResult,
} from '../toolCardPresentation';

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

  it('keeps the front of a long command and drops the tail', () => {
    const preview = previewCommand(PS);
    expect(preview.startsWith('powershell -NoProfile -Command')).toBe(true);
    // Head-and-tail truncation is what produced `... "$(__.Count)" }`: the tail of a
    // script is its closing punctuation, which tells the reader nothing.
    expect(preview).not.toContain('...');
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(71);
  });

  it('collapses the newlines of a multi-line script into one line', () => {
    const preview = previewCommand('set -e\n  make build   && \\\n  make test');
    expect(preview).toBe('set -e make build && make test');
  });

  it('leaves a short command alone', () => {
    expect(previewCommand('ls -la ~/Downloads')).toBe('ls -la ~/Downloads');
  });

  it('cuts on a word boundary so a flag is not sliced in half', () => {
    const preview = previewCommand(`git log ${'--oneline '.repeat(20)}`);
    expect(preview.endsWith('--oneline…')).toBe(true);
  });

  it('shows the command in full when the card is expanded', () => {
    const card = presentToolCard({
      server: 'shell_executor',
      tool: 'execute',
      args: { command: PS },
    });
    expect(card.titleLine).toBe('运行命令');
    expect(card.detailLineFull).toBe(PS);
    expect(card.detailLineShort).toBe(previewCommand(PS));
  });
});

describe('external tool preview', () => {
  it('names what the tool was asked about, not only which tool it was', () => {
    const card = presentToolCard({
      server: 'weather',
      tool: 'get_forecast',
      args: { city: '上海', units: 'metric', lang: 'zh-CN' },
    });
    expect(card.titleLine).toContain('weather');
    expect(card.titleLine).toContain('get_forecast');
    expect(card.detailLineShort).toContain('上海');
    // Settings that tune the call are noise in a one-line preview.
    expect(card.detailLineShort).not.toContain('metric');
    expect(card.detailLineShort).not.toContain('zh-CN');
  });

  it('falls back to the meaningful scalars when no well-known key is present', () => {
    const card = presentToolCard({
      server: 'maps',
      tool: 'search_places',
      args: { search_query: '咖啡馆', max_results: 5, pretty_print: true },
    });
    expect(card.detailLineShort).toContain('咖啡馆');
    expect(card.detailLineShort).not.toContain('pretty_print');
  });

  it('says nothing rather than dumping the argument object', () => {
    const card = presentToolCard({
      server: 'weather',
      tool: 'get_forecast',
      args: { units: 'imperial', page: 2, limit: 10 },
    });
    expect(card.detailLineShort ?? '').toBe('');
  });

  it('never prints a credential held in the arguments', () => {
    const card = presentToolCard({
      server: 'crm',
      tool: 'list_contacts',
      args: { api_key: 'sk-live-abcdef123456', query: '张三' },
    });
    expect(card.detailLineShort).toContain('张三');
    expect(card.detailLineShort ?? '').not.toContain('sk-live');
  });

  it('still prefers a URL over guessing', () => {
    const card = presentToolCard({
      server: 'whatever',
      tool: 'open',
      args: { url: 'https://example.com/a/very/long/path/here' },
    });
    expect(card.titleLine).toBe('访问链接');
    expect(card.detailLineShort).toContain('example.com');
  });

  it('quotes an unknown tool by name when there is nothing else to show', () => {
    const card = presentToolCard({ server: 'weather', tool: 'ping', args: {} });
    expect(card.titleLine).toBe('weather · ping');
    expect(card.detailLineShort ?? '').toBe('');
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
    expect(previewResult(envelope)).toContain('上海：晴，28°C');
    expect(previewResult(envelope)).not.toContain('AAAA');
    expect(previewResult(envelope)).not.toContain('isError');
  });

  it('unwraps a result carried one level deeper', () => {
    expect(
      previewResult({
        result: { content: [{ type: 'text', text: 'Berlin: sunny' }] },
      }),
    ).toBe('Berlin: sunny');
  });

  it('handles a result that arrived as a JSON string', () => {
    expect(previewResult('{"temp_c":28,"city":"上海"}')).toBe(
      'temp_c=28 · city=上海',
    );
  });

  it('shows the scalars of a plain object, not its braces', () => {
    expect(previewResult({ temp_c: 28, city: '上海', hours: [1, 2, 3] })).toBe(
      'temp_c=28 · city=上海 · hours=1、2、3',
    );
  });

  it('counts a list instead of dumping it', () => {
    expect(previewResult([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe('3 项');
  });

  it('leaves prose as prose', () => {
    expect(previewResult('已找到 3 个文件')).toBe('已找到 3 个文件');
  });

  it('keeps a store-side truncation whole instead of squeezing it', () => {
    const result = previewResult({
      summary: 'Object(9000 chars)',
      preview: '{"lots":"of json"}',
    });
    expect(result).toContain('Object(9000 chars)');
    expect(result).toContain('"lots":"of json"');
  });

  it('keeps what it cannot understand rather than hiding it', () => {
    expect(previewResult({ nested: { deep: { deeper: true } } })).toContain(
      'deeper',
    );
  });
});

describe('the previews the owner said were fine', () => {
  it('lists a directory by the directory, unchanged', () => {
    const card = presentToolCard({
      server: 'filesystem',
      tool: 'list_directory',
      args: { path: 'C:/Users/User/Downloads' },
    });
    expect(card.titleLine).toBe('列目录');
    expect(card.detailLineShort).toBe('Downloads');
  });
});
