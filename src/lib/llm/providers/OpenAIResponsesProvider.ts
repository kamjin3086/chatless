import { BaseProvider, CheckResult, LlmMessage, StreamCallbacks } from './BaseProvider';
import { SSEClient } from '@/lib/sse-client';
import { ThinkingStrategyFactory, type ThinkingModeStrategy } from './thinking';
import { StreamEventAdapter } from '../adapters/StreamEventAdapter';

/**
 * OpenAI Responses Provider
 * - 适配 OpenAI Responses 风格的 /responses 接口
 * - 解析流式事件：response.output_text.delta / response.reasoning.delta / response.completed / [DONE]
 * - 参考文档：`https://platform.openai.com/docs/api-reference/responses/create`
 */
export class OpenAIResponsesProvider extends BaseProvider {
  private sseClient: SSEClient;
  private thinkingStrategy: ThinkingModeStrategy;

  constructor(baseUrl: string, apiKey?: string, displayName: string = 'OpenAI (Responses)') {
    super(displayName, baseUrl, apiKey);
    this.sseClient = new SSEClient('OpenAIResponsesProvider');
    // OpenAI Responses API 使用标准 <think> 标签（新架构）
    this.thinkingStrategy = ThinkingStrategyFactory.createStandardStrategy();
  }

  async checkConnection(): Promise<CheckResult> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return { ok: false, reason: 'NO_KEY', message: 'NO_KEY' };
    
    // 使用专门的连通性检查函数
    const baseUrl = this.baseUrl.replace(/\/$/, '');
    console.log(`[OpenAIResponsesProvider] 开始检查网络连通性: ${baseUrl}`);
    
    const { checkConnectivity } = await import('@/lib/request');
    const result = await checkConnectivity(baseUrl, {
      timeout: 5000,
      debugTag: 'OpenAIResponsesProvider-Connectivity'
    });
    
