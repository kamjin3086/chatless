import { BaseProvider, CheckResult, LlmMessage, StreamCallbacks } from './BaseProvider';
import { getStaticModels } from '../../provider/staticModels';
import { SSEClient } from '@/lib/sse-client';
import { ThinkingStrategyFactory, type ThinkingModeStrategy } from './thinking';
import { StreamEventAdapter } from '../adapters/StreamEventAdapter';
import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '../types/stream-events';
import { rewriteEventsWithToolCalls } from '../adapters/ToolChannelParser';
import { 
  type ToolDefinition, 
  toOpenAITools, 
  toOpenAIToolChoice 
} from '../types/tool-schema';

/**
 * OpenAI 兼容 Provider（宽松解析版）
 * - 专供各类 OpenAI 兼容聚合/代理服务
 * - 兼容两种事件负载："data: {json}" 与 直接 "{json}"，并识别 "[DONE]"
 * - ✅ 支持结构化事件输出（onEvent优先）
 */
export class OpenAICompatibleProvider extends BaseProvider {
  private sseClient: SSEClient;
  private aborted: boolean = false;
  private currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private thinkingStrategy: ThinkingModeStrategy;

  constructor(baseUrl: string, apiKey?: string, displayName: string = 'OpenAI-Compatible') {
    super(displayName, baseUrl, apiKey);
    this.sseClient = new SSEClient('OpenAICompatibleProvider');
    // 使用标准thinking策略（兼容<think>标签，新架构）
    this.thinkingStrategy = ThinkingStrategyFactory.createStandardStrategy();
  }

