/**
 * 标准Thinking策略（重构版）
 * 
 * ## 适用Provider
 * 
 * - OpenAI (ChatGPT, GPT-4)
 * - Anthropic (Claude)
 * - Google AI (Gemini)
 * - OpenAI Compatible APIs
 * 
 * ## 特性
 * 
 * 1. **<think>标签解析**：从content中提取`<think>...</think>`标签内容
 * 2. **流式输出**：thinking内容实时显示
 * 3. **MCP解析**：支持工具调用识别
 * 
 * ## 工作原理
 * 
 * ```
 * 输入: "Some <think>reasoning</think> text"
 *   ↓ 累积到buffer
 * 检测: 是否包含完整的<think>标签对
 *   ↓ 如果是
 * 提取: "reasoning"
 *   ↓
 * 输出: thinking_token事件
 *   ↓
 * 清理: 从buffer移除已解析部分
 * ```
 * 
 * ## 示例
 * 
 * ### 输入序列
 * ```
 * token1: "Let me <th"
 * token2: "ink>analyze "
 * token3: "this</think> So"
 * ```
 * 
 * ### 输出事件
 * ```
 * thinking_start
 * thinking_token("analyze this")
 * thinking_end
 * content_token("So")
 * ```
 */

import { BaseStreamingStrategy } from './base-streaming-strategy';
import type { ThinkingToken, ProcessedOutput } from './types';
import type { ThinkingStartEvent } from '../../types/stream-events';
import { ContentParserFactory } from './content-parser';
import type { StreamEvent } from '../../types/stream-events';

export class StandardThinkingStrategy extends BaseStreamingStrategy {
  /** 标签解析缓冲区（处理跨token的<think>标签） */
  private tagBuffer: string = '';
  /** 是否检测到<think>开始标签（支持开放标签流式模式） */
  private detectedThinkStart: boolean = false;
  
  constructor() {
    super();
    
    // 注册标准解析器管道
    // 包含：McpToolCallParser, CodeBlockParser
    this.contentParsers = ContentParserFactory.createStandardPipeline();
  }
  
  /**
   * 提取thinking内容
   * 
   * 标准格式需要从content中提取<think>标签
   * 
   * 挑战：
   * - <think>标签可能跨越多个token
   * - 需要累积buffer直到遇到完整的标签对
   * 
   * @param token - 输入token
   * @returns 提取的thinking内容（如果找到完整标签）
   */
  protected extractThinkingContent(token: ThinkingToken): string {
    if (!token.content) return '';
    
    // 累积到buffer
    this.tagBuffer += token.content;
    
    // 检测<think>开始标签（可能跨token）
    if (!this.detectedThinkStart && this.tagBuffer.includes('<think>')) {
      this.detectedThinkStart = true;
      // 移除<think>标签本身（只移除第一个，避免误删内容里的字面量）
      this.tagBuffer = this.tagBuffer.replace(/<think>/i, '');
    }

    // 若已进入 thinking：开放标签流式模式
    // - 若遇到闭合 </think>，返回闭合前内容并退出 thinking
    // - 否则：把当前缓冲全部作为 thinking token 输出（实时），并清空缓冲等待后续 chunk
    if (this.detectedThinkStart) {
      const closeTagIndex = this.tagBuffer.indexOf('</think>');
      if (closeTagIndex >= 0) {
        const thinkingContent = this.tagBuffer.substring(0, closeTagIndex);
        this.tagBuffer = this.tagBuffer.substring(closeTagIndex + '</think>'.length);
        this.detectedThinkStart = false;
        return thinkingContent;
      }
      const thinkingContent = this.tagBuffer;
      this.tagBuffer = '';
      return thinkingContent;
    }

    return '';
  }
  
  /**
   * 获取thinking模式
   * 
   * @returns undefined - 标准模式，不指定特定mode
   */
  protected getThinkingMode(): ThinkingStartEvent['mode'] {
    return undefined;
  }

  /**
   * 重写 token 处理：支持开放标签流式模式，并确保不会把 thinking 内容作为正文重复输出。
   *
   * 关键行为：
   * - 进入 thinking 后：不再输出原始 token.content（避免 <think> 泄漏与重复）
   * - 遇到 </think>：thinking_end 后，继续输出 </think> 之后的正文（若有）
   */
  processToken(token: ThinkingToken): ProcessedOutput {
    const events: StreamEvent[] = [];

    const wasInThinkingMode = this.detectedThinkStart;

    // 1) 先处理 thinking（开放标签流式）— 仅解析一次
    const thinkingContent = this.extractThinkingContent(token);
    if (thinkingContent) {
      events.push(...this.processThinkingStream(thinkingContent));
    }

    if (thinkingContent || wasInThinkingMode || this.detectedThinkStart) {
      const exitedThinkingMode = wasInThinkingMode && !this.detectedThinkStart;
      if (exitedThinkingMode) {
        if (this.tagBuffer.length > 0) {
          const remaining = this.tagBuffer;
          this.tagBuffer = '';
          events.push(...this.processContentStream(remaining));
        } else {
          // 触发 thinking_end + parseBufferedThinking（由 processContentStream 完成）
          events.push(...this.processContentStream(''));
        }
      } else if (this.detectedThinkStart) {
        // 仍处于开放 thinking：不要输出正文，避免重复
        if (token.done) {
          // done 强制结束 thinking（由 processContentStream 触发 thinking_end + parseBufferedThinking）
          events.push(...this.processContentStream(''));
        }
        if (token.done) {
          events.push(...this.finalize());
        }
        return { events, isComplete: token.done || false };
      }
    }

    // 2) 不在 thinking 时，正常输出正文
    if (!this.detectedThinkStart && token.content) {
      events.push(...this.processContentStream(token.content));
    }

    // 3) 流结束收尾
    if (token.done) {
      events.push(...this.finalize());
    }

    return { events, isComplete: token.done || false };
  }
  
  /**
   * 重置策略状态
   * 
   * 除了基类状态，还需要清理标签缓冲区
   */
  reset(): void {
    super.reset();
    this.tagBuffer = '';
    this.detectedThinkStart = false;
  }
}

