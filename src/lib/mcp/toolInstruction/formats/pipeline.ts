/**
 * 工具调用处理管道
 * 
 * ## 设计模式
 * 
 * 使用责任链模式，将多个格式处理器串联起来。
 * 每个处理器按优先级顺序尝试处理文本，直到所有格式都被处理。
 * 
 * ## 处理流程
 * 
 * 1. 快速检测阶段：使用 mightContain 快速判断是否需要处理
 * 2. 解析阶段：提取所有工具调用信息
 * 3. 清理阶段：移除工具调用指令，保留正常内容
 */

import type { 
  FormatHandler, 
  ProcessResult, 
  ParsedToolCall, 
  CleanOptions 
} from './types';

/**
 * 处理管道类
 */
export class ToolCallPipeline {
  private handlers: FormatHandler[] = [];
  private sortedHandlers: FormatHandler[] | null = null;

  /**
   * 注册格式处理器
   */
  register(handler: FormatHandler): this {
    this.handlers.push(handler);
    this.sortedHandlers = null; // 清除缓存
    return this;
  }

  /**
   * 批量注册格式处理器
   */
  registerAll(handlers: FormatHandler[]): this {
    handlers.forEach(h => this.register(h));
    return this;
  }

  /**
   * 获取已排序的处理器列表
   */
  private getSortedHandlers(): FormatHandler[] {
    if (!this.sortedHandlers) {
      this.sortedHandlers = [...this.handlers].sort((a, b) => a.priority - b.priority);
    }
    return this.sortedHandlers;
  }

  /**
   * 快速检测文本是否可能包含任何工具调用格式
   */
  mightContainToolCall(text: string): boolean {
    if (!text) return false;
    return this.getSortedHandlers().some(h => h.mightContain(text));
  }

  /**
   * 解析文本中的所有工具调用
   * 
   * 返回按置信度排序的工具调用列表
   */
  parseAll(text: string): ParsedToolCall[] {
    if (!text) return [];
    
    const results: ParsedToolCall[] = [];
    
    for (const handler of this.getSortedHandlers()) {
      if (handler.mightContain(text)) {
        const calls = handler.parse(text);
        results.push(...calls);
      }
    }
    
    // 按置信度和位置排序
    return results.sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.startIndex - b.startIndex;
    });
  }

  /**
   * 解析并返回第一个（最高置信度且有效）工具调用
   * 
   * 过滤掉无效的解析结果（server/tool 为 unknown 或包含错误格式标记）
   */
  parseFirst(text: string): ParsedToolCall | null {
    const all = this.parseAll(text);
    
    // 过滤无效结果
    const valid = all.filter(call => {
      const isValidServer = call.server && 
        call.server !== 'unknown' && 
        !call.server.includes('use_mcp_tool') && 
        !call.server.includes('>');
      const isValidTool = call.tool && 
        call.tool !== 'unknown' && 
        call.tool !== 'default';
      
      return isValidServer && isValidTool;
    });
    
    return valid.length > 0 ? valid[0] : null;
  }

  /**
   * 清理文本中的所有工具调用指令
   * 
   * 使用所有处理器依次清理，确保覆盖所有格式
   */
  clean(text: string, options: CleanOptions = {}): ProcessResult {
    if (!text) {
      return { text: '', toolCalls: [], processed: false };
    }

    let currentText = text;
    const allToolCalls: ParsedToolCall[] = [];
    const allRemovedFragments: string[] = [];
    let anyProcessed = false;

    // 依次使用每个处理器清理
    for (const handler of this.getSortedHandlers()) {
      if (handler.mightContain(currentText)) {
        const result = handler.clean(currentText, options);
        
        if (result.processed) {
          currentText = result.text;
          allToolCalls.push(...result.toolCalls);
          if (result.removedFragments) {
            allRemovedFragments.push(...result.removedFragments);
          }
          anyProcessed = true;
        }
      }
    }

    return {
      text: currentText,
      toolCalls: allToolCalls,
      processed: anyProcessed,
      removedFragments: allRemovedFragments.length > 0 ? allRemovedFragments : undefined,
    };
  }

  /**
   * 清理不完整的片段（用于流式场景）
   */
  cleanIncomplete(text: string): string {
    if (!text) return '';
    
    let currentText = text;
    
    for (const handler of this.getSortedHandlers()) {
      if (handler.cleanIncomplete && handler.mightContain(currentText)) {
        currentText = handler.cleanIncomplete(currentText);
      }
    }
    
    return currentText;
  }

  /**
   * 获取所有已注册的处理器信息
   */
  getRegisteredFormats(): Array<{ id: string; description: string; priority: number }> {
    return this.getSortedHandlers().map(h => ({
      id: h.id,
      description: h.description,
      priority: h.priority,
    }));
  }
}

/**
 * 创建工具调用处理管道
 * 
 * 工厂函数，便于创建和配置管道实例
 */
export function createPipeline(): ToolCallPipeline {
  return new ToolCallPipeline();
}

/**
 * 默认管道实例（延迟初始化）
 */
let defaultPipeline: ToolCallPipeline | null = null;

/**
 * 获取默认管道实例
 * 
 * 自动注册所有内置处理器（同步注册）
 */
export function getDefaultPipeline(): ToolCallPipeline {
  if (!defaultPipeline) {
    defaultPipeline = createPipeline();
    registerBuiltinHandlers(defaultPipeline);
  }
  return defaultPipeline;
}

/**
 * 重置默认管道（用于测试）
 */
export function resetDefaultPipeline(): void {
  defaultPipeline = null;
}

/**
 * 注册所有内置处理器（同步）
 * 
 * 使用同步导入确保首次调用时处理器已注册
 * 
 * ## 处理器说明（按 priority 排序）
 * 
 * - OpenAIHandler (priority=1): 处理 OpenAI 原生 function_call/tool_calls 格式
 * - XMLHandler (priority=5): 处理 MCP 标准 XML 格式 (<use_mcp_tool>, <tool_call>)
 * - GptOssHandler (priority=6): **解析** GPT-OSS commentary to= 格式
 * - JsonHandler (priority=10): 处理 JSON 格式工具调用
 * - GptOssTagHandler (priority=15): **清理** GPT-OSS 模板标签（在解析之后）
 * 
 * ⚠️ 重要：GptOssHandler 必须在 GptOssTagHandler 之前运行！
 * 否则 commentary to= 格式会在被解析之前就被清理掉。
 */
function registerBuiltinHandlers(pipeline: ToolCallPipeline): void {
  // 同步导入所有处理器
  // 注：这里使用 require 进行同步导入，确保处理器在 getDefaultPipeline 返回前已注册
  try {
     
    const { OpenAIHandler } = require('./handlers/openai');
     
    const { XMLHandler } = require('./handlers/xml');
     
    const { GptOssHandler } = require('./handlers/gptoss');
     
    const { JsonHandler } = require('./handlers/json');
     
    const { GptOssTagHandler } = require('./handlers/gptoss-tags');
    
    pipeline.registerAll([
      new OpenAIHandler(),
      new XMLHandler(),
      new GptOssHandler(),    // 解析 commentary to= 格式
      new JsonHandler(),
      new GptOssTagHandler(), // 清理 GPT-OSS 标签（在解析之后）
    ]);
  } catch (e) {
    console.warn('[ToolCallPipeline] 处理器加载失败:', e);
  }
}

