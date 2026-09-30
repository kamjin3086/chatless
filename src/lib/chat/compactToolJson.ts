export type CompactToolJson = {
  name: string;
  summary: string;
  raw: string;
};

function pickQuery(args: Record<string, unknown>): string | undefined {
  for (const key of ['query', 'q', 'search', 'input', 'text']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function parseCompactToolJson(text: string): CompactToolJson | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return null;

    if (obj.type === 'tool_call' && typeof obj.tool === 'string') {
      const args = (obj.args || obj.parameters || obj.arguments) as Record<string, unknown> | undefined;
      const query = args && typeof args === 'object' ? pickQuery(args) : undefined;
      return {
        name: String(obj.server || obj.tool),
        summary: query || String(obj.tool),
        raw: trimmed,
      };
    }

    if (typeof obj.name === 'string') {
      const args = (obj.arguments || obj.args || obj.parameters) as Record<string, unknown> | undefined;
      const query = args && typeof args === 'object' ? pickQuery(args) : undefined;
      return {
        name: obj.name,
        summary: query || obj.name,
        raw: trimmed,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function splitTextAndToolJson(text: string): Array<{ type: 'text' | 'tool'; text: string; tool?: CompactToolJson }> {
  // 快速路径：没有围栏就不可能有紧凑工具调用，省掉整段正则与 JSON 解析。
  // 唯一例外是"整段就是一个裸 JSON 工具调用"，那种情况要保持原来的识别行为。
  if (!text.includes('```')) {
    const trimmed = text.trim();
    if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return [{ type: 'text', text }];
  }

  const parts: Array<{ type: 'text' | 'tool'; text: string; tool?: CompactToolJson }> = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text))) {
    if (match.index > last) {
      parts.push({ type: 'text', text: text.slice(last, match.index) });
    }
    const inner = (match[1] || '').trim();
    const tool = parseCompactToolJson(inner);
    if (tool) parts.push({ type: 'tool', text: inner, tool });
    else parts.push({ type: 'text', text: match[0] });
    last = match.index + match[0].length;
  }
  const rest = text.slice(last);
  if (rest.trim()) {
    const bare = parseCompactToolJson(rest.trim());
    if (bare && rest.trim() === bare.raw) {
      parts.push({ type: 'tool', text: bare.raw, tool: bare });
    } else {
      parts.push({ type: 'text', text: rest });
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text }];
}