  async fetchModels(): Promise<Array<{ name: string; label?: string; aliases?: string[] }> | null> {
    // 通用兜底：按 OpenAI 兼容协议拉取 /models
    try {
      const apiKey = await this.getApiKey();
      const base = (this as any).baseUrl?.replace(/\/$/, '') || '';
      if (!base) throw new Error('no base url');
      const url = `${base}/models`;
      const { tauriFetch } = await import('@/lib/request');
      const resp: any = await tauriFetch(url, { method: 'GET', headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, fallbackToBrowserOnError: true, verboseDebug: true, debugTag: 'ModelList' });
      const items = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : []);
      if (Array.isArray(items) && items.length) {
        return items.map((it: any) => {
          const id = it?.id || it?.name;
          const label = it?.label || it?.id || it?.name;
          return { name: String(id), label: String(label), aliases: [String(id)] };
        });
      }
    } catch (e) {
      // 静态兜底，避免界面空白
      console.warn('[OpenAICompatibleProvider] fetchModels fallback to static list', e);
    }
    const key = this.name || 'OpenAI-Compatible';
    const list = getStaticModels(key);
    return list?.map((m) => ({ name: m.id, label: m.label, aliases: [m.id] })) ?? null;
  }

  async checkConnection(): Promise<CheckResult> {
    // 与 OpenAI 类似，使用错误密钥做一次标准请求，判断是否可达
    const base = this.baseUrl.replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const fakeKey = 'invalid_test_key_for_healthcheck';
    const body = { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'ping' }], stream: false };
    try {
      const { tauriFetch } = await import('@/lib/request');
      const { judgeApiReachable } = await import('./healthcheck');
      const resp: any = await tauriFetch(url, {
        method: 'POST',
        rawResponse: true,
        browserHeaders: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fakeKey}` },
        body,
        timeout: 5000,
        fallbackToBrowserOnError: true,
        debugTag: 'OpenAICompat-HealthCheck',
        verboseDebug: true,
        includeBodyInLogs: true
      });
      const status = (resp?.status ?? 0) as number;
      const text = (await resp.text?.()) || '';
      const judged = judgeApiReachable(status, text);
      if (!judged.ok) {
        console.log('[OpenAICompatibleProvider] judged unreachable', { status, text: (text||'').slice(0,200) });
      }
      if (judged.ok) return { ok: true, message: judged.message, meta: { status } };
      return { ok: false, reason: 'UNKNOWN', message: `HTTP ${status}`, meta: { status } };
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (/timeout|abort/i.test(msg)) return { ok: false, reason: 'TIMEOUT', message: '连接超时' };
      if (/network|fetch|ENOTFOUND|ECONN/i.test(msg)) return { ok: false, reason: 'NETWORK', message: '网络错误' };
      return { ok: false, reason: 'UNKNOWN', message: msg };
    }
  }

  async chatStream(
    model: string,
    messages: LlmMessage[],
    cb: StreamCallbacks,
    opts: Record<string, any> = {}
  ): Promise<void> {
    const apiKey = await this.getApiKey(model);
    // 允许“无需密钥”的 Provider（例如 LM Studio）跳过密钥校验
    const requiresKey: boolean = (typeof (this as any).requiresKey === 'boolean') ? !!(this as any).requiresKey : true;
    if (requiresKey && !apiKey) {
      const err = new Error('NO_KEY');
      (err as any).code = 'NO_KEY';
      (err as any).userMessage = '未配置 API 密钥，请前往设置为该 Provider 或模型配置密钥';
      cb.onError?.(err);
      return;
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    // 过滤扩展字段（例如 mcpServers/extensions），只保留通用参数
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
    if (o.frequencyPenalty !== undefined && mapped.frequency_penalty === undefined)
      mapped.frequency_penalty = o.frequencyPenalty;
    if (o.presencePenalty !== undefined && mapped.presence_penalty === undefined)
      mapped.presence_penalty = o.presencePenalty;
    if (o.stop !== undefined && mapped.stop === undefined) mapped.stop = o.stop;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      ...mapped,
    };
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H3-body',message:'请求体构建',data:{model,hasToolDefs:!!(toolDefs&&toolDefs.length),toolDefsCount:toolDefs?.length||0,messageCount:messages.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    
    // 添加原生工具调用支持（如果提供了工具定义）
    if (toolDefs && Array.isArray(toolDefs) && toolDefs.length > 0) {
      body.tools = toOpenAITools(toolDefs as ToolDefinition[]);
      
      if (toolChoice) {
        body.tool_choice = toOpenAIToolChoice(toolChoice);
      }
      
      if (parallelToolCalls !== undefined) {
        body.parallel_tool_calls = parallelToolCalls;
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H3-tools',message:'原生工具已添加到请求',data:{toolCount:(body.tools as any[])?.length||0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
    }

    // 防止重复触发完成回调：同一条 SSE 流可能同时命中 [DONE]、finish_reason、reader.done 等多条完成分支
    let didComplete = false;
    const completeOnce = (reason: string, data?: Record<string, unknown>) => {
      const already = didComplete;
      if (didComplete) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H5-completeOnce:dup',message:'onComplete duplicate suppressed',data:{reason,...(data||{}),already},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
        // #endregion
        return;
      }
      didComplete = true;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H5-completeOnce',message:'onComplete fired',data:{reason,...(data||{})},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      cb.onComplete?.();
    };

    try {
      this.aborted = false;
      // 重置策略状态
      this.thinkingStrategy.reset();
      
      // 优先：Tauri HTTP（跨域/证书更稳健）
      let resp: any = null;
      try {
        const { tauriFetch } = await import('@/lib/request');
        resp = await tauriFetch(url, {
          method: 'POST',
          rawResponse: true,
          browserHeaders: true,
          headers: (() => {
            const h: Record<string, string> = {
              'Content-Type': 'application/json',
              'Accept': 'application/x-ndjson, application/json, text/event-stream',
            };
            if (apiKey) h.Authorization = `Bearer ${apiKey}`;
            return h;
          })(),
          body,
          debugTag: 'OpenAICompatStream',
        });
      } catch {
        resp = null;
      }

      // 次选：浏览器 fetch
      if (!resp) {
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: (() => {
              const h: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/x-ndjson, application/json, text/event-stream',
              };
              if (apiKey) h.Authorization = `Bearer ${apiKey}`;
              return h;
            })(),
            body: JSON.stringify(body),
          });
        } catch {
          resp = null;
        }
      }

      if (!resp || !resp.ok) {
        await this.startSSEFallback(url, apiKey || null, body, cb);
        return;
      }

      const contentType = (resp.headers.get?.('Content-Type') || '').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        // 🔧 修复：直接使用当前响应的 body 流，而不是重新发起请求
        // 之前的实现会调用 startSSEFallback 再次发送请求，导致服务端收到两个相同请求
        await this.processSSEResponse(resp, cb);
        return;
      }

      // NDJSON/JSON 流解析
      cb.onStart?.();
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('ReadableStream reader not available');
      this.currentReader = reader;
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      // —— 诊断：统计信息（便于判断是否"模型无输出"还是"解析丢失"）——
      let rawLineCount = 0;
      let parsedOkCount = 0;
      let contentEmittedChars = 0;
      const lastPayloadSamples: string[] = [];
      
      // 工具调用增量状态
      const toolCallState: Map<number, {
        id: string;
        name: string;
        arguments: string;
      }> = new Map();
      
      const processDelta = (json: any) => {
        if (!json) return;
        // 1) 先提取内容（包含最终 message.content），避免因 finish_reason 过早 return 丢失末帧内容
        const delta = json?.choices?.[0]?.delta ?? {};
        
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H4-delta',message:'处理delta',data:{hasToolCalls:!!delta?.tool_calls,hasContent:!!delta?.content,contentLen:delta?.content?.length||0,contentSample:(delta?.content||'').slice(0,100),finishReason:json?.choices?.[0]?.finish_reason},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        
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
        
        const reasoningPiece = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined;
        const contentPiece: string | undefined =
          (typeof delta.content === 'string' ? delta.content : undefined) ||
          (typeof json?.choices?.[0]?.message?.content === 'string' ? json.choices[0].message.content : undefined);
        
        let fullContent = '';
        if (reasoningPiece) fullContent = `<think>${reasoningPiece}</think>`;
        if (contentPiece) fullContent += contentPiece;
        if (fullContent) {
          const result = this.thinkingStrategy.processToken({ content: fullContent, done: false });
          parsedOkCount++;
          contentEmittedChars += fullContent.length;
          
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H4-dispatch',message:'派发内容事件',data:{contentLen:fullContent.length,eventsCount:result.events?.length||0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          
          this.dispatchEvents(result.events || [], cb);
        }
        // 2) 再处理结束信号
        const isDone = json === '[DONE]' || json?.done === true || !!json?.choices?.[0]?.finish_reason;
        if (isDone) {
          // 完成前，发送所有累积的工具调用
          this.emitPendingToolCalls(toolCallState, cb);
          
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OpenAICompatibleProvider.ts:H5-complete',message:'流完成',data:{rawLineCount,parsedOkCount,contentEmittedChars,toolCallsCount:toolCallState.size},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
          // #endregion
          
          const result = this.thinkingStrategy.processToken({ done: true });
          this.dispatchEvents(result.events || [], cb, true);
          completeOnce('finish_reason_or_done', { rawLineCount, parsedOkCount, contentEmittedChars, toolCallsCount: toolCallState.size });
          // —— 诊断输出：NDJSON 模式统计 —— 
          try {
            console.debug('[OpenAICompatibleProvider] NDJSON complete', {
              rawLineCount,
              parsedOkCount,
              contentEmittedChars,
              lastPayloadSamples,
              toolCallsEmitted: toolCallState.size,
            });
          } catch { /* noop */ }
          return;
        }
      };

      while (true) {
        if (this.aborted) {
          try { await reader.cancel(); } catch { /* noop */ }
          this.currentReader = null;
          return;
        }
        const { value, done } = await reader.read();
        if (done) {
          const last = buffer.trim();
          if (last) {
            const payload = last.startsWith('data:') ? last.slice(5).trim() : last;
            try { processDelta(JSON.parse(payload)); } catch { /* ignore */ }
          }
          const result = this.thinkingStrategy.processToken({ done: true });
          this.dispatchEvents(result.events || [], cb, true);
          completeOnce('reader_done', { rawLineCount, parsedOkCount, contentEmittedChars, toolCallsCount: toolCallState.size });
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line || line === '[DONE]') { 
            if (line === '[DONE]') { 
              const result = this.thinkingStrategy.processToken({ done: true });
              if (cb.onEvent && result.events && result.events.length > 0) {
                result.events.forEach(event => cb.onEvent!(event));
              } else if (cb.onToken && result.events && result.events.length > 0) {
                const text = StreamEventAdapter.eventsToText(result.events);
                if (text.length > 0) {
                  cb.onToken(text);
                }
              }
              completeOnce('line_DONE', { rawLineCount, parsedOkCount, contentEmittedChars, toolCallsCount: toolCallState.size });
            } 
            continue; 
          }
          rawLineCount++;
          const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
          if (lastPayloadSamples.length < 6) {
            lastPayloadSamples.push(payload.slice(0, 200));
          }
          try { processDelta(JSON.parse(payload)); } catch { /* ignore parse error */ }
        }
      }
    } catch (error: any) {
      console.error('[OpenAICompatibleProvider] stream error:', error);
      cb.onError?.(error);
    }
  }

  /**
   * 统一的事件分发入口：
   * - 先通过 ToolChannelParser 剥离工具指令 → 生成 tool_call 事件
   * - 再将纯净的事件流交给上层回调（优先 onEvent，降级 onToken）
   */
  private dispatchEvents(rawEvents: StreamEvent[] | undefined, cb: StreamCallbacks, _isDone: boolean = false) {
    if (!rawEvents || rawEvents.length === 0) return;
    const events = rewriteEventsWithToolCalls(rawEvents);
    if (!events.length) return;

    if (cb.onEvent) {
      for (const ev of events) cb.onEvent(ev);
    } else if (cb.onToken) {
      const text = StreamEventAdapter.eventsToText(events);
      if (text.length > 0) cb.onToken(text);
    }
  }

  /**
   * 处理已有的 SSE 响应流（避免重新发起请求）
   * 直接读取 Response.body 作为 SSE 流
   */
  private async processSSEResponse(resp: Response, cb: StreamCallbacks): Promise<void> {
    // 重置策略状态
    this.thinkingStrategy.reset();
    
    cb.onStart?.();
    
    const reader = resp.body?.getReader();
    if (!reader) {
      throw new Error('SSE response body reader not available');
    }
    
    this.currentReader = reader;
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    
    const processLine = (line: string) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      
      // 处理 SSE 的 data 行
      let payload = trimmedLine;
      if (trimmedLine.startsWith('data:')) {
        payload = trimmedLine.substring(5).trim();
      }
      
      if (!payload) return;
      
      if (payload === '[DONE]') {
        const result = this.thinkingStrategy.processToken({ done: true });
        this.dispatchEvents(result.events || [], cb, true);
        cb.onComplete?.();
        return;
      }
      
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta ?? {};
        const reasoningPiece = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined;
        const contentPiece: string | undefined =
          (typeof delta.content === 'string' ? delta.content : undefined) ||
          (typeof json?.choices?.[0]?.message?.content === 'string' ? json.choices[0].message.content : undefined);
        
        let fullContent = '';
        if (reasoningPiece) {
          fullContent = `<think>${reasoningPiece}</think>`;
        }
        if (contentPiece) {
          fullContent += contentPiece;
        }
        
        if (fullContent) {
          const result = this.thinkingStrategy.processToken({ content: fullContent, done: false });
          this.dispatchEvents(result.events || [], cb);
        }
        
        // 检查 finish_reason
        const finishReason = json?.choices?.[0]?.finish_reason;
        if (finishReason && finishReason !== 'null') {
          const result = this.thinkingStrategy.processToken({ done: true });
          this.dispatchEvents(result.events || [], cb, true);
          cb.onComplete?.();
        }
      } catch {
        // JSON 解析失败，忽略
      }
    };
    
    try {
      while (!this.aborted) {
        const { done, value } = await reader.read();
        
        if (done) {
          // 处理缓冲区中剩余的内容
          if (buffer.trim()) {
            processLine(buffer);
          }
          const result = this.thinkingStrategy.processToken({ done: true });
          this.dispatchEvents(result.events || [], cb, true);
          cb.onComplete?.();
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          processLine(line);
        }
      }
    } catch (error: any) {
      if (this.aborted) {
        cb.onComplete?.();
      } else {
        cb.onError?.(error);
      }
    } finally {
      this.currentReader = null;
    }
  }

  private async startSSEFallback(
    url: string,
    apiKey: string | null,
    body: unknown,
    cb: StreamCallbacks
  ) {
    // 重置策略状态
    this.thinkingStrategy.reset();
    
    try {
      await this.sseClient.startConnection(
        {
          url,
          method: 'POST',
          headers: {
            'Accept-Encoding': 'identity',
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body,
          debugTag: 'OpenAICompatibleProvider',
        },
        {
          onStart: cb.onStart,
          onError: cb.onError,
          onData: (rawData: string) => {
            // —— 诊断：统计 —— 
            // 注意：SSE 由后端拆“行”，这里统计的是每个 data 行
            const payload = rawData.startsWith('data:') ? rawData.substring(5).trim() : rawData.trim();
            if (!payload) return;
            if (payload === '[DONE]') {
              const result = this.thinkingStrategy.processToken({ done: true });
              this.dispatchEvents(result.events || [], cb, true);
              cb.onComplete?.();
              this.sseClient.stopConnection();
              return;
            }
            try {
              const json = JSON.parse(payload);
              const delta = json?.choices?.[0]?.delta ?? {};
              const reasoningPiece = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined;
              const contentPiece: string | undefined =
                (typeof delta.content === 'string' ? delta.content : undefined) ||
                (typeof json?.choices?.[0]?.message?.content === 'string' ? json.choices[0].message.content : undefined);
              
              // 构造完整的token内容（reasoning + content）
              let fullContent = '';
              if (reasoningPiece) {
                fullContent = `<think>${reasoningPiece}</think>`;
              }
              if (contentPiece) {
                fullContent += contentPiece;
              }
              
              if (fullContent) {
                const result = this.thinkingStrategy.processToken({
                  content: fullContent,
                  done: false
                });
                this.dispatchEvents(result.events || [], cb);
              }
            } catch (err) {
              console.warn('[OpenAICompatibleProvider] JSON parse error', err);
            }
          },
          onClose: () => {
            try { console.debug('[OpenAICompatibleProvider] SSE closed'); } catch { /* noop */ }
          }
        }
      );
    } catch (error) {
      console.error('[OpenAICompatibleProvider] SSE fallback failed:', error);
      cb.onError?.(error as any);
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
      let serverName = 'default';
      let toolName = tc.name;
      
      if (tc.name.includes('__')) {
        const parts = tc.name.split('__');
        serverName = parts[0];
        toolName = parts.slice(1).join('__');
      } else if (tc.name.includes('.')) {
        const parts = tc.name.split('.');
        serverName = parts[0];
        toolName = parts.slice(1).join('.');
      }
      
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

  async destroy(): Promise<void> {
    await this.sseClient.destroy();
  }

  cancelStream(): void {
    this.aborted = true;
    try { this.currentReader?.cancel(); } catch { /* noop */ }
    this.currentReader = null;
    this.sseClient.stopConnection();
  }
}


