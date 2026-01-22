/**
 * 统一的工具调用检测器
 * 
 * ## 设计目标
 * 
 * 提供单一、统一的工具调用检测逻辑，消除分散在多个文件中的重复代码：
 * - segments.ts: needsToolCallFilter()
 * - filter.ts: mightContainToolInstruction()
 * - ToolChannelParser.ts: 内联快速检测
 * - patterns.ts: 模式定义
 * 
 * ## 职责
 * 
 * 1. **快速检测**：判断文本是否可能包含工具调用（O(1) 字符串检测）
 * 2. **边界检测**：流式场景下检测跨 chunk 的工具调用开始
 * 3. **精确匹配**：使用正则精确匹配工具调用格式
 * 
 * ## 支持的格式
 * 
 * 1. XML 格式：<use_mcp_tool>...</use_mcp_tool>, <tool_call>...</tool_call>
 * 2. JSON 格式：{ "type": "tool_call", ... }
 * 3. GPT-OSS 格式：<|channel|>commentary to=... {json}
 * 4. Commentary 格式：commentary to=... json {...}
 * 
 * ## 使用方式
 * 
 * ```typescript
 * import { ToolCallDetector } from '@/lib/mcp/ToolCallDetector';
 * 
 * const detector = ToolCallDetector.getInstance();
 * 
 * // 快速检测
 * if (detector.mightContainToolCall(text)) {
 *   // 进入详细处理流程
 * }
 * 
 * // 流式边界检测
 * if (detector.detectAtBoundary(existingText, newChunk)) {
 *   // 触发过滤
 * }
 * ```
 */

/**
 * 检测结果类型
 */
export interface DetectionResult {
  /** 是否检测到工具调用特征 */
  detected: boolean;
  /** 检测到的格式类型 */
  format?: 'xml' | 'json' | 'gpt_oss' | 'commentary' | 'internal_marker';
  /** 置信度 (0-1) */
  confidence: number;
  /** 匹配的起始位置 */
  startIndex?: number;
}

/**
 * 工具调用检测器（单例）
 */
export class ToolCallDetector {
  private static instance: ToolCallDetector | null = null;
  
  // ========== 快速检测关键词 ==========
  // 这些是 O(1) 复杂度的字符串包含检测
  
  /** XML 格式关键词（小写） */
  private static readonly XML_KEYWORDS = [
    '<use_mcp_tool',
    '</use_mcp_tool',
    '<tool_call',
    '</tool_call',
  ] as const;
  
  /** GPT-OSS 格式关键词 */
  private static readonly GPT_OSS_KEYWORDS = [
    '<|',  // GPT-OSS 模板标签前缀
    'commentary to=',
  ] as const;
  
  /** 内部标记 */
  private static readonly INTERNAL_MARKER = '__tool_call_card__';
  
  // ========== 正则模式 ==========
  
  /** JSON 工具调用检测（严格模式） */
  private static readonly JSON_TOOL_CALL_PATTERN = /"type"\s*:\s*"tool_call"/i;
  
  /** GPT-OSS 模板标签模式 */
  private static readonly GPT_OSS_TAG_PATTERN = 
    /<\|(?:channel|message|end|thinking|constrain|tool_calls?|function_calls?|assistant|user|system)\|>/i;
  
  /** XML 开始标签 */
  private static readonly XML_START_PATTERNS = [
    /<use_mcp_tool>/i,
    /<tool_call>/i,
  ];
  
  /** 不完整 XML 标签前缀 */
  private static readonly INCOMPLETE_XML_PREFIXES = [
    '<use_mcp_tool',
    '<tool_call',
    '</use_mcp_tool',
    '</tool_call',
    '<|channel|',
    '<|message|',
    '<|end|',
    '<|thinking|',
    '<|constrain|',
    '<|tool_call',
    '<|function_call',
  ];
  
  private constructor() {
    // 私有构造函数，强制使用单例
  }
  
