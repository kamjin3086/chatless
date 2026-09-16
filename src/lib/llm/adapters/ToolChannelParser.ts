import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '@/lib/llm/types/stream-events';
import { extractToolCallFromText, extractToolCallsFromText } from '@/lib/chat/tool-call-cleanup';

/**
 * 工具通道解析器（每个 stream 独立实例，避免并发/重试时状态污染）
 *
 * 支持格式：
 * - GPT-OSS: <|channel|>commentary to=server__tool ... {json}
 * - XML: <tool_call>...</tool_call>, <use_mcp_tool>...</use_mcp_tool>
 * - JSON: {"server":"...", "tool":"..."}
 */

const TOOL_START_PATTERNS = [
  '<|channel|>',
  '<tool_call>',
  '<use_mcp_tool>',
  '{"server":',
  '{"tool":',
];

function startsWithToolPattern(text: string): boolean {
  const trimmed = text.trimStart();
  return TOOL_START_PATTERNS.some((p) => trimmed.startsWith(p));
}

function containsToolStart(text: string): boolean {
  return TOOL_START_PATTERNS.some((p) => text.includes(p));
}

export class ToolChannelParser {
  private contentBuffer = '';
  private suppressing = false;

  reset(): void {
    this.contentBuffer = '';
    this.suppressing = false;
  }

  rewriteEvents(events: StreamEvent[]): StreamEvent[] {
    if (!Array.isArray(events) || events.length === 0) return events;

    const out: StreamEvent[] = [];

    for (const ev of events) {
      if (ev.type === 'stream_complete') {
        try {
          if (this.contentBuffer) {
            const toolCalls = extractToolCallsFromText(this.contentBuffer);

            if (toolCalls.length > 0) {
              for (const tc of toolCalls) {
                out.push(
                  createStreamEvent.toolCall(this.contentBuffer, {
                    serverName: tc.server,
                    toolName: tc.tool,
                    arguments: tc.args ? JSON.stringify(tc.args) : undefined,
                  })
                );
              }
            } else {
              const tc = extractToolCallFromText(this.contentBuffer);
              if (tc?.server && tc.tool) {
                out.push(
                  createStreamEvent.toolCall(this.contentBuffer, {
                    serverName: tc.server,
                    toolName: tc.tool,
                    arguments: tc.args ? JSON.stringify(tc.args) : undefined,
                  })
                );
              }
            }
          }
        } catch {
          // 解析失败时仍应结束流，不泄漏 buffer
        }

        this.reset();
        out.push(ev);
        continue;
      }

      if (ev.type !== 'content_token') {
        out.push(ev);
        continue;
      }

      const content = ev.content || '';
      if (!content) continue;

      this.contentBuffer += content;

      if (!this.suppressing) {
        if (startsWithToolPattern(this.contentBuffer) || containsToolStart(this.contentBuffer)) {
          this.suppressing = true;
          continue;
        }
      }

      if (this.suppressing) {
        continue;
      }

      out.push(ev);
    }

    return out;
  }
}

/** @deprecated 使用 ToolChannelParser 实例，避免跨 stream 共享状态 */
export function rewriteEventsWithToolCalls(events: StreamEvent[]): StreamEvent[] {
  const parser = new ToolChannelParser();
  return parser.rewriteEvents(events);
}
