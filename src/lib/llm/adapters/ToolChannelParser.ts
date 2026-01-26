import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '@/lib/llm/types/stream-events';
import { cleanToolCallInstructionsForDisplay, extractToolCallFromText, extractToolCallsFromText } from '@/lib/chat/tool-call-cleanup';
import { ToolCallDetector } from '@/lib/mcp/ToolCallDetector';
import { createToolInstructionSuppressor } from '@/lib/mcp/toolInstruction/suppressor';


// ============================================================
// 工具指令“跨 chunk”抑制/捕获（用于 GPT-OSS 拆包场景）
// - Provider 会把内容拆成多个 content_token（如 "<|channel|>", "<|message|>", "<json>"...）
// - 若仍按“单 token 解析”，必然解析失败并产生残片/空气泡
// - 这里复用 suppressor：在捕获到完整指令块后立刻产出 tool_call 事件
// ============================================================
const suppressor = createToolInstructionSuppressor({ guardWindow: 64, maxBuffer: 65536 });
let detectBuf = '';

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
    // 流结束：冲刷抑制器尾部（避免“尾巴丢字”，以及捕获到的工具指令漏解析）
    if (ev.type === 'stream_complete') {
      try {
        const flushed = suppressor.flush();
        if (flushed.hadSuppression && flushed.captured) {
          const parsedAll = extractToolCallsFromText(flushed.captured);
          if (parsedAll.length > 0) {
            for (const parsed of parsedAll) {
              out.push(
                createStreamEvent.toolCall(flushed.captured, {
                  serverName: parsed.server,
                  toolName: parsed.tool,
                  arguments: parsed.args ? JSON.stringify(parsed.args) : undefined,
                })
              );
            }
          } else {
            // 兼容兜底：保留旧 parseFirst 行为
            const parsed = extractToolCallFromText(flushed.captured);
            if (parsed?.server && parsed.tool) {
              out.push(
                createStreamEvent.toolCall(flushed.captured, {
                  serverName: parsed.server,
                  toolName: parsed.tool,
                  arguments: parsed.args ? JSON.stringify(parsed.args) : undefined,
                })
              );
            }
          }
        } else if (flushed.tail) {
          const tail = flushed.tail;
          if (tail.trim().length > 0) {
            out.push({ ...ev, type: 'content_token', content: tail } as any);
          }
        }
      } catch { /* noop */ }
      detectBuf = '';
      out.push(ev);
      continue;
    }

    if (ev.type !== 'content_token') {
      out.push(ev);
      continue;
    }

    const raw = ev.content || '';

    // —— 早期抑制阀：先保证 UI 永远看不到工具指令碎片 ——
    const up = suppressor.push(raw);
    if (up.ended && up.captured) {
      try {
        const parsedAll = extractToolCallsFromText(up.captured);
        if (parsedAll.length > 0) {

          for (const parsed of parsedAll) {
            out.push(
              createStreamEvent.toolCall(up.captured, {
                serverName: parsed.server,
                toolName: parsed.tool,
                arguments: parsed.args ? JSON.stringify(parsed.args) : undefined,
              })
            );
          }
          detectBuf = ''; // 捕获命中后清空，避免重复
        } else {
          const parsed = extractToolCallFromText(up.captured);
          if (parsed?.server && parsed.tool) {
            out.push(
              createStreamEvent.toolCall(up.captured, {
                serverName: parsed.server,
                toolName: parsed.tool,
                arguments: parsed.args ? JSON.stringify(parsed.args) : undefined,
              })
            );
            detectBuf = '';
          }
        }
      } catch { /* noop */ }
    }

    const visible = up.visible || '';
    if (!visible) {
      // 纯指令碎片（或 guardWindow 尾巴）被抑制：不向下游输出
      continue;
    }

    // 兜底识别：累积可见文本，处理“未触发抑制器”的变体格式
    detectBuf += visible;
    if (detectBuf.length > 2048) detectBuf = detectBuf.slice(-2048);
    if (!up.ended) {
      try {
        const parsedAll = extractToolCallsFromText(detectBuf);
        if (parsedAll.length > 0) {

          for (const p of parsedAll) {
            out.push(
              createStreamEvent.toolCall(detectBuf, {
                serverName: p.server,
                toolName: p.tool,
                arguments: p.args ? JSON.stringify(p.args) : undefined,
              })
            );
          }
          detectBuf = '';
        } else {
          const p = extractToolCallFromText(detectBuf);
          if (p?.server && p.tool) {
            out.push(
              createStreamEvent.toolCall(detectBuf, {
                serverName: p.server,
                toolName: p.tool,
                arguments: p.args ? JSON.stringify(p.args) : undefined,
              })
            );
            detectBuf = '';
          }
        }
      } catch { /* noop */ }
    }

    // 快速路径：使用统一的 ToolCallDetector 检测
    const detector = ToolCallDetector.getInstance();
    if (!detector.mightContainToolCall(visible)) {
      out.push({ ...ev, content: visible });
      continue;
    }


    // 尝试解析为工具调用
    const parsed = extractToolCallFromText(visible);
    // UI/流式：必须用 display 清理，避免 "<use_mcp_tool" 等半截标签漏到正文
    const cleaned = cleanToolCallInstructionsForDisplay(visible);


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
      visible,
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
