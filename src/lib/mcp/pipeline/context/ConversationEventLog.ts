import type { Message as LlmMessage } from '@/lib/llm/types';
import type { ToolCallRequest } from '@/lib/llm/types/tool-schema';

export type ContextChangeKind = 'permissions' | 'environment' | 'tools' | 'other';

export type ConversationEvent =
  | { type: 'user_message'; content: string; inputId?: string }
  | { type: 'queued_user_input'; inputId: string; content: string }
  | { type: 'assistant_message'; content: string }
  | {
      type: 'tool_call_requested';
      callId?: string;
      cardId?: string;
      server: string;
      tool: string;
      args?: Record<string, unknown>;
      providerData?: Record<string, unknown>;
    }
  | {
      /** Persisted immediately before the executor can cause an effect. */
      type: 'tool_call_started';
      callId?: string;
      cardId?: string;
      server: string;
      tool: string;
      args?: Record<string, unknown>;
    }
  | {
      type: 'tool_call_output';
      callId?: string;
      cardId?: string;
      server: string;
      tool: string;
      args?: Record<string, unknown>;
      output: unknown;
      isError?: boolean;
    }
  | { type: 'context_change'; kind: ContextChangeKind; content: string };

export type RenderMode = 'text_wrapper' | 'tool_role';

/**
 * ConversationEventLog 是“上下文一等公民”的最小实现：
 * - 记录事件（消息、tool call、tool output、环境/权限变化）
 * - 提供渲染函数，将事件投影为 ChatCompletions messages[]
 *
 * 说明：
 * - 默认使用 text_wrapper（对所有 Provider 最兼容）。
 * - 当上游具备 tool_call_id（来自 streaming delta.tool_calls），且下游 Provider 支持 tool role 时，
 *   可使用 tool_role，把结果作为 `role:"tool"` 回填到 ChatCompletions messages[]。
 */
export class ConversationEventLog {
  private events: ConversationEvent[] = [];

  snapshot(): ConversationEvent[] {
    return [...this.events];
  }

  append(event: ConversationEvent) {
    this.events.push(event);
  }

  appendUserMessage(content: string) {
    this.append({ type: 'user_message', content: String(content ?? '') });
  }

  appendAssistantMessage(content: string) {
    this.append({ type: 'assistant_message', content: String(content ?? '') });
  }

  appendToolCallRequested(params: Omit<Extract<ConversationEvent, { type: 'tool_call_requested' }>, 'type'>) {
    this.append({ type: 'tool_call_requested', ...params });
  }

  appendToolCallOutput(params: Omit<Extract<ConversationEvent, { type: 'tool_call_output' }>, 'type'>) {
    this.append({ type: 'tool_call_output', ...params });
  }

  appendContextChange(kind: ContextChangeKind, content: string) {
    this.append({ type: 'context_change', kind, content: String(content ?? '') });
  }

