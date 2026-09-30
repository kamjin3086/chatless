/**
 * Thinking Strategy类型定义
 */

import type { StreamEvent } from '../../types/stream-events';

/**
 * Thinking输入token
 * 
 * 不同Provider的字段可能不同：
 * - Ollama: thinking字段
 * - OpenAI: content字段（需解析<think>标签）
 * - DeepSeek: reasoning_content字段或<reasoning>标签
 */
export interface ThinkingToken {
  /** Ollama格式：直接的thinking内容 */
  thinking?: string;
  
  /** DeepSeek格式：reasoning内容 */
  reasoning_content?: string;
  
  /** 标准格式：可能包含<think>或<reasoning>标签的内容 */
  content?: string;
  
  /** 流是否结束 */
  done?: boolean;
}

/**
 * 处理结果
 */
export interface ProcessedOutput {
  /** 生成的结构化事件数组 */
  events: StreamEvent[];
  
  /** 流是否完成 */
  isComplete: boolean;

  /**
   * 上游模型输出了 chat template 的回合边界标记（例如 `<|im_end|>`）。
   * 该标记之后的内容属于模型自行续写的下一轮，已被丢弃；provider 可据此
   * 提前结束读取。详见 `turnBoundary.ts`。
   */
  turnEnded?: boolean;

  /** 回合边界之后被丢弃的字符数（仅诊断用途）。 */
  turnEndDroppedChars?: number;
}

/**
 * Thinking模式策略接口
 * 
 * 所有ThinkingStrategy都应实现此接口
 */
export interface ThinkingModeStrategy {
  /**
   * 处理token，生成结构化事件
   */
  processToken(token: ThinkingToken): ProcessedOutput;
  
  /**
   * 重置策略状态
   */
  reset(): void;
}

