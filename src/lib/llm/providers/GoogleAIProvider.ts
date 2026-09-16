import { BaseProvider, CheckResult, LlmMessage, StreamCallbacks } from './BaseProvider';
import { getStaticModels } from '../../provider/staticModels';
import { SSEClient } from '@/lib/sse-client';
import { ThinkingStrategyFactory, type ThinkingModeStrategy } from './thinking';
import { StreamEventAdapter } from '../adapters/StreamEventAdapter';

/**
 * Google AI Provider
 * - ✅ 支持Gemini模型
 * - ✅ 支持结构化事件输出（onEvent优先）
 */
export class GoogleAIProvider extends BaseProvider {
  private sseClient: SSEClient;
  private processedPayloads: Set<string> = new Set(); // 防止重复处理（按原始payload去重）
  private thinkingStrategy: ThinkingModeStrategy;

  constructor(baseUrl: string, apiKey?: string) {
    super('Google AI', baseUrl, apiKey);
    this.sseClient = new SSEClient('GoogleAIProvider');
    // Google AI使用标准thinking策略（新架构）
    this.thinkingStrategy = ThinkingStrategyFactory.createStandardStrategy();
  }

  async fetchModels(): Promise<Array<{name: string, label?: string, aliases?: string[]}> | null> {
    // Google AI 特殊：支持通过 query 参数 ?key=API_KEY 获取
    // curl https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY
    try {
      const apiKey = await this.getApiKey();
      const base = (this as any).baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
      const url = `${base}/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
      const resp: any = await (await import('@/lib/request')).tauriFetch(url, { method: 'GET', fallbackToBrowserOnError: true, verboseDebug: true, debugTag: 'ModelList' });
      const items = Array.isArray(resp?.models) ? resp.models : (Array.isArray(resp?.data) ? resp.data : []);
      if (Array.isArray(items) && items.length) {
        return items.map((it: any)=>{
          const id = it?.name || it?.id;
          const label = it?.display_name || it?.label || id;
          return { name: String(id), label: String(label), aliases: [String(id)] };
        });
      }
    } catch (e) {
      // 网络或鉴权失败时回退静态模型
      console.warn('[GoogleAIProvider] fetchModels via query key failed, fallback to static list', e);
    }
    const list = getStaticModels('Google AI');
    return list?.map((m)=>({ name: m.id, label: m.label, aliases: [m.id] })) ?? null;
  }

  async checkConnection(): Promise<CheckResult> {
    // Gemini：用错误 key 访问生成端点判定可达
    const base = (this as any).baseUrl?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
    // 使用简化体，避免某些代理对不完整 payload 返回 400
    const url = `${base}/models/gemini-pro:generateContent`;
    const fakeKey = 'invalid_test_key_for_healthcheck';
    const body = {
      contents: [{ parts: [{ text: 'ping' }] }]
    } as any;
    try {
      const { tauriFetch } = await import('@/lib/request');
      const { judgeApiReachable } = await import('./healthcheck');
      const resp: any = await tauriFetch(`${url}?key=${encodeURIComponent(fakeKey)}`, {
        method: 'POST',
        rawResponse: true,
        headers: { 'Content-Type': 'application/json' },
        body,
        timeout: 8000,
        fallbackToBrowserOnError: false,
        debugTag: 'GoogleAI-HealthCheck',
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

  async chatStream(
    model: string,
    messages: LlmMessage[],
    cb: StreamCallbacks,
    opts: Record<string, any> = {}
  ): Promise<void> {
    // 先通过参数策略引擎注入按 provider/model 的必要参数（如 image_generation、thinkingBudget 等）
    try {
      const { ParameterPolicyEngine } = await import('../ParameterPolicy');
      opts = ParameterPolicyEngine.apply('Google AI', model, opts || {});
    } catch { /* ignore policy injection failure */ }
    const apiKey = await this.getApiKey(model);
    if (!apiKey) {
      console.error('[GoogleAIProvider] No API key provided');
      const err = new Error('NO_KEY');
      (err as any).code = 'NO_KEY';
      (err as any).userMessage = '未配置 API 密钥（Google AI）。请在设置中配置密钥后重试';
      cb.onError?.(err);
      return;
    }
    
    // 规范化模型ID：去除可能的 "models/" 前缀，避免重复拼接
    const normalizedModel = model.startsWith('models/') ? model.slice('models/'.length) : model;
    // 构造正确的 URL - 使用官方文档中的流式API端点
    const url = `${this.baseUrl.replace(/\/$/, '')}/models/${normalizedModel}:streamGenerateContent?alt=sse`;
    
    // 将通用选项映射到 Gemini generationConfig
    const generationConfig: any = {
      ...(opts.generationConfig || {}),
    };
    // 仅当未在 generationConfig 中出现时才从扁平字段映射
    if (generationConfig.temperature === undefined && opts.temperature !== undefined) {
      generationConfig.temperature = opts.temperature;
    }
    if (generationConfig.topP === undefined && opts.topP !== undefined) {
      generationConfig.topP = opts.topP;
    }
    // 自定义扩展：允许 topK/minP 透传到 generationConfig
    const o: any = opts as any;
    if (generationConfig.topK === undefined && o.topK !== undefined) {
      generationConfig.topK = o.topK;
    }
    if (generationConfig.minP === undefined && o.minP !== undefined) {
      generationConfig.minP = o.minP;
    }
    // OpenAI 风格的 maxTokens → Gemini 的 maxOutputTokens
    if (generationConfig.maxOutputTokens === undefined) {
      const flatMax = (opts as any).maxOutputTokens ?? (opts as any).maxTokens;
      if (flatMax !== undefined) generationConfig.maxOutputTokens = flatMax;
    }
    if (generationConfig.stopSequences === undefined && (opts as any).stop) {
      generationConfig.stopSequences = (opts as any).stop;
    }

    const body: any = {
      contents: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      generationConfig,
    };

    // 移除顶层 responseModalities，统一走 generationConfig.responseModalities

    // 透传策略附加/调用方指定的工具（如 image_generation），避免把未知扩展透传
    if (Array.isArray((opts as any).tools) && (opts as any).tools.length > 0) {
      body.tools = (opts as any).tools;
    }
    
    // 避免把未知字段（如 mcpServers/extensions）透传给 Gemini，统一丢弃未知扩展
    // 如需支持额外字段，请在此按白名单加入
    // 目前仅保留下方的 safetySettings / tools 专项处理
    
    // 特定透传（保持向后兼容）
    if ((opts as any).safetySettings) body.safetySettings = (opts as any).safetySettings;
    if ((opts as any).tools) body.tools = (opts as any).tools;

    console.log('[GoogleAIProvider] Starting chat stream with:', {
      model: normalizedModel,
      url,
      hasApiKey: !!apiKey,
      messageCount: messages.length
    });

    // 重置已处理集合和策略状态
    this.processedPayloads.clear();
    this.thinkingStrategy.reset();

    try {
      await this.sseClient.startConnection(
        {
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          },
          body,
          debugTag: 'GoogleAIProvider'
        },
        {
          onStart: () => {
            console.log('[GoogleAIProvider] SSE connection started');
            cb.onStart?.();
          },
          onError: (error) => {
            console.error('[GoogleAIProvider] SSE connection error:', error);
            cb.onError?.(error);
          },
          onData: (rawData: string) => {
            console.debug('[GoogleAIProvider] Received raw data:', rawData);
            
            // Google AI 的流式响应为 JSON，每个事件包含候选增量文本
            try {
              // 某些实现会把 JSON 前面加 "data:" 或在同一事件中拼接多个 JSON
              const payload = rawData.startsWith('data:') ? rawData.substring(5).trim() : rawData.trim();
              if (!payload) return;
              if (this.processedPayloads.has(payload)) return; // 完全重复的 payload 直接跳过
              this.processedPayloads.add(payload);
              const parsedData = JSON.parse(payload);
              
              // 检查是否有candidates数组
              if (parsedData.candidates && Array.isArray(parsedData.candidates) && parsedData.candidates.length > 0) {
                const candidate = parsedData.candidates[0];
                
                // 提取文本内容
                if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
                  for (const part of candidate.content.parts) {
                    const piece = typeof part.text === 'string' ? part.text : undefined;
                    if (piece && piece.length > 0) {
                      const result = this.thinkingStrategy.processToken({
                        content: piece,
                        done: false
                      });
                      
                      if (!cb.onEvent) {
                        throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                      }
                      if (result.events && result.events.length > 0) {
                        result.events.forEach(event => cb.onEvent!(event));
                      }
                    }
                    // 提取内联图片（image generation 返回 inlineData）
                    const p: any = part;
                    const inline = p?.inlineData;
                    if (inline && typeof inline.data === 'string' && typeof inline.mimeType === 'string') {
                      cb.onImage?.({ mimeType: inline.mimeType, data: inline.data });
                    }
                  }
                }
                
                // 检查是否完成
                if (candidate.finishReason === 'STOP') {
                  console.log('[GoogleAIProvider] Stream completed (finishReason: STOP)');
                  const result = this.thinkingStrategy.processToken({ done: true });
                  if (!cb.onEvent) {
                    throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                  }
                  if (result.events && result.events.length > 0) {
                    result.events.forEach(event => cb.onEvent!(event));
                  }
                  
                  cb.onComplete?.();
                  // 确保及时关闭并移除监听，避免后续开启的新流将事件冒泡到旧回调
                  this.sseClient.stopConnection();
                }
              }
              
              // 检查promptFeedback（Google AI特有的错误处理）
              if (parsedData.promptFeedback?.blockReason) {
                const error = new Error(`Content blocked: ${parsedData.promptFeedback.blockReason}`);
                console.error('[GoogleAIProvider] Content blocked:', parsedData.promptFeedback);
                cb.onError?.(error);
              }
              
            } catch (error) {
              console.error('[GoogleAIProvider] Failed to parse chunk:', error);
              cb.onError?.(error instanceof Error ? error : new Error('Failed to parse response'));
            }
          }
        }
      );
    } catch (error: any) {
      console.error('[GoogleAIProvider] SSE connection failed:', error);
      cb.onError?.(error);
    }
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    this.processedPayloads.clear();
    await this.sseClient.destroy();
  }

  /**
   * 取消流式连接
   */
  cancelStream(): void {
    this.sseClient.stopConnection();
  }
}
