import { BaseProvider, CheckResult, LlmMessage, StreamCallbacks } from './BaseProvider';
import { getStaticModels } from '../../provider/staticModels';
import { SSEClient } from '@/lib/sse-client';
import { ThinkingStrategyFactory, type ThinkingModeStrategy } from './thinking';
import { createStreamEvent } from '../types/stream-events';
import { 
  type ToolDefinition, 
  toOpenAITools, 
  toOpenAIToolChoice,
} from '../types/tool-schema';

export class OpenAIProvider extends BaseProvider {
  private sseClient: SSEClient;
  private aborted: boolean = false;
  private thinkingStrategy: ThinkingModeStrategy;

  constructor(baseUrl: string, apiKey?: string, displayName: string = 'OpenAI') {
    super(displayName, baseUrl, apiKey);
    this.sseClient = new SSEClient('OpenAIProvider');
    // OpenAI使用标准的<think>标签策略（新架构）
    this.thinkingStrategy = ThinkingStrategyFactory.createStandardStrategy();
  }

  async fetchModels(): Promise<Array<{name: string, label?: string, aliases?: string[]}> | null> {
    // 暂不进行在线拉取，统一使用静态模型清单；按 provider 名称读取对应静态清单
    const key = this.name || 'OpenAI';
    const list = getStaticModels(key);
    return list?.map((m)=>({ name: m.id, label: m.label, aliases: [m.id] })) ?? null;
  }

  async checkConnection(): Promise<CheckResult> {
    const apiKey = await this.getApiKey();
    const { probeOpenAICompatibleBase } = await import('./healthcheck');
    return probeOpenAICompatibleBase(this.baseUrl, {
      apiKey,
      debugTag: 'OpenAI-HealthCheck',
    });
  }

  async chatStream(
    model: string, 
    messages: LlmMessage[], 
    cb: StreamCallbacks,
    opts: Record<string, any> = {}
  ): Promise<void> {
    const apiKey = await this.getApiKey(model);
    if (!apiKey) {
      const err = new Error('NO_KEY');
      (err as any).code = 'NO_KEY';
      (err as any).userMessage = '未配置 API 密钥，请在"设置 → 模型与Provider"中为当前 Provider 或模型配置密钥';
      cb.onError?.(err);
      return;
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    // 将通用选项映射为 OpenAI 字段（snake_case）
    // 过滤掉扩展字段，避免把 mcpServers/extensions 传到不支持的后端
    const { 
      extensions: _extensions, 
      mcpServers: _mcpServers,
      tools: toolDefs,
      toolChoice,
      parallelToolCalls,
      ...restOpts 
    } = (opts as any) || {};
    const mapped: any = { ...restOpts };
    const o: any = opts as any;
    if (o.maxTokens !== undefined && mapped.max_tokens === undefined) mapped.max_tokens = o.maxTokens;
    if (o.maxOutputTokens !== undefined && mapped.max_tokens === undefined) mapped.max_tokens = o.maxOutputTokens;
    if (o.topP !== undefined && mapped.top_p === undefined) mapped.top_p = o.topP;
    if (o.topK !== undefined && mapped.top_k === undefined) mapped.top_k = o.topK;
    if (o.minP !== undefined && mapped.min_p === undefined) mapped.min_p = o.minP;
    if (o.frequencyPenalty !== undefined && mapped.frequency_penalty === undefined) mapped.frequency_penalty = o.frequencyPenalty;
    if (o.presencePenalty !== undefined && mapped.presence_penalty === undefined) mapped.presence_penalty = o.presencePenalty;
    if (o.stop !== undefined && mapped.stop === undefined) mapped.stop = o.stop;

    // 构建请求体
    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => {
        const anyMsg: any = m as any;
        const msg: any = { role: m.role, content: m.content };
        if (m.role === 'tool') {
          if (anyMsg.tool_call_id) msg.tool_call_id = anyMsg.tool_call_id;
          if (anyMsg.name) msg.name = anyMsg.name;
        }
        if (m.role === 'assistant' && Array.isArray(anyMsg.tool_calls) && anyMsg.tool_calls.length > 0) {
          msg.tool_calls = anyMsg.tool_calls;
        }
        return msg;
      }),
      stream: true,
      ...mapped,
    };
    