  /**
   * 获取单例实例
   */
  static getInstance(): ToolCallDetector {
    if (!ToolCallDetector.instance) {
      ToolCallDetector.instance = new ToolCallDetector();
    }
    return ToolCallDetector.instance;
  }
  
  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    ToolCallDetector.instance = null;
  }
  
  /**
   * 快速检测文本是否可能包含工具调用
   * 
   * 使用字符串包含检测（O(n) 但常数因子极小），
   * 避免正则表达式的编译和匹配开销。
   * 
   * @param text 要检测的文本
   * @returns 是否可能包含工具调用
   */
  mightContainToolCall(text: string): boolean {
    if (!text || text.length === 0) return false;
    
    const lowerText = text.toLowerCase();
    
    // 1. 检测 XML 格式关键词
    for (const keyword of ToolCallDetector.XML_KEYWORDS) {
      if (lowerText.includes(keyword)) return true;
    }
    
    // 2. 检测 GPT-OSS 格式关键词
    for (const keyword of ToolCallDetector.GPT_OSS_KEYWORDS) {
      if (text.includes(keyword)) return true;
    }
    
    // 3. 检测内部标记
    if (text.includes(ToolCallDetector.INTERNAL_MARKER)) return true;
    
    // 4. 检测 JSON 格式（需要正则，但模式简单）
    if (ToolCallDetector.JSON_TOOL_CALL_PATTERN.test(text)) return true;
    
    // 5. 检测反向格式 json{...}commentary
    if (lowerText.includes('json') && lowerText.includes('commentary')) return true;
    
    return false;
  }
  
  /**
   * 流式边界检测
   * 
   * 检测工具调用是否可能跨越 chunk 边界开始。
   * 用于流式输出场景，决定是否需要启动过滤。
   * 
   * @param existingText 已累积的文本
   * @param newChunk 新到达的 chunk
   * @returns 是否检测到工具调用特征
   */
  detectAtBoundary(existingText: string, newChunk: string): boolean {
    if (!newChunk) return false;
    
    // 1. 先检测新 chunk 本身
    if (this.mightContainToolCall(newChunk)) {
      return true;
    }
    
    // 2. 检测边界：尾部 + 新 chunk 的组合
    if (existingText && existingText.length > 0) {
      // 取最后 50 个字符作为边界
      const tailLength = Math.min(50, existingText.length);
      const boundary = existingText.slice(-tailLength) + newChunk;
      
      if (this.mightContainToolCall(boundary)) {
        return true;
      }
      
      // 3. 检测不完整的标签前缀（可能被 chunk 分割）
      const combinedTail = existingText.slice(-20) + newChunk.slice(0, 20);
      if (this.hasIncompleteTagPrefix(combinedTail)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 精确检测并返回详细结果
   * 
   * 使用正则表达式进行精确匹配，返回检测到的格式类型和置信度。
   * 
   * @param text 要检测的文本
   * @returns 检测结果
   */
  detectWithDetails(text: string): DetectionResult {
    if (!text || text.length === 0) {
      return { detected: false, confidence: 0 };
    }
    
    const lowerText = text.toLowerCase();
    
    // 1. XML 格式（最高置信度）
    for (const pattern of ToolCallDetector.XML_START_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        return {
          detected: true,
          format: 'xml',
          confidence: 1.0,
          startIndex: match.index,
        };
      }
    }
    
    // 2. 内部标记
    const internalIndex = text.indexOf(ToolCallDetector.INTERNAL_MARKER);
    if (internalIndex !== -1) {
      return {
        detected: true,
        format: 'internal_marker',
        confidence: 1.0,
        startIndex: internalIndex,
      };
    }
    
    // 3. GPT-OSS 模板标签
    const gptOssMatch = ToolCallDetector.GPT_OSS_TAG_PATTERN.exec(text);
    if (gptOssMatch) {
      return {
        detected: true,
        format: 'gpt_oss',
        confidence: 0.9,
        startIndex: gptOssMatch.index,
      };
    }
    
    // 4. Commentary 格式
    const commentaryIndex = lowerText.indexOf('commentary to=');
    if (commentaryIndex !== -1) {
      return {
        detected: true,
        format: 'commentary',
        confidence: 0.8,
        startIndex: commentaryIndex,
      };
    }
    
    // 5. JSON 格式
    const jsonMatch = ToolCallDetector.JSON_TOOL_CALL_PATTERN.exec(text);
    if (jsonMatch) {
      return {
        detected: true,
        format: 'json',
        confidence: 0.7,
        startIndex: jsonMatch.index,
      };
    }
    
    return { detected: false, confidence: 0 };
  }
  
  /**
   * 检测是否包含不完整的标签前缀
   * 
   * 用于流式场景，判断文本尾部是否有被截断的标签。
   * 
   * @param text 要检测的文本
   * @returns 是否包含不完整前缀
   */
  hasIncompleteTagPrefix(text: string): boolean {
    if (!text) return false;
    
    for (const prefix of ToolCallDetector.INCOMPLETE_XML_PREFIXES) {
      // 检测完整前缀
      if (text.includes(prefix)) return true;
      
      // 检测部分前缀（至少 3 个字符）
      for (let len = prefix.length; len >= 3; len--) {
        const partial = prefix.substring(0, len);
        if (text.endsWith(partial)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * 获取所有支持的格式类型
   */
  getSupportedFormats(): string[] {
    return ['xml', 'json', 'gpt_oss', 'commentary', 'internal_marker'];
  }
  
  /**
   * 检测文本是否包含 GPT-OSS 模板标签
   * 
   * 这些标签（如 <|channel|>）需要被剥离，但不一定表示工具调用
   */
  hasGptOssTags(text: string): boolean {
    if (!text) return false;
    return text.includes('<|') && ToolCallDetector.GPT_OSS_TAG_PATTERN.test(text);
  }
  
  /**
   * 检测文本是否包含 XML 工具调用指令
   */
  hasXmlToolCall(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return lower.includes('<use_mcp_tool') || lower.includes('<tool_call');
  }
  
  /**
   * 检测文本是否包含 JSON 工具调用
   */
  hasJsonToolCall(text: string): boolean {
    if (!text) return false;
    return ToolCallDetector.JSON_TOOL_CALL_PATTERN.test(text);
  }
  
  /**
   * 检测文本是否包含 commentary 格式工具调用
   */
  hasCommentaryToolCall(text: string): boolean {
    if (!text) return false;
    return text.toLowerCase().includes('commentary to=');
  }
}

/**
 * 便捷函数：快速检测
 */
export function mightContainToolCall(text: string): boolean {
  return ToolCallDetector.getInstance().mightContainToolCall(text);
}

/**
 * 便捷函数：边界检测
 */
export function detectToolCallAtBoundary(existingText: string, newChunk: string): boolean {
  return ToolCallDetector.getInstance().detectAtBoundary(existingText, newChunk);
}

/**
 * 便捷函数：详细检测
 */
export function detectToolCallWithDetails(text: string): DetectionResult {
  return ToolCallDetector.getInstance().detectWithDetails(text);
}