    if (result.ok) {
      console.log(`[OpenAIResponsesProvider] 网络连通性检查成功，状态码: ${result.status}`);
      return { ok: true, message: '网络连接正常' };
    } else {
      console.error(`[OpenAIResponsesProvider] 网络连通性检查失败: ${result.reason}`, result.error);
      
      switch (result.reason) {
        case 'TIMEOUT':
          return { ok: false, reason: 'TIMEOUT', message: '连接超时' };
        case 'NETWORK':
          return { ok: false, reason: 'NETWORK', message: '网络连接失败' };
        default:
          return { ok: false, reason: 'UNKNOWN', message: result.error || '未知错误' };
      }
    }
  }

  /**
   * 将通用消息映射为 Responses API 的 input 结构
   */
  private mapMessagesToResponsesInput(messages: LlmMessage[]): any[] {
    return messages.map((m) => ({
      role: m.role,
      content: [
        {
          type: 'input_text',
          text: m.content,
        },
      ],
    }));
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
      (err as any).userMessage = '未配置 API 密钥，请为该 Provider 或模型配置密钥';
      cb.onError?.(err);
      return;
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/responses`;

    // 选项映射：Responses 使用 max_output_tokens / temperature / top_p 等
    const mapped: any = { ...opts };
    if (opts.maxOutputTokens !== undefined && mapped.max_output_tokens === undefined) mapped.max_output_tokens = opts.maxOutputTokens;
    if (opts.maxTokens !== undefined && mapped.max_output_tokens === undefined) mapped.max_output_tokens = opts.maxTokens;
    if (opts.topP !== undefined && mapped.top_p === undefined) mapped.top_p = opts.topP;
    if (opts.temperature !== undefined && mapped.temperature === undefined) mapped.temperature = opts.temperature;

    const body = {
      model,
      input: this.mapMessagesToResponsesInput(messages),
      stream: true,
      ...mapped,
    };

    // 重置thinking策略状态
    this.thinkingStrategy.reset();

    // 解析 Responses 流事件所需的状态
    let lastEvent: string | null = null;

    try {
      // 优先：Tauri HTTP（跨域/自签证书友好）
      let resp: any = null;
      try {
        const { tauriFetch } = await import('@/lib/request');
        resp = await tauriFetch(url, {
          method: 'POST',
          rawResponse: true,
          browserHeaders: true,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson, application/json, text/event-stream',
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          debugTag: 'OpenAIResponsesStream',
        });
      } catch {
        resp = null;
      }

      // 次选：浏览器 fetch
      if (!resp) {
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/x-ndjson, application/json, text/event-stream',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });
        } catch {
          resp = null;
        }
      }

      if (!resp || !resp.ok) {
        await this.startSSEFallback(url, apiKey, body, cb);
        return;
      }

      const contentType = (resp.headers.get?.('Content-Type') || '').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        await this.startSSEFallback(url, apiKey, body, cb);
        return;
      }

      // NDJSON/JSON 流解析
      cb.onStart?.();
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('ReadableStream reader not available');
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const processEvent = (eventName: string | null, data: any) => {
        const route = eventName || data?.event || data?.type || '';
        const pickPiece = (obj: any) => (typeof obj?.delta === 'string' ? obj.delta : (typeof obj?.text === 'string' ? obj.text : (typeof obj?.content === 'string' ? obj.content : undefined)));
        
        switch (route) {
          case 'response.reasoning.delta': {
            // OpenAI Responses API的reasoning应该被包装为<think>
            const piece = pickPiece(data);
            if (piece) {
              const result = this.thinkingStrategy.processToken({
                content: `<think>${piece}`,
                done: false
              });
              
              if (!cb.onEvent) {
                throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
              }
              if (result.events && result.events.length > 0) {
                result.events.forEach(event => cb.onEvent!(event));
              }
            }
            break;
          }
          case 'response.output_text.delta': {
            // 正常输出内容
            const piece = pickPiece(data);
            if (piece) {
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
            break;
          }
          case 'response.output_text.done':
          case 'response.completed': {
            // 流结束，发送完成事件
            const result = this.thinkingStrategy.processToken({ done: true });
            
            if (!cb.onEvent) {
              throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
            }
            if (result.events && result.events.length > 0) {
              result.events.forEach(event => cb.onEvent!(event));
            }
            
            if (route === 'response.completed') {
              cb.onComplete?.();
            }
            break;
          }
          default: {
            // 未知事件，作为普通内容处理
            const piece = pickPiece(data);
            if (piece) {
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
            break;
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          const last = buffer.trim();
          if (last) {
            const line = last.startsWith('data:') ? last.slice(5).trim() : last;
            if (line === '[DONE]') {
              const result = this.thinkingStrategy.processToken({ done: true });
              if (cb.onEvent && result.events && result.events.length > 0) {
                result.events.forEach(event => cb.onEvent!(event));
              }
              cb.onComplete?.();
              break;
            }
            try { processEvent(null, JSON.parse(line)); } catch { /* ignore */ }
          }
          // 流结束但没有[DONE]标记
          const result = this.thinkingStrategy.processToken({ done: true });
          if (cb.onEvent && result.events && result.events.length > 0) {
            result.events.forEach(event => cb.onEvent!(event));
          }
          cb.onComplete?.();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!raw) continue;
          if (raw === '[DONE]') {
            const result = this.thinkingStrategy.processToken({ done: true });
            if (cb.onEvent && result.events && result.events.length > 0) {
              result.events.forEach(event => cb.onEvent!(event));
            }
            cb.onComplete?.();
            return;
          }
          if (raw.startsWith('event:')) { lastEvent = raw.slice(6).trim(); continue; }
          const payload = raw.startsWith('data:') ? raw.slice(5).trim() : raw;
          try { processEvent(lastEvent, JSON.parse(payload)); } catch { /* ignore */ }
        }
      }
    } catch (error: any) {
      console.error('[OpenAIResponsesProvider] stream error:', error);
      cb.onError?.(error);
    }
  }

  private async startSSEFallback(url: string, apiKey: string, body: unknown, cb: StreamCallbacks) {
    // 重置thinking策略状态
    this.thinkingStrategy.reset();
    
    let lastEvent: string | null = null;
    try {
      await this.sseClient.startConnection(
        {
          url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body,
          debugTag: 'OpenAIResponsesProvider',
        },
        {
          onStart: cb.onStart,
          onError: cb.onError,
          onData: (rawLine: string) => {
            const line = rawLine.trim();
            if (!line) return;
            
            if (line === '[DONE]') {
              const result = this.thinkingStrategy.processToken({ done: true });
              if (cb.onEvent && result.events && result.events.length > 0) {
                result.events.forEach(event => cb.onEvent!(event));
              }
              cb.onComplete?.();
              this.sseClient.stopConnection();
              return;
            }
            
            if (line.startsWith('event:')) {
              lastEvent = line.slice(6).trim();
              return;
            }
            
            let data: any = null;
            try {
              data = JSON.parse(line);
            } catch {
              return;
            }
            
            const pickPiece = (obj: any) => (
              typeof obj?.delta === 'string' ? obj.delta :
              (typeof obj?.text === 'string' ? obj.text :
              (typeof obj?.content === 'string' ? obj.content : undefined))
            );
            
            switch (lastEvent) {
              case 'response.reasoning.delta': {
                const piece = pickPiece(data);
                if (piece) {
                  const result = this.thinkingStrategy.processToken({
                    content: `<think>${piece}`,
                    done: false
                  });
                  
                  if (!cb.onEvent) {
                    throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                  }
                  if (result.events && result.events.length > 0) {
                    result.events.forEach(event => cb.onEvent!(event));
                  }
                }
                break;
              }
              case 'response.output_text.delta': {
                const piece = pickPiece(data);
                if (piece) {
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
                break;
              }
              case 'response.output_text.done':
              case 'response.completed': {
                const result = this.thinkingStrategy.processToken({ done: true });
                
                if (!cb.onEvent) {
                  throw new Error('Native-only Agent mode requires StreamCallbacks.onEvent');
                }
                if (result.events && result.events.length > 0) {
                  result.events.forEach(event => cb.onEvent!(event));
                }
                
                if (lastEvent === 'response.completed') {
                  cb.onComplete?.();
                  this.sseClient.stopConnection();
                }
                break;
              }
              default: {
                const piece = pickPiece(data);
                if (piece) {
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
                break;
              }
            }
          },
        }
      );
    } catch (error) {
      console.error('[OpenAIResponsesProvider] SSE fallback failed:', error);
      cb.onError?.(error as any);
    }
  }

  async destroy(): Promise<void> {
    await this.sseClient.destroy();
  }

  cancelStream(): void {
    this.sseClient.stopConnection();
  }
}