    // 添加原生工具调用支持（如果提供了工具定义）
    if (toolDefs && Array.isArray(toolDefs) && toolDefs.length > 0) {
      body.tools = toOpenAITools(toolDefs as ToolDefinition[]);
      
      if (toolChoice) {
        body.tool_choice = toOpenAIToolChoice(toolChoice);
      }
      
      if (parallelToolCalls !== undefined) {
        body.parallel_tool_calls = parallelToolCalls;
      }
      
      // 启用流式工具调用增量返回
      body.stream_options = { include_usage: true };
    }

    try {
      this.aborted = false;
      this.thinkingStrategy.reset(); // 重置策略状态
      
      // 工具调用增量状态
      const toolCallState: Map<number, {
        id: string;
        name: string;
        arguments: string;
      }> = new Map();
      
      await this.sseClient.startConnection(
        {
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body,
          debugTag: 'OpenAIProvider'
        },
        {
          onStart: cb.onStart,
          onError: cb.onError,
          onData: (rawData: string) => {
            if (this.aborted) { this.sseClient.stopConnection(); return; }
            // 严格 OpenAI：只处理以 data: 开头的行
            if (!rawData.startsWith('data:')) return;
            const jsonStr = rawData.substring(5).trim();
            if (!jsonStr) return;
            if (jsonStr === '[DONE]') {
              // 完成前，发送所有累积的工具调用
              this.emitPendingToolCalls(toolCallState, cb);
              cb.onComplete?.();
              this.sseClient.stopConnection();
              return;
            }
            try {
              const json = JSON.parse(jsonStr);
              const delta = json?.choices?.[0]?.delta;
              
              // 处理工具调用增量
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;
                  
                  if (!toolCallState.has(index)) {
                    toolCallState.set(index, {
                      id: tc.id || `call_${index}`,
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    });
                  } else {
                    const state = toolCallState.get(index)!;
                    if (tc.id) state.id = tc.id;
                    if (tc.function?.name) state.name += tc.function.name;
                    if (tc.function?.arguments) state.arguments += tc.function.arguments;
                  }
                }
                // 不返回，继续处理可能的内容
              }
              
              // 处理普通内容
              const token = delta?.content;
              if (!token) return;
              
              // 使用策略处理token，得到结构化事件
              const result = this.thinkingStrategy.processToken({
                content: token,
                done: false
              });
              
              // Native-only Agent：必须使用结构化事件（onEvent），不允许降级回文本
              if (!cb.onEvent) {
                throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
              }
              if (result.events && result.events.length > 0) {
                result.events.forEach(event => cb.onEvent!(event));
              }
            } catch (err) {
              console.warn('[OpenAIProvider] JSON parse error', err);
            }
          }
        }
      );
    } catch (error: any) {
      console.error('[OpenAIProvider] SSE connection failed:', error);
      cb.onError?.(error);
    }
  }

  /**
   * 发送累积的工具调用事件
   */
  private emitPendingToolCalls(
    toolCallState: Map<number, { id: string; name: string; arguments: string }>,
    cb: StreamCallbacks
  ): void {
    if (toolCallState.size === 0) return;
    
    for (const [, tc] of toolCallState) {
      if (!tc.name) continue;
      
      // 解析服务器和工具名称（格式: server__tool 或 server.tool 或直接工具名）
      // 关键：避免出现 server=default 导致 “服务器 default 配置未找到”
      const { normalizeToolCallServerAndTool } = require('@/lib/mcp/normalizeToolCallName');
      const n = normalizeToolCallServerAndTool({ serverName: 'default', toolName: tc.name });
      const serverName = n.serverName;
      const toolName = n.toolName;
      
      // 解析参数
      // 发送工具调用事件
      if (cb.onEvent) {
        const toolEvent = createStreamEvent.toolCall(
          tc.id,
          {
            serverName,
            toolName,
            arguments: tc.arguments,
          }
        );
        cb.onEvent(toolEvent);
      }
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
    this.aborted = true;
    this.sseClient.stopConnection();
  }
}
