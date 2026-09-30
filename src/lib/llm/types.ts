import type { ToolCallRequest } from './types/tool-schema';
import type { StreamEvent } from './types/stream-events';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool' | 'developer';

export interface Message {
  role: ChatRole;
  content: string;
  id?: string;
  images?: string[]; // base64 Data URLs
  error?: boolean; // Added for UI error display
  // —— ChatCompletions tool calling (OpenAI-compatible) ——
  tool_call_id?: string;
  tool_calls?: ToolCallRequest[];
  name?: string;
  /** Provider-specific fields (reasoning content, thought signatures, etc.). */
  providerData?: Record<string, unknown>;
  /** Original provider message, kept for lossless replay when required. */
  raw?: unknown;
}

export interface StreamCallbacks {
  /**
   * 结构化事件回调（推荐）
   */
  onEvent?: (event: StreamEvent) => void;
  onStart?: () => void;
  /**
   * 文本token回调（向后兼容）
   */
  onToken?: (token: string) => void;
  onImage?: (image: { mimeType: string; data: string }) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface ChatOptions {
  temperature?: number;
  apiKey?: string;
  baseUrl?: string; // Optional override for provider base URL
  [key: string]: any; // Allow additional provider-specific options
}

