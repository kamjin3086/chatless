import { BaseProvider, CheckResult, LlmMessage, StreamCallbacks } from './BaseProvider';
import { getStaticModels } from '../../provider/staticModels';
import { SSEClient } from '@/lib/sse-client';
import { ThinkingStrategyFactory, type ThinkingModeStrategy } from './thinking';
import { StreamEventAdapter } from '../adapters/StreamEventAdapter';
import { createStreamEvent } from '../types/stream-events';
import { toOpenAIMessage } from './messageMapping';
import { toOpenAITools, toOpenAIToolChoice, type ToolDefinition } from '../types/tool-schema';

/**
 * DeepSeek（深度寻求）模型服务 Provider
 * - ✅ 支持DeepSeek Reasoning模式
 * - ✅ 支持结构化事件输出（onEvent优先）
 */
export class DeepSeekProvider extends BaseProvider {
  private sseClient: SSEClient;
  private thinkingStrategy: ThinkingModeStrategy;

  constructor(baseUrl: string, apiKey?: string) {
    super('DeepSeek', baseUrl, apiKey);
    this.sseClient = new SSEClient('DeepSeekProvider');
    // DeepSeek使用专门的Reasoning策略（新架构）
    this.thinkingStrategy = ThinkingStrategyFactory.createDeepSeekStrategy();
  }

  async checkConnection(): Promise<CheckResult> {
    const apiKey = await this.getApiKey();
    const { probeOpenAICompatibleBase } = await import('./healthcheck');
    return probeOpenAICompatibleBase(this.baseUrl, {
      apiKey,
      debugTag: 'DeepSeek-HealthCheck',
    });
  }

