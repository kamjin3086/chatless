import { tauriFetch } from '@/lib/request';
import type { StreamEvent } from '@/lib/llm/types/stream-events';
import type { ToolCallRequest } from '@/lib/llm/types/tool-schema';

/**
 * 通用消息结构，后续可移到独立 types 文件
 */
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
  images?: string[];
  // —— ChatCompletions tool calling (OpenAI-compatible) ——
  tool_call_id?: string;
  tool_calls?: ToolCallRequest[];
  name?: string;
  providerData?: Record<string, unknown>;
  raw?: unknown;
}

export interface CheckResult {
  ok: boolean;
  reason?: 'NO_KEY' | 'AUTH' | 'NETWORK' | 'TIMEOUT' | 'UNKNOWN';
  message?: string;
  meta?: any;
}

export interface StreamCallbacks {
  /**
   * 结构化事件回调（推荐使用）
   * 接收Provider输出的结构化事件，无需再次解析
   */
  onEvent?: (event: StreamEvent) => void;
  
  onStart?: () => void;
  
  /**
   * 文本token回调（向后兼容）
   * 如果提供了onEvent，onToken将被忽略
   */
  onToken?: (token: string) => void;
  
  /**
   * 可选：当提供商返回内联图片数据（如 Google inlineData）时回调
   * data 为 base64 字符串（不带前缀），mimeType 如 image/png
   */
  onImage?: (image: { mimeType: string; data: string }) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}

export interface SseRequestOptions {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: any;
}

/**
 * 抽象基类：各 Provider 继承并实现具体行为
 */
export abstract class BaseProvider {
  /** 存放取消 SSE 监听的函数数组，由派生类负责填充 */
  protected sseUnlisten: Array<() => void> | null = null;
  constructor(
    public readonly name: string,
    protected baseUrl: string,
    protected apiKey?: string | null
  ) {}

  protected async getApiKey(model?: string): Promise<string | null> {
    const { KeyManager } = await import('../KeyManager');
    // 支持别名：当作为聚合委派时，用 aliasProviderName 进行 key 查找
    const aliasName: string = (this as any).aliasProviderName || this.name;
    if (model) {
      const modelKey = await KeyManager.getModelKey(aliasName, model);
      if (modelKey) return modelKey;
    }
    return await KeyManager.getProviderKey(aliasName);
  }

  /**
   * 健康 / 鉴权检查
   */
  abstract checkConnection(): Promise<CheckResult>;

  /**
   * SSE / 流式聊天
   */
  abstract chatStream(
    model: string,
    messages: LlmMessage[],
    callbacks: StreamCallbacks,
    options?: Record<string, any>
  ): Promise<void>;

  /**
   * （可选）拉取模型列表
   *
   * 统一约定（非常重要）：
   * - 成功时返回“权威列表”数组，允许返回空数组（表示在线端没有可用模型）；
   * - 返回 null 表示暂不支持或调用失败（网络/权限等），上层会自动回退到
   *   “缓存 ∪ 静态模型”的并集，避免界面空白；
   * - 不需要做排序/去重/持久化，这些由 ProviderModelService 统一处理；
   * - 若 provider 需要使用自定义 baseUrl，请确保在构造后设置好（上层会在调用前
   *   尝试同步最新 URL）。
   */
  fetchModels?(): Promise<Array<{name: string, label?: string, aliases?: string[]}> | null>;

  /**
   * 取消流式连接
   */
  cancelStream?(): void;

  /**
   * 销毁资源
   */
  destroy?(): Promise<void>;

  // —— 公用工具 ——
  protected async fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
    const resp = await tauriFetch(url, init as any);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status} ${resp.statusText}\n${body}`);
    }
    return await resp.json();
  }
}
