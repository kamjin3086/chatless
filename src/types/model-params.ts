import { DEFAULT_MAX_OUTPUT_TOKENS } from '@/lib/llm/outputBudget';

export interface ModelParameters {
  // 启用/禁用控制（为每个基础参数提供可选开关）
  enableTemperature?: boolean;
  /**
   * 输出上限三态：
   * - `undefined`（默认）= 自动，按上下文窗口推算，窗口未知则不下发；
   * - `true` = 手动，下发下面的 maxTokens（并按窗口收敛）；
   * - `false` = 关闭，始终不下发。
   */
  enableMaxTokens?: boolean;
  enableTopP?: boolean;
  enableTopK?: boolean;
  enableMinP?: boolean;
  enableFrequencyPenalty?: boolean;
  enablePresencePenalty?: boolean;
  enableStopSequences?: boolean;
  enableThinking?: boolean;  // 控制思考模式（Ollama等支持）
  enableStreaming?: boolean; // 控制流式响应
  enableFormat?: boolean;    // 控制输出格式（Ollama等支持）

  temperature: number;
  maxTokens: number;
  /**
   * 模型上下文窗口（tokens）。未知时不填：输出预算与压缩都按"未知"处理，
   * 由服务端决定输出长度。provider 上报或用户填写后才会自适应下发 max_tokens。
   */
  contextWindow?: number;
  /**
   * 服务商上报的上下文窗口。与用户填写的 contextWindow 分开保存，
   * 实际生效值取两者中较小的一个；用户不需要为了"接受上报值"而清空自己的填写。
   */
  observedContextWindow?: number;
  topP: number;
  topK: number;
  minP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stopSequences: string[];
  thinking?: boolean;  // 是否启用思考（默认true）
  streaming?: boolean; // 是否启用流式响应（默认true）
  format?: string;     // 输出格式（如"json"）
  responseFormat?: 'none' | 'json' | 'schema'; // 响应格式控制
  responseFormatSchema?: string; // JSON Schema（当responseFormat为schema时）
  /** 可选：高级参数（将直接合并到 Provider 选项中），例如 Gemini 的 generationConfig */
  advancedOptions?: Record<string, any>;
}

export interface ModelConfig {
  providerName: string;
  modelId: string;
  parameters: ModelParameters;
  lastUpdated: number;
}

export const DEFAULT_MODEL_PARAMETERS: ModelParameters = {
  // 参数默认不下发，交给模型自身默认值。
  // maxTokens 默认是"自动"（enableMaxTokens 不填）：不向模型下发该参数，
  // 单次输出多久由服务端决定；用户手动设值时才下发。
  enableTemperature: false,
  enableTopP: false,
  enableTopK: false,
  enableMinP: false,
  enableFrequencyPenalty: false,
  enablePresencePenalty: false,
  enableStopSequences: false,
  enableThinking: false,  // 默认不启用思考（避免不兼容的模型报错）
  enableStreaming: true,  // 默认启用流式响应（大多数情况下需要实时输出）
  temperature: 0.7,
  maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  topP: 1.0,
  topK: 0,
  minP: 0,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
  stopSequences: [],
  thinking: true,  // 默认启用
  streaming: true, // 默认启用
  responseFormat: 'none', // 默认不限制格式
  responseFormatSchema: '',
  advancedOptions: {}
};

export const MODEL_PARAMETER_LIMITS = {
  temperature: { 
    min: 0.0, max: 2.0, step: 0.1,
    inputMin: 0.0, inputMax: 10.0
  },
  maxTokens: { 
    min: 1, max: 32768, step: 1,
    inputMin: 1, inputMax: 1000000
  },
  contextWindow: {
    min: 2048, max: 2000000, step: 1024,
    inputMin: 512, inputMax: 2000000
  },
  topP: { 
    min: 0.0, max: 1.0, step: 0.1,
    inputMin: 0.0, inputMax: 1.0
  },
  topK: { 
    min: 0, max: 200, step: 1,
    inputMin: 0, inputMax: 10000
  },
  minP: { 
    min: 0.0, max: 1.0, step: 0.05,
    inputMin: 0.0, inputMax: 1.0
  },
  frequencyPenalty: { 
    min: -2.0, max: 2.0, step: 0.1,
    inputMin: -10.0, inputMax: 10.0
  },
  presencePenalty: { 
    min: -2.0, max: 2.0, step: 0.1,
    inputMin: -10.0, inputMax: 10.0
  }
}; 
