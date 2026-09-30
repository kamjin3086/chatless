import { describe, expect, test } from 'vitest';
import { createToolInstructionSuppressor } from '../toolInstructionSuppressor';

describe('toolInstructionSuppressor (regression)', () => {
  test('普通文本含 "<" 不会被误抑制，flush 后完整保留', () => {
    const s = createToolInstructionSuppressor({ guardWindow: 64 });

    const r1 = s.push('<');
    const r2 = s.push('head>');

    expect(r1.visible).toBe('<');
    expect(r2.visible).toBe('head>');

    const f = s.flush();
    expect(f.hadSuppression).toBe(false);
    expect(f.tail).toBe('');
  });

  test('完整工具指令块可被抑制且不泄露到 visible', () => {
    const s = createToolInstructionSuppressor({ guardWindow: 16 });
    const toolXml =
      '<use_mcp_tool><server_name>mcp</server_name><tool_name>search</tool_name><arguments>{"q":"x"}</arguments></use_mcp_tool>';

    const a = s.push('Hello ');
    expect(a.visible).toBe('Hello ');

    const b = s.push(toolXml);
    const c = s.push('DONE');

    expect((b.visible + c.visible)).not.toContain('<use_mcp_tool');
    expect((b.visible + c.visible)).not.toContain('<server_name>');
    expect((b.visible + c.visible)).not.toContain('{"q":"x"}');

    const ended = [b, c].find((x) => x.ended);
    expect(ended).toBeTruthy();
    expect(ended?.captured || '').toContain('</use_mcp_tool>');

    const f = s.flush();
    const out = a.visible + b.visible + c.visible + f.tail;
    expect(out).toContain('Hello ');
    expect(out).toContain('DONE');
    expect(out).not.toContain('<use_mcp_tool');
  });
});
