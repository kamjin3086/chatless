import { BaseProvider, CheckResult, StreamCallbacks, LlmMessage } from './BaseProvider';
import { getStaticModels } from '../../provider/staticModels';
import { SSEClient } from '@/lib/sse-client';
import { ThinkingStrategyFactory, type ThinkingModeStrategy } from './thinking';
import { parsePromptCacheUsage, recordPromptCacheUsage } from '@/lib/llm/promptCacheMetrics';
import { createStreamEvent } from '../types/stream-events';
import { 
  type ToolDefinition, 
  toAnthropicTools, 
  toAnthropicToolChoice,
} from '../types/tool-schema';

/**
 * Anthropic Claude Provider (v1 REST API)
 * Docs: https://docs.anthropic.com/claude/reference/messages_post
 * - ✅ 支持Claude模型
 * - ✅ 支持结构化事件输出（onEvent优先）
 */
export class AnthropicProvider extends BaseProvider {
  private sseClient: SSEClient;
  private thinkingStrategy: ThinkingModeStrategy;

  constructor(baseUrl: string, apiKey?: string) {
    super('Anthropic', baseUrl, apiKey);
    this.sseClient = new SSEClient('AnthropicProvider');
    // Claude使用标准thinking策略（新架构）
    this.thinkingStrategy = ThinkingStrategyFactory.createStandardStrategy();
  }

  async fetchModels(): Promise<Array<{name: string, label?: string, aliases?: string[]}> | null> {
    const list = getStaticModels('Anthropic');
    return list?.map((m)=>({ name: m.id, label: m.label, aliases: [m.id] })) ?? null;
  }

