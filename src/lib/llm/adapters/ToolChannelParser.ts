import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '@/lib/llm/types/stream-events';
import { extractToolCallFromText, extractToolCallsFromText } from '@/lib/chat/tool-call-cleanup';

/**
 * 简化版工具通道解析器
 * 
 * 设计原则：
 * 1. 无复杂状态机，只用简单的缓冲区累积
 * 2. 流式期间检测工具指令特征，抑制可能的工具指令内容
 * 3. 在 stream_complete 时统一解析，生成 tool_call 事件
 * 
 * 支持格式：
 * - GPT-OSS: <|channel|>commentary to=server__tool ... {json}
 * - XML: <tool_call>...</tool_call>, <use_mcp_tool>...</use_mcp_tool>
 * - JSON: {"server":"...", "tool":"..."}
 */

// 累积缓冲区，用于在流结束时解析工具调用
let contentBuffer = '';
// 标记是否正在抑制（检测到工具指令开始）
let suppressing = false;
// 抑制开始的位置（用于在结束时提取工具指令）
let suppressionStartIndex = 0;

// 工具指令起始模式
const TOOL_START_PATTERNS = [
  '<|channel|>',           // GPT-OSS 格式
  '<tool_call>',           // XML 格式
  '<use_mcp_tool>',        // XML 格式
  '{"server":',            // JSON 格式
  '{"tool":',              // JSON 格式变体
];

// 检查文本是否以工具指令开始
function startsWithToolPattern(text: string): boolean {
  const trimmed = text.trimStart();
  return TOOL_START_PATTERNS.some(p => trimmed.startsWith(p));
}

// 检查文本是否确定包含工具指令开始（必须是完整匹配）
function containsToolStart(text: string): boolean {
  return TOOL_START_PATTERNS.some(p => text.includes(p));
}

// 检查文本是否以工具指令的部分前缀结尾（跨 chunk 场景，需要等待更多内容）
function endsWithPartialToolPattern(text: string): { partial: boolean; minLength: number } {
  for (const pattern of TOOL_START_PATTERNS) {
    // 检查是否以 pattern 的前缀结尾（至少 2 个字符才算有意义的前缀）
    for (let i = 2; i < pattern.length; i++) {
      if (text.endsWith(pattern.slice(0, i))) {
        return { partial: true, minLength: pattern.length - i };
      }
    }
  }
  return { partial: false, minLength: 0 };
}

// 重置状态
function reset(): void {
  contentBuffer = '';
  suppressing = false;
  suppressionStartIndex = 0;
}

/**
 * 重写事件流，处理工具调用
 */
export function rewriteEventsWithToolCalls(events: StreamEvent[]): StreamEvent[] {
  if (!Array.isArray(events) || events.length === 0) return events;

  const out: StreamEvent[] = [];

  for (const ev of events) {
    // 流结束：解析累积的内容，生成工具调用事件
    if (ev.type === 'stream_complete') {

      try {
        if (contentBuffer) {
          // 尝试从累积内容中提取工具调用
          const toolCalls = extractToolCallsFromText(contentBuffer);
          
          if (toolCalls.length > 0) {
            for (const tc of toolCalls) {

              out.push(
                createStreamEvent.toolCall(contentBuffer, {
                  serverName: tc.server,
                  toolName: tc.tool,
                  arguments: tc.args ? JSON.stringify(tc.args) : undefined,
                })
              );
            }
          } else {
            // 兜底：尝试单个解析
            const tc = extractToolCallFromText(contentBuffer);
            if (tc?.server && tc.tool) {

              out.push(
                createStreamEvent.toolCall(contentBuffer, {
                  serverName: tc.server,
                  toolName: tc.tool,
                  arguments: tc.args ? JSON.stringify(tc.args) : undefined,
                })
              );
            }
          }
        }
      } catch (e) {

      }
      
      // 重置状态
      reset();
      out.push(ev);
      continue;
    }

    // 非内容事件：直接透传
    if (ev.type !== 'content_token') {
      out.push(ev);
      continue;
    }

    const content = ev.content || '';
    if (!content) continue;

    // 累积到缓冲区
    contentBuffer += content;

    // 检查是否应该开始抑制
    // 只有当确定检测到工具指令开始时才抑制（完整模式匹配）
    if (!suppressing) {
      if (startsWithToolPattern(contentBuffer) || containsToolStart(contentBuffer)) {
        suppressing = true;
        suppressionStartIndex = contentBuffer.length - content.length;

        // 不输出任何内容
        continue;
      }
    }

    // 如果正在抑制，不输出内容
    if (suppressing) {

      continue;
    }

    // 正常内容：直接透传
    out.push(ev);
  }

  return out;
}
