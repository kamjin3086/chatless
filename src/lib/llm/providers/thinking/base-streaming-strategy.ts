/**
 * 基础流式Thinking策略
 * 
 * ## 设计原则
 * 
 * 1. **流式优先**：thinking内容实时输出，不缓冲等待
 * 2. **关注点分离**：流式输出与内容解析分离
 * 3. **可扩展性**：通过ContentParser插件化扩展解析能力
 * 4. **统一行为**：所有ThinkingStrategy都遵循相同的流式输出模式
 * 
 * ## 架构
 * 
 * ```
 * BaseStreamingStrategy (基类)
 *   ├── processToken() - 模板方法模式
 *   ├── processThinkingStream() - 实时流式输出
 *   ├── parseBufferedThinking() - 批量解析特殊内容
 *   └── contentParsers[] - 内容解析器管道
 * ```
 * 
 * ## 使用方式
 * 
 * ```typescript
 * export class OllamaThinkingStrategy extends BaseStreamingStrategy {
 *   constructor() {
 *     super();
 *     this.contentParsers = [new McpToolCallParser()];
 *   }
 *   
 *   protected extractThinkingContent(token: ThinkingToken): string {
 *     return token.thinking || '';
 *   }
 *   
 *   protected getThinkingMode() {
 *     return 'ollama';
 *   }
 * }
 * ```
 */

import type { 
  ThinkingModeStrategy, 
  ThinkingToken, 
  ProcessedOutput 
} from './types';
import type { StreamEvent, ThinkingStartEvent } from '../../types/stream-events';
import { createStreamEvent } from '../../types/stream-events';
import type { ContentParser } from './content-parser';

export abstract class BaseStreamingStrategy implements ThinkingModeStrategy {
  /** thinking内容缓冲区（仅用于批量解析） */
  protected thinkingBuffer: string = '';
  
  /** content内容缓冲区 */
  protected contentBuffer: string = '';
  
  /** 内容门控：侦测到工具调用起始后暂停向UI发送content_token */
  protected contentGateActive: boolean = false;
  /** 被门控暂存的内容（等待完整闭合标签后解析） */
  protected gatedContentBuffer: string = '';
  /** 门控缓冲区最大长度（超过此长度则认为不是工具调用，释放内容） */
  private readonly MAX_GATED_BUFFER_LENGTH = 2000;
  
  /** 是否正在thinking模式 */
  protected isInThinkingMode: boolean = false;
  
  /** 是否已开始thinking（用于发送start事件） */
  protected hasStartedThinking: boolean = false;
  
  /** 内容解析器管道（子类可扩展） */
  protected contentParsers: ContentParser[] = [];
  