  async checkConnection(): Promise<CheckResult> {
    const base = this.baseUrl.replace(/\/$/, '');
    const url = `${base}/messages`;
    const apiKey = await this.getApiKey();
    const body = { model: 'claude-3-opus-20240229', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false } as any;
    try {
      const { tauriFetch } = await import('@/lib/request');
      const { judgeApiReachable } = await import('./healthcheck');
      const resp: any = await tauriFetch(url, {
        method: 'POST',
        rawResponse: true,
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey || 'invalid_test_key_for_healthcheck',
        },
        body,
        timeout: 8000,
        fallbackToBrowserOnError: false,
        debugTag: 'Anthropic-HealthCheck',
      });
      const status = (resp?.status ?? 0) as number;
      const text = (await resp.text?.()) || '';
      const contentType = resp?.headers?.get?.('content-type') || '';
      const judged = judgeApiReachable(status, text, contentType);
      if (judged.ok) return { ok: true, message: judged.message, meta: { status } };
      return { ok: false, reason: judged.reason || 'UNKNOWN', message: judged.message || `HTTP ${status}`, meta: { status } };
    } catch (e: any) {
      const { classifyNetworkError } = await import('./healthcheck');
      return classifyNetworkError(e);
    }
  }

  /**
   * Streaming chat. NOTE: current implementation is basic and may need refinement for delta events.
   */
  async chatStream(
    model: string,
    messages: LlmMessage[],
    callbacks: StreamCallbacks,
    options: any = {}
  ): Promise<void> {
    const apiKey = await this.getApiKey(model);
    if (!apiKey) {
      const err = new Error('NO_KEY');
      (err as any).code = 'NO_KEY';
      (err as any).userMessage = '未配置 API 密钥（Anthropic）。请在设置中配置密钥后重试';
      callbacks.onError?.(err);
      return;
    }

    // Claude expects messages as array of {role, content}
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/messages`;
    // 过滤扩展字段，避免把 mcpServers/extensions 传入
    const o: any = options || {};
    const { 
      extensions: _extensions, 
      mcpServers: _mcpServers,
      tools: toolDefs,
      toolChoice,
      ...restOpts 
    } = o;
    const mapped: any = { ...restOpts };
    if (o.maxTokens !== undefined && mapped.max_tokens === undefined) mapped.max_tokens = o.maxTokens;
    if (o.maxOutputTokens !== undefined && mapped.max_tokens === undefined) mapped.max_tokens = o.maxOutputTokens;
    if (o.stop !== undefined && mapped.stop_sequences === undefined) mapped.stop_sequences = o.stop;
    if (o.topP !== undefined && mapped.top_p === undefined) mapped.top_p = o.topP;
    if (o.topK !== undefined && mapped.top_k === undefined) mapped.top_k = o.topK;
    if (o.minP !== undefined && mapped.min_p === undefined) mapped.min_p = o.minP;

    const systemMessages = messages.filter((m) => m.role === 'system' || m.role === 'developer');
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system' && m.role !== 'developer')
      .map((m: any) => {
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
          const content: any[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const call of m.tool_calls) {
            let input: unknown = {};
            try { input = JSON.parse(call.function?.arguments || '{}'); } catch { /* keep empty object */ }
            content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
          }
          return { role: 'assistant', content };
        }
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' }],
          };
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' };
      });
    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      stream: true,
      ...mapped,
    };
    if (systemMessages.length) body.system = systemMessages.map((m) => m.content).join('\n\n');
    
    // 添加原生工具调用支持（如果提供了工具定义）
    if (toolDefs && Array.isArray(toolDefs) && toolDefs.length > 0) {
      body.tools = toAnthropicTools(toolDefs as ToolDefinition[]);
      
      if (toolChoice) {
        body.tool_choice = toAnthropicToolChoice(toolChoice);
      }
    }

    // 重置策略状态
    this.thinkingStrategy.reset();
    
    // 工具调用状态追踪
    const toolCallState: Map<number, {
      id: string;
      name: string;
      input: string;
    }> = new Map();
    // Native tool calling：工具调用由 tool_use 块显式提供，不需要额外的“当前工具索引”状态
    
    try {
      await this.sseClient.startConnection(
        {
          url: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          debugTag: 'AnthropicProvider'
        },
        {
          onStart: callbacks.onStart,
          onError: callbacks.onError,
          onData: (rawData: string) => {
            // Anthropic 特定的数据解析逻辑
            try {
              // Anthropic streams JSON lines separated by newlines.
              if (!rawData) return;
              const parts = rawData.trim().split('\n');
              for (const part of parts) {
                if (part.startsWith('{')) {
                  const json = JSON.parse(part);
                  // Anthropic reports cache usage on message_start / message_delta.
                  if (json?.message?.usage) {
                    recordPromptCacheUsage(parsePromptCacheUsage(json.message.usage, 'anthropic', json.message.model));
                  } else if (json?.usage) {
                    recordPromptCacheUsage(parsePromptCacheUsage(json.usage, 'anthropic', json?.message?.model));
                  }
                  
                  // 处理内容块开始（可能是工具调用）
                  if (json.type === 'content_block_start') {
                    const contentBlock = json.content_block;
                    if (contentBlock?.type === 'tool_use') {
                      toolCallState.set(json.index, {
                        id: contentBlock.id || `tool_${json.index}`,
                        name: contentBlock.name || '',
                        input: '',
                      });
                    }
                  }
                  
                  // 处理内容块增量
                  if (json.type === 'content_block_delta') {
                    const delta = json.delta;
                    
                    // 处理工具输入增量
                    if (delta?.type === 'input_json_delta' && toolCallState.has(json.index)) {
                      const state = toolCallState.get(json.index)!;
                      state.input += delta.partial_json || '';
                    }
                    
                    // 处理文本内容
                    const token = delta?.text;
                    if (token) {
                      const result = this.thinkingStrategy.processToken({
                        content: token,
                        done: false
                      });
                      
                      // Native-only Agent：必须使用结构化事件（onEvent），不允许降级回文本
                      if (!callbacks.onEvent) {
                        throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                      }
                      if (result.events && result.events.length > 0) {
                        result.events.forEach(event => callbacks.onEvent!(event));
                      }
                    }
                  }
                  
                  // 处理内容块结束
                  if (json.type === 'content_block_stop') {
                    // 发送累积的工具调用
                    const tc = toolCallState.get(json.index);
                    if (tc && tc.name) {
                      this.emitToolCall(tc, callbacks);
                      toolCallState.delete(json.index);
                    }
                  }
                  
                  // 处理消息结束
                  if (json.type === 'message_stop') {
                    // 发送所有剩余的工具调用
                    for (const [, tc] of toolCallState) {
                      if (tc.name) {
                        this.emitToolCall(tc, callbacks);
                      }
                    }
                    toolCallState.clear();
                    
                    const result = this.thinkingStrategy.processToken({ done: true });
                    if (!callbacks.onEvent) {
                      throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                    }
                    if (result.events && result.events.length > 0) {
                      result.events.forEach(event => callbacks.onEvent!(event));
                    }
                    
                    callbacks.onComplete?.();
                    this.sseClient.stopConnection();
                  }
                }
              }
            } catch (err) {
              console.error('[Anthropic SSE] parse error', err);
            }
          }
        }
      );
    } catch (error: any) {
      console.error('[AnthropicProvider] SSE connection failed:', error);
      callbacks.onError?.(error);
    }
  }

  /**
   * 发送工具调用事件
   */
  private emitToolCall(
    tc: { id: string; name: string; input: string },
    callbacks: StreamCallbacks
  ): void {
    // 解析服务器和工具名称
    // 关键：避免出现 server=default 导致 “服务器 default 配置未找到”
    const { normalizeToolCallServerAndTool } = require('@/lib/mcp/normalizeToolCallName');
    const n = normalizeToolCallServerAndTool({ serverName: 'default', toolName: tc.name });
    const serverName = n.serverName;
    const toolName = n.toolName;
    
    // 发送工具调用事件
    if (callbacks.onEvent) {
      const toolEvent = createStreamEvent.toolCall(
        tc.id,
        {
          serverName,
          toolName,
          arguments: tc.input,
        }
      );
      callbacks.onEvent(toolEvent);
    }
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    await this.sseClient.destroy();
  }

  /**
   * 取消流式连接
   */
  cancelStream(): void {
    this.sseClient.stopConnection();
  }
}
