import { createToolInstructionSuppressor } from '../toolInstructionSuppressor';

describe('toolInstructionSuppressor (regression)', () => {
  test('普通文本被拆包："<" + "head>" 不应丢失 "<"（flush 后应完整）', () => {
    const s = createToolInstructionSuppressor({ guardWindow: 64 });

    const r1 = s.push('<');
    const r2 = s.push('head>');

    // guardWindow 机制会暂存尾部，不保证立刻可见；但绝不能“吞字”
    expect(r1.visible).toBe('');
    expect(r2.visible).toBe('');

    const f = s.flush();
    expect(f.hadSuppression).toBe(false);
    expect(f.tail).toBe('<head>');
  });

  test('工具指令被拆包：触发后全程不泄露指令文本，并能捕获完整指令块', () => {
    // 使用较小窗口，减少测试中“等待输出”的干扰（实现内部最小 16）
    const s = createToolInstructionSuppressor({ guardWindow: 16 });

    // 先来一段正常文本
    const a = s.push('Hello ');
    // 快速路径：纯文本应立即可见（不应被 guardWindow 拖延）
    expect(a.visible).toBe('Hello ');

    // 拆包的工具调用 XML
    const b = s.push('<use_mcp_');
    const c = s.push('tool><server_name>mcp</server_name><tool_name>search</tool_name><arguments>{"q":"x"}</arguments>');
    const d = s.push('</use_mcp_tool>DONE');

    // 一旦触发进入抑制态，不应把指令内容透传为 visible
    expect((b.visible + c.visible + d.visible)).not.toContain('<use_mcp_tool');
    expect((b.visible + c.visible + d.visible)).not.toContain('<server_name>');
    expect((b.visible + c.visible + d.visible)).not.toContain('{"q":"x"}');

    // 结束时应标记 ended，并给出 captured（包含闭合标签）
    const ended = [b, c, d].find(x => x.ended);
    expect(ended).toBeTruthy();
    expect(ended?.captured || '').toContain('<use_mcp_tool');
    expect(ended?.captured || '').toContain('</use_mcp_tool>');

    // flush 兜底：应当能看到普通文本与 DONE（指令不应出现）
    const f = s.flush();
    const out = (a.visible + b.visible + c.visible + d.visible + f.tail);
    expect(out).toContain('Hello ');
    expect(out).toContain('DONE');
    expect(out).not.toContain('<use_mcp_tool');
  });
});


