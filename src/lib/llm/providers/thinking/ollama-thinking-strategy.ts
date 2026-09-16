/**
 * Ollama Thinking策略（重构版）
 * 
 * ## 支持的格式
 * 
 * 1. **原生格式**：使用`message.thinking`字段（优先）
 * 2. **兼容格式**：在`message.content`中使用`<think>`标签
 * 
 * ## 特性
 * 
 * 1. **双模式支持**：自动识别并处理两种thinking格式
 * 2. **流式输出**：thinking内容实时显示，不批量缓冲
 * 3. **MCP解析**：自动识别和解析`<use_mcp_tool>`工具调用
 * 4. **智能标签清理**：自动从content中移除`<think>`标签，避免重复显示
 * 
 * ## 工作流程
 * 
 * ```
 * 1. 收到token
 *    ↓
 * 2. 检查thinking字段或content中的<think>标签
 *    ↓
 * 3. 立即发送thinking_token事件（实时显示）
 *    ↓
 * 4. 从content中移除<think>标签（如果使用标签模式）
 *    ↓
 * 5. 遇到content或done
 *    ↓
 * 6. 发送thinking_end事件
 *    ↓
 * 7. 批量解析缓冲区（提取MCP调用）
 *    ↓
 * 8. 发送tool_call事件（如果有）
 * ```
 * 
 * @see BaseStreamingStrategy
 * @see ContentParser
 */

import { BaseStreamingStrategy } from './base-streaming-strategy';
import type { ThinkingToken, ProcessedOutput } from './types';
import type { ThinkingStartEvent, StreamEvent } from '../../types/stream-events';
import { ContentParserFactory } from './content-parser';

export class OllamaThinkingStrategy extends BaseStreamingStrategy {
  /** 标签解析缓冲区（处理跨token的<think>标签） */
  private tagBuffer: string = '';
  
  /** 是否检测到<think>开始标签（用于处理不完整标签） */
  private detectedThinkStart: boolean = false;
  
  constructor() {
    super();
    
    // 注册Ollama专用的解析器管道
    // 包含：McpToolCallParser
    this.contentParsers = ContentParserFactory.createOllamaPipeline();
  }
  
  /**
   * 提取thinking内容
   * 
   * Ollama支持三种模式：
   * 1. 原生模式：使用message.thinking字段（优先）
   * 2. 完整标签模式：<think>...</think>
   * 3. 开放标签模式：<think> 后续所有内容都是thinking，直到</think>或done
   * 
   * @param token - 输入token
   * @returns thinking内容字符串
   */
  protected extractThinkingContent(token: ThinkingToken): string {
    // 模式1：优先使用thinking字段（原生Ollama格式）
    if (token.thinking) {
      return token.thinking;
    }
    
    // 模式2/3：从content中提取<think>标签
    if (!token.content) return '';
    
    // 累积到buffer
    this.tagBuffer += token.content;
    
    // 检测<think>开始标签
    if (!this.detectedThinkStart && this.tagBuffer.includes('<think>')) {
      this.detectedThinkStart = true;
      // 移除<think>标签本身
      this.tagBuffer = this.tagBuffer.replace(/<think>/i, '');
    }
    
    // 如果检测到开始标签，提取thinking内容
    if (this.detectedThinkStart) {
      // 检查是否有闭合标签
      const closeTagIndex = this.tagBuffer.indexOf('</think>');
      
      if (closeTagIndex >= 0) {
        // 找到闭合标签，提取完整thinking内容
        const thinkingContent = this.tagBuffer.substring(0, closeTagIndex);
        // 移除thinking部分和闭合标签
        this.tagBuffer = this.tagBuffer.substring(closeTagIndex + 8); // 8 = '</think>'.length
        this.detectedThinkStart = false;
        return thinkingContent;
      } else {
        // 没有闭合标签，所有content都是thinking
        const thinkingContent = this.tagBuffer;
        this.tagBuffer = '';
        return thinkingContent;
      }
    }
    
    return '';
  }
  
  /**
   * 获取thinking模式
   * 
   * @returns 'ollama' - 用于thinking_start事件的mode字段
   */
  protected getThinkingMode(): ThinkingStartEvent['mode'] {
    return 'ollama';
  }
  
  /**
   * 处理token（重写以支持开放标签模式）
   * 
   * 关键改进：
   * - 支持不完整的<think>标签（只有开始标签，没有闭合标签）
   * - 支持完整标签模式（<think>...</think>），正确处理</think>后的content
   * - 在thinking模式下，不输出content（避免重复）
   * - 检测到</think>或done时结束thinking模式
   */
  processToken(token: ThinkingToken): ProcessedOutput {
    const events: StreamEvent[] = [];
    
    // 记录进入时的thinking状态
    const wasInThinkingMode = this.detectedThinkStart;
    
    // 1. 处理thinking内容（仅解析一次）
    const thinkingContent = this.extractThinkingContent(token);
    if (thinkingContent) {
      events.push(...this.processThinkingStream(thinkingContent));
    }

    if (thinkingContent || wasInThinkingMode || this.detectedThinkStart) {
      const exitedThinkingMode = wasInThinkingMode && !this.detectedThinkStart;
      
      if (exitedThinkingMode) {
        // 找到了闭合标签，thinking结束
        // tagBuffer中可能有</think>后的内容，需要处理
        if (this.tagBuffer.length > 0) {
          const remainingContent = this.tagBuffer;
          this.tagBuffer = '';
          events.push(...this.processContentStream(remainingContent));
        } else {
          // 没有剩余内容，只发送thinking_end
          events.push(...this.processContentStream(''));
        }
      } else if (this.detectedThinkStart) {
        // 仍在开放标签模式中（没有闭合标签）
        // 不处理content，因为已经被当作thinking处理了
        
        // 检查是否到达done（强制结束thinking）
        if (token.done) {
          events.push(...this.processContentStream(''));
        }
        
        // 提前返回，不再处理content
        return {
          events,
          isComplete: token.done || false
        };
      }
    }
    
    // 2. 如果不在thinking模式，正常处理content
    if (!this.detectedThinkStart && token.content) {
      events.push(...this.processContentStream(token.content));
    }
    
    // 3. 结束时批量解析特殊内容
    if (token.done) {
      events.push(...this.finalize());
    }
    
    return {
      events,
      isComplete: token.done || false
    };
  }
  
  /**
   * 重置策略状态
   * 
   * 除了基类状态，还需要清理标签缓冲区和检测标记
   */
  reset(): void {
    super.reset();
    this.tagBuffer = '';
    this.detectedThinkStart = false;
  }
}

