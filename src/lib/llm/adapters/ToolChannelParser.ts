import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '@/lib/llm/types/stream-events';
import { cleanToolCallInstructions, extractToolCallFromText } from '@/lib/chat/tool-call-cleanup';
import { ToolCallDetector } from '@/lib/mcp/ToolCallDetector';

/**
 * 工具通道解析器
 *
 * 职责：
 * - 从 content_token 中识别并剥离工具调用指令
 * - 将工具指令转换为结构化的 tool_call 事件
 * - 确保下游（Store/UI）永远不会看到原始指令文本
 *
 * 兼容格式：
 * - GPT‑OSS: <|channel|>commentary to=server[.tool] ... {json}
 * - XML:    <tool_call>...</tool_call> / <use_mcp_tool>...</use_mcp_tool>
 * - JSON:   {"type":"tool_call", ...}
 */
export function rewriteEventsWithToolCalls(events: StreamEvent[]): StreamEvent[] {
  if (!Array.isArray(events) || events.length === 0) return events;

  const out: StreamEvent[] = [];

  for (const ev of events) {
    if (ev.type !== 'content_token') {
      out.push(ev);
      continue;
    }

    const raw = ev.content || '';

    // 快速路径：使用统一的 ToolCallDetector 检测
    const detector = ToolCallDetector.getInstance();
    if (!detector.mightContainToolCall(raw)) {
      out.push(ev);
      continue;
    }

    // 尝试解析为工具调用
    const parsed = extractToolCallFromText(raw);
    const cleaned = cleanToolCallInstructions(raw);

    // 若解析失败，仅输出清理过的文本
    if (!parsed || !parsed.server || !parsed.tool) {
      if (cleaned && cleaned.trim().length > 0) {
        out.push({ ...ev, content: cleaned });
      }
      continue;
    }

    // 1) 先输出“去除了指令后的正文”（若还有的话）
    if (cleaned && cleaned.trim().length > 0) {
      out.push({ ...ev, content: cleaned });
    }

    // 2) 再追加一个结构化的 tool_call 事件
    const toolEvent = createStreamEvent.toolCall(
      raw,
      {
        serverName: parsed.server,
        toolName: parsed.tool,
        arguments: parsed.args ? JSON.stringify(parsed.args) : undefined,
      }
    );
    out.push(toolEvent);
  }

  return out;
}