  renderForModel(mode: RenderMode = 'text_wrapper'): LlmMessage[] {
    const out: LlmMessage[] = [];

    if (mode === 'tool_role') {
      // 最小协议化实现：tool_call_requested -> assistant.tool_calls；tool_call_output -> role=tool（tool_call_id）
      const pending: ToolCallRequest[] = [];
      let pendingProviderData: Record<string, unknown> | undefined;
      let didEmitAssistantForPending = false;

      for (const e of this.events) {
        if (e.type === 'queued_user_input') continue;
        if (e.type === 'user_message') {
          out.push({ role: 'user', content: e.content });
          continue;
        }
        if (e.type === 'assistant_message') {
          out.push({ role: 'assistant', content: e.content });
          continue;
        }
        if (e.type === 'context_change') {
          out.push({ role: 'system', content: e.content });
          continue;
        }
        if (e.type === 'tool_call_requested') {
          const id = e.callId && String(e.callId).trim() ? String(e.callId).trim() : `call_${pending.length}`;
          pending.push({
            id,
            type: 'function',
            function: {
              name: `${e.server}__${e.tool}`,
              arguments: safeJson(e.args || {}),
            },
            providerData: e.providerData,
          });
          if (e.providerData && typeof e.providerData === 'object') {
            pendingProviderData = e.providerData;
          }
          didEmitAssistantForPending = false;
          continue;
        }
        if (e.type === 'tool_call_started') {
          continue;
        }
        if (e.type === 'tool_call_output') {
          const id = e.callId && String(e.callId).trim() ? String(e.callId).trim() : undefined;

          if (pending.length > 0 && !didEmitAssistantForPending) {
            const previous = out.at(-1);
            if (previous?.role === 'assistant' && !previous.tool_calls?.length) {
              previous.tool_calls = [...pending];
              previous.providerData = pendingProviderData;
            } else {
              out.push({ role: 'assistant', content: '', tool_calls: [...pending], providerData: pendingProviderData });
            }
            pending.splice(0, pending.length);
            pendingProviderData = undefined;
            didEmitAssistantForPending = true;
          }

          // 没有 tool_call_id 时无法走原生语义，退化为 text_wrapper
          if (!id) {
            const content = [
              '【工具调用结果】',
              `工具: ${e.server}.${e.tool}`,
              `参数: ${safeJson(e.args || {})}`,
              `结果: ${safeJson(e.output)}`,
            ].join('\n');
            out.push({ role: 'user', content });
            continue;
          }

          const content = typeof e.output === 'string' ? e.output : safeJson(e.output);
          out.push({ role: 'tool', content, tool_call_id: id, name: `${e.server}__${e.tool}` });
          continue;
        }
      }

      // A run can stop after persisting a model request (or execution start)
      // and before a durable result exists.  Preserve that fact in the next
      // model context instead of silently omitting it, which could invite an
      // unsafe replay of a write or external action.
      if (pending.length > 0) {
        out.push({ role: 'assistant', content: '', tool_calls: [...pending], providerData: pendingProviderData });
        for (const request of pending) {
          out.push({
            role: 'tool',
            content: safeJson({
              ok: false,
              resultStatus: 'unknown',
              error: {
                code: 'EXECUTION_UNKNOWN',
                message: 'The previous run ended before this tool result was durably recorded. Verify its effect before retrying.',
              },
            }),
            tool_call_id: request.id,
            name: request.function.name,
          });
        }
      }

      return out;
    }

    // 默认 text_wrapper（与旧逻辑兼容）
    const pendingTextRequests: Array<Extract<ConversationEvent, { type: 'tool_call_requested' }>> = [];
    const completedTextCalls = new Set<string>();
    for (const e of this.events) {
      if (e.type === 'queued_user_input') continue;
      if (e.type === 'user_message') {
        out.push({ role: 'user', content: e.content });
        continue;
      }
      if (e.type === 'assistant_message') {
        out.push({ role: 'assistant', content: e.content });
        continue;
      }
      if (e.type === 'context_change') {
        // context_change 用 developer 语义更合理，但项目当前 Message.role 仅 user/assistant/system。
        // 这里用 system 做最小实现，后续再引入 developer role。
        out.push({ role: 'system', content: e.content });
        continue;
      }
      if (e.type === 'tool_call_output') {
        if (e.callId) completedTextCalls.add(e.callId);
        const content = [
          '【工具调用结果】',
          `工具: ${e.server}.${e.tool}`,
          `参数: ${safeJson(e.args || {})}`,
          `结果: ${safeJson(e.output)}`,
        ].join('\n');
        out.push({ role: 'user', content });
        continue;
      }
      if (e.type === 'tool_call_requested') {
        pendingTextRequests.push(e);
        continue;
      }
      if (e.type === 'tool_call_started') continue;
    }
    for (const request of pendingTextRequests) {
      if (request.callId && completedTextCalls.has(request.callId)) continue;
      out.push({
        role: 'user',
        content: [
          '【工具调用结果】',
          `工具: ${request.server}.${request.tool}`,
          `参数: ${safeJson(request.args || {})}`,
          '结果: {"ok":false,"resultStatus":"unknown","error":{"code":"EXECUTION_UNKNOWN","message":"上次运行结束前未保存结果；请先核对影响，不能自动重试。"}}',
        ].join('\n'),
      });
    }
    return out;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