  /**
   * 处理token - 模板方法模式
   * 
   * 流程：
   * 1. 处理thinking内容（实时流式输出）
   * 2. 处理content内容
   * 3. 结束时批量解析特殊内容
   */
  processToken(token: ThinkingToken): ProcessedOutput {
    const events: StreamEvent[] = [];
    
    // 1. 处理thinking内容（实时流式输出）
    if (this.shouldProcessThinking(token)) {
      events.push(...this.processThinkingStream(token));
    }
    
    // 2. 处理content内容
    if (token.content && token.content.length > 0) {
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
   * 处理thinking流 - 实时输出
   * 
   * 关键特性：
   * - 首次thinking token：发送thinking_start事件
   * - 每个thinking token：立即发送thinking_token事件
   * - 同时缓冲内容用于后续批量解析
   */
  protected processThinkingStream(token: ThinkingToken): StreamEvent[] {
    const events: StreamEvent[] = [];
    const thinkingContent = this.extractThinkingContent(token);
    
    if (!thinkingContent) return events;
    
    // 首次thinking：发送start事件
    if (!this.hasStartedThinking) {
      events.push(createStreamEvent.thinkingStart(this.getThinkingMode()));
      this.hasStartedThinking = true;
      this.isInThinkingMode = true;
    }
    
    // ✅ 关键：实时发送thinking token，不等待
    events.push(createStreamEvent.thinkingToken(thinkingContent));
    
    // 同时缓冲（用于后续批量解析特殊内容）
    this.thinkingBuffer += thinkingContent;
    
    return events;
  }
  
  /**
   * 提取thinking内容 - 子类实现
   * 
   * 不同Provider的thinking字段位置不同：
   * - Ollama: token.thinking
   * - OpenAI: 从token.content中提取<think>标签
   * - DeepSeek: token.reasoning_content 或 <reasoning>标签
   */
  protected abstract extractThinkingContent(token: ThinkingToken): string;
  
  /**
   * 获取thinking模式 - 子类实现
   * 
   * 用于thinking_start事件的mode字段
   */
  protected abstract getThinkingMode(): ThinkingStartEvent['mode'];
  
  /**
   * 判断是否应该处理thinking
   */
  protected shouldProcessThinking(token: ThinkingToken): boolean {
    const content = this.extractThinkingContent(token);
    return !!content && content.length > 0;
  }
  
  /**
   * 处理content流
   * 
   * 当遇到content时：
   * 1. 如果在thinking模式，发送thinking_end
   * 2. 批量解析缓冲的thinking内容（提取MCP调用等）
   * 3. 累积content到buffer
   * 4. **实时检测content中的完整工具调用**
   * 5. 输出content_token事件
   * 
   * ## 关键优化：实时工具调用检测
   * 
   * 之前只在finalize时解析contentBuffer，导致流式期间用户看到原始指令。
   * 现在每次contentBuffer更新后立即检测完整的<use_mcp_tool>标签，
   * 一旦检测到完整指令就触发tool_call事件，让segments层过滤掉原始文本。
   */
  protected processContentStream(content: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    
    // 如果在thinking模式，遇到content表示thinking结束
    if (this.isInThinkingMode) {
      events.push(createStreamEvent.thinkingEnd());
      this.isInThinkingMode = false;
      
      // 对缓冲的thinking内容进行批量解析（提取MCP调用等）
      events.push(...this.parseBufferedThinking());
    }
    
    // 门控策略：一旦检测到工具调用起始（<use_mcp_tool 或 <tool_call），
    // 暂停向UI发送content_token，直到检测到完整闭合标签为止
    let remaining = content;
    
    if (this.contentGateActive) {
      this.gatedContentBuffer += remaining;
      remaining = '';
    } else {
      // 修复：使用更精确的正则表达式，避免误匹配其他标签
      // 只匹配完整的工具调用标签开始：<use_mcp_tool 或 <tool_call
      const startIdx = remaining.search(/<use_mcp_tool|<tool_call/i);
      if (startIdx >= 0) {
        // 起始标记前的文本直接透传
        const head = remaining.slice(0, startIdx);
        if (head) events.push(createStreamEvent.contentToken(head));
        // 启动门控，把起始标记以及后续部分暂存
        this.contentGateActive = true;
        this.gatedContentBuffer += remaining.slice(startIdx);
        remaining = '';
      } else {
        if (remaining) events.push(createStreamEvent.contentToken(remaining));
        remaining = '';
      }
    }
    
    // 更新主缓冲（供最终回退解析使用）
    this.contentBuffer += content;
    
    // 门控期间尝试解析完整工具调用
    events.push(...this.tryEmitToolCallFromGate());
    
    return events;
  }
  
  /**
   * 解析contentBuffer中已完成的工具调用
   * 
   * 关键：只解析**完整的**工具调用，避免误触发。
   * 完整标记：必须包含闭合标签 </use_mcp_tool>
   * 
   * 已解析的部分会被标记，避免重复触发。
   */
  private parsedToolCallIndices = new Set<string>();
  
  protected parseCompletedToolCallsInContent(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (!this.contentBuffer) return events;
    
    // 只使用McpToolCallParser（其他parser可能不适用content）
    for (const parser of this.contentParsers) {
      if (parser.getName() === 'McpToolCallParser' && parser.canParse(this.contentBuffer)) {
        const parsed = parser.parse(this.contentBuffer);
        
        // 去重：避免同一工具调用被重复解析
        for (const event of parsed) {
          if (event.type === 'tool_call') {
            // 使用toolCall内容的前100字符作为唯一标识
            const key = event.toolCall.substring(0, 100);
            if (!this.parsedToolCallIndices.has(key)) {
              this.parsedToolCallIndices.add(key);
              events.push(event);
            }
          }
        }
      }
    }
    
    return events;
  }

  protected tryEmitToolCallFromGate(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (!this.contentGateActive) return events;
    
    // 检查是否找到闭合标签
    const closeMatch = this.gatedContentBuffer.match(/<\/use_mcp_tool>|<\/tool_call>/i);
    
    if (closeMatch && closeMatch.index !== undefined) {
      // 找到闭合标签，解析工具调用
    const endIdx = closeMatch.index + closeMatch[0].length;
    const chunk = this.gatedContentBuffer.slice(0, endIdx);
    const tail = this.gatedContentBuffer.slice(endIdx);
    
    for (const parser of this.contentParsers) {
      if (parser.getName && parser.getName() === 'McpToolCallParser' && parser.canParse(chunk)) {
        const parsed = parser.parse(chunk);
        for (const ev of parsed) {
          if (ev.type === 'tool_call') {
            const key = ev.toolCall.substring(0, 100);
            if (!this.parsedToolCallIndices.has(key)) {
              this.parsedToolCallIndices.add(key);
              events.push(ev);
            }
          }
        }
      }
    }
    this.contentGateActive = false;
    this.gatedContentBuffer = '';
    if (tail && tail.length > 0) {
      events.push(createStreamEvent.contentToken(tail));
    }
    } else if (this.gatedContentBuffer.length > this.MAX_GATED_BUFFER_LENGTH) {
      // 缓冲区过大，可能不是工具调用，释放内容
      // 这避免了误匹配导致内容永久丢失
      events.push(createStreamEvent.contentToken(this.gatedContentBuffer));
      this.contentGateActive = false;
      this.gatedContentBuffer = '';
    }
    
    return events;
  }
  
  /**
   * 批量解析缓冲的thinking内容
   * 
   * 使用解析器管道处理特殊内容（MCP调用、代码块等）
   * 
   * 设计思路：
   * - thinking内容已经实时输出，用户已经看到
   * - 这里对缓冲区进行批量解析，提取特殊结构（如MCP调用）
   * - 生成额外的事件（如tool_call事件）
   */
  protected parseBufferedThinking(): StreamEvent[] {
    const events: StreamEvent[] = [];
    
    if (!this.thinkingBuffer) return events;
    
    // 依次应用每个解析器
    for (const parser of this.contentParsers) {
      if (parser.canParse(this.thinkingBuffer)) {
        const parsed = parser.parse(this.thinkingBuffer);
        events.push(...parsed);
      }
    }
    
    // 解析后清空，避免 finalize 或后续流程重复解析相同内容
    this.thinkingBuffer = '';
    return events;
  }

  /**
   * 解析缓冲的正文内容（contentBuffer）
   * 
   * 背景：部分模型遵循“在正文中输出 <use_mcp_tool> 标签”的指令，而非将其写入 thinking。
   * 之前仅解析 thinkingBuffer，导致这类输出无法触发 tool_call 事件，从而不渲染工具卡片。
   * 本方法复用同一解析器管道，对 contentBuffer 进行一次性解析（在 finalize 阶段调用），
   * 以捕获正文中的 <use_mcp_tool> 或兼容的工具调用格式。
   */
  protected parseBufferedContent(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (!this.contentBuffer) return events;
    for (const parser of this.contentParsers) {
      if (parser.canParse(this.contentBuffer)) {
        const parsed = parser.parse(this.contentBuffer);
        events.push(...parsed);
      }
    }
    // 解析后清空，避免重复解析
    this.contentBuffer = '';
    return events;
  }
  
  /**
   * 结束处理
   * 
   * 当done=true时调用，确保：
   * 1. thinking模式被正确结束
   * 2. 剩余缓冲内容被解析
   * 3. 发送stream_complete事件
   */
  protected finalize(): StreamEvent[] {
    const events: StreamEvent[] = [];
    
    // 如果thinking模式还在，需要结束
    if (this.isInThinkingMode) {
      events.push(createStreamEvent.thinkingEnd());
      this.isInThinkingMode = false;
      
      // 解析剩余缓冲内容
      events.push(...this.parseBufferedThinking());
    }
    
    // 结束门控（理论上应已闭合；若未闭合则按普通文本透传）
    if (this.contentGateActive) {
      if (this.gatedContentBuffer) {
        events.push(createStreamEvent.contentToken(this.gatedContentBuffer));
      }
      this.contentGateActive = false;
      this.gatedContentBuffer = '';
    }
    // 额外：解析正文缓冲，捕获正文中的 <use_mcp_tool> 等工具调用
    // 放在 thinking 解析之后，避免重复触发；UI 层有去重保护（同一流只执行一次）。
    events.push(...this.parseBufferedContent());
    
    // 发送complete事件
    events.push(createStreamEvent.streamComplete());
    
    return events;
  }
  
  /**
   * 重置策略状态
   */
  reset(): void {
    this.thinkingBuffer = '';
    this.contentBuffer = '';
    this.isInThinkingMode = false;
    this.hasStartedThinking = false;
  }
}