  /**
   * DeepSeek ChatCompletion 流式接口实现
   * 文档: https://api-docs.deepseek.com/api/create-chat-completion
   */
  async chatStream(
    model: string,
    messages: LlmMessage[],
    cb: StreamCallbacks,
    opts: Record<string, any> = {}
  ): Promise<void> {
    // 组合请求参数
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;

    // 过滤扩展字段，避免把 mcpServers/extensions 传入
    const { extensions, mcpServers, tools: toolDefs, toolChoice, parallelToolCalls, ...restOpts } = (opts as any) || {};
    const mapped: any = { ...restOpts };
    if (opts.maxTokens !== undefined && mapped.max_tokens === undefined) mapped.max_tokens = opts.maxTokens;
    if (opts.maxOutputTokens !== undefined && mapped.max_tokens === undefined) mapped.max_tokens = opts.maxOutputTokens;
    if (opts.topP !== undefined && mapped.top_p === undefined) mapped.top_p = opts.topP;
    if (opts.topK !== undefined && mapped.top_k === undefined) mapped.top_k = opts.topK;
    if (opts.minP !== undefined && mapped.min_p === undefined) mapped.min_p = opts.minP;
    if (opts.frequencyPenalty !== undefined && mapped.frequency_penalty === undefined) mapped.frequency_penalty = opts.frequencyPenalty;
    if (opts.presencePenalty !== undefined && mapped.presence_penalty === undefined) mapped.presence_penalty = opts.presencePenalty;
    if (opts.stop !== undefined && mapped.stop === undefined) mapped.stop = opts.stop;

    const body = {
      model,
      stream: true,
      messages: messages.map(toOpenAIMessage),
      ...mapped,
    };
    if (Array.isArray(toolDefs) && toolDefs.length > 0) {
      (body as any).tools = toOpenAITools(toolDefs as ToolDefinition[]);
      if (toolChoice) (body as any).tool_choice = toOpenAIToolChoice(toolChoice);
      if (parallelToolCalls !== undefined) (body as any).parallel_tool_calls = parallelToolCalls;
    }

    // 准备请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = await this.getApiKey(model);
    if (!apiKey) {
      const err = new Error('NO_KEY');
      (err as any).code = 'NO_KEY';
      (err as any).userMessage = '未配置 API 密钥（DeepSeek）。请在设置中配置密钥后重试';
      cb.onError?.(err);
      return;
    }
    headers['Authorization'] = `Bearer ${apiKey}`;

    // 重置策略状态
    this.thinkingStrategy.reset();
    const toolCallState: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let reasoningContent = '';
    
    try {
      await this.sseClient.startConnection(
        {
          url,
          method: 'POST',
          headers,
          body,
          debugTag: 'DeepSeekProvider'
        },
        {
          onStart: cb.onStart,
          onError: cb.onError,
          onData: (rawData: string) => {
            // DeepSeek 特定的数据解析逻辑
            if (!rawData) return;

            // DeepSeek 与 OpenAI 一样, 以 "[DONE]" 结束
            if (rawData.trim() === '[DONE]') {
              this.emitPendingToolCalls(toolCallState, reasoningContent, cb);
              const result = this.thinkingStrategy.processToken({ done: true });
              // Native-only Agent：必须使用结构化事件（onEvent），不允许降级回文本
              if (!cb.onEvent) {
                throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
              }
              if (result.events && result.events.length > 0) {
                result.events.forEach(event => cb.onEvent!(event));
              }
              
              // 打印完整响应（用于调试）
                cb.onComplete?.();
              this.sseClient.stopConnection();
              return;
            }

            try {
              const json = JSON.parse(rawData);
              const delta = json?.choices?.[0]?.delta || {};
              const token = delta?.content;
              const reasoningToken = delta?.reasoning_content;
              if (typeof reasoningToken === 'string') reasoningContent += reasoningToken;
              if (Array.isArray(delta?.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;
                  const state = toolCallState.get(index) || {
                    id: tc.id || `call_${index}`,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  };
                  if (tc.id) state.id = tc.id;
                  if (tc.function?.name) state.name += tc.function.name;
                  if (tc.function?.arguments) state.arguments += tc.function.arguments;
                  toolCallState.set(index, state);
                }
              }
              
              // 直接传递原始字段给Strategy，让Strategy自己处理
              // 新架构的DeepSeekReasoningStrategy会正确识别reasoning_content字段
              if (reasoningToken || token) {
                const result = this.thinkingStrategy.processToken({
                  reasoning_content: reasoningToken || undefined,
                  content: token || undefined,
                  done: false
                });
                
                if (!cb.onEvent) {
                  throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                }
                if (result.events && result.events.length > 0) {
                  result.events.forEach(event => cb.onEvent!(event));
                }
              }
              if (json?.choices?.[0]?.finish_reason) {
                this.emitPendingToolCalls(toolCallState, reasoningContent, cb);
                toolCallState.clear();
              }
            } catch (err) {
              console.warn('[DeepSeekProvider] Failed to parse SSE chunk:', err);
            }
          }
        }
      );
    } catch (error: any) {
      console.error('[DeepSeekProvider] SSE connection failed:', error);
      cb.onError?.(error);
    }
  }

  async fetchModels(): Promise<Array<{name: string, label?: string, aliases?: string[]}> | null> {
    const list = getStaticModels('DeepSeek');
    return list?.map((m)=>({ name: m.id, label: m.label, aliases: [m.id] })) ?? null;
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

  private emitPendingToolCalls(
    state: Map<number, { id: string; name: string; arguments: string }>,
    reasoningContent: string,
    cb: StreamCallbacks,
  ): void {
    if (!cb.onEvent) return;
    const { normalizeToolCallServerAndTool } = require('@/lib/mcp/normalizeToolCallName');
    for (const [, tc] of state) {
      if (!tc.name) continue;
      const normalized = normalizeToolCallServerAndTool({ serverName: 'default', toolName: tc.name });
      cb.onEvent(createStreamEvent.toolCall(tc.id, {
        serverName: normalized.serverName,
        toolName: normalized.toolName,
        arguments: tc.arguments,
      }, reasoningContent ? { reasoning_content: reasoningContent } : undefined));
    }
  }
}
