/**
 * Thinking Strategy工厂
 * 
 * ## 职责
 * 
 * 根据Provider类型或模型名称创建合适的ThinkingStrategy实例
 * 
 * ## 设计原则
 * 
 * 1. **单一创建点**：集中管理Strategy创建逻辑
 * 2. **智能匹配**：根据模型名称自动选择合适的Strategy
 * 3. **可扩展**：易于添加新的Provider支持
 * 
 * ## 匹配规则
 * 
 * | Provider/Model | Strategy | 依据 |
 * |----------------|----------|------|
 * | Ollama | OllamaThinkingStrategy | 使用message.thinking字段 |
 * | deepseek-* | DeepSeekReasoningStrategy | DeepSeek模型 |
 * | gpt-*, claude-*, gemini-* | StandardThinkingStrategy | 标准<think>标签 |
 * | 其他 | StandardThinkingStrategy | 默认策略 |
 */

import type { ThinkingModeStrategy } from './types';
import { OllamaThinkingStrategy } from './ollama-thinking-strategy';
import { StandardThinkingStrategy } from './standard-thinking-strategy';
import { DeepSeekReasoningStrategy } from './deepseek-reasoning-strategy';
import { guardTurnBoundaries } from './turnBoundary';

export class ThinkingStrategyFactory {
  /**
   * 根据模型名称创建Strategy
   * 
   * @param modelName - 模型名称（如'deepseek-chat', 'gpt-4', 'llama3'）
   * @returns 对应的ThinkingStrategy实例
   * 
   * @example
   * ```typescript
   * const strategy = ThinkingStrategyFactory.createStrategy('deepseek-chat');
   * // 返回 DeepSeekReasoningStrategy
   * 
   * const strategy2 = ThinkingStrategyFactory.createStrategy('gpt-4');
   * // 返回 StandardThinkingStrategy
   * ```
   */
  static createStrategy(modelName: string): ThinkingModeStrategy {
    const lowerModel = (modelName || '').toLowerCase();
    
    // DeepSeek模型
    if (lowerModel.includes('deepseek')) {
      return guardTurnBoundaries(new DeepSeekReasoningStrategy());
    }
    
    // 其他使用标准策略
    // 包括：gpt-*, claude-*, gemini-*, 等
    return guardTurnBoundaries(new StandardThinkingStrategy());
  }
  
  /**
   * 创建Ollama专用Strategy
   * 
   * @returns OllamaThinkingStrategy实例
   * 
   * @example
   * ```typescript
   * // 在OllamaProvider中使用
   * this.thinkingStrategy = ThinkingStrategyFactory.createOllamaStrategy();
   * ```
   */
  static createOllamaStrategy(): ThinkingModeStrategy {
    return guardTurnBoundaries(new OllamaThinkingStrategy());
  }
  
  /**
   * 创建标准Strategy
   * 
   * @returns StandardThinkingStrategy实例
   * 
   * @example
   * ```typescript
   * // 用于不确定的Provider
   * this.thinkingStrategy = ThinkingStrategyFactory.createStandardStrategy();
   * ```
   */
  static createStandardStrategy(): ThinkingModeStrategy {
    return guardTurnBoundaries(new StandardThinkingStrategy());
  }
  
  /**
   * 创建DeepSeek专用Strategy
   * 
   * @returns DeepSeekReasoningStrategy实例
   * 
   * @example
   * ```typescript
   * // 在DeepSeekProvider中使用
   * this.thinkingStrategy = ThinkingStrategyFactory.createDeepSeekStrategy();
   * ```
   */
  static createDeepSeekStrategy(): ThinkingModeStrategy {
    return guardTurnBoundaries(new DeepSeekReasoningStrategy());
  }
}

