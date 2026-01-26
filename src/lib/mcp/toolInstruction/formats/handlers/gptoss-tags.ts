/**
 * OpenAI Harmony 格式清理处理器
 * 
 * ## 关于 Harmony 格式
 * 
 * Harmony 是 OpenAI 为 GPT-OSS 模型设计的自定义消息格式。
 * 官方仓库：https://github.com/openai/harmony
 * 
 * 目前官方只提供 Rust 和 Python 版本，暂无官方 TypeScript 版本。
 * 第三方 WASM 封装：https://github.com/zacharytamas/harmony-ts （作者称为临时项目）
 * 
 * ## 设计决策
 * 
 * 由于：
 * 1. 官方暂无 JS/TS 版本
 * 2. 第三方 WASM 版本不够稳定
 * 3. 我们的需求主要是清理/过滤，而非完整解析
 * 
 * 因此采用正则匹配方式清理 Harmony 标签，等待官方 JS 版本发布后再考虑集成。
 * 
 * ## Harmony 格式示例
 * 
 * ```
 * <|start|>developer<|message|># Instructions
 * You are a helpful assistant.<|end|>
 * <|start|>user<|message|>Hello world<|end|>
 * ```
 * 
 * ## 清理的标签
 * 
 * ### Harmony 核心标签
 * - <|start|> - 消息开始
 * - <|message|> - 消息内容开始
 * - <|end|> - 消息结束
 * 
 * ### 扩展标签
 * - <|channel|>, <|thinking|>, <|constrain|>
 * - <|tool_call|>, <|tool_calls|>, <|function_call|>, <|function_calls|>
 * - <|assistant|>, <|user|>, <|system|>, <|developer|>
 * - <|call|>, <|final|>, <|response|>
 * 
 * ### Commentary 格式
 * - "commentary to=..." 指令及其变体
 * - 损坏的 commentary 输出
 */

import type { 
  FormatHandler, 
  ParsedToolCall, 
  ProcessResult, 
  CleanOptions,
  ToolCallFormat 
} from '../types';

export class GptOssTagHandler implements FormatHandler {
  readonly id: ToolCallFormat = 'gpt_oss_tags';
  readonly description = 'OpenAI Harmony (GPT-OSS) 格式清理器';
  readonly priority = 15; // 低优先级，在其他处理器之后执行

  // ============================================================
  // Harmony 格式标签定义
  // 基于 https://github.com/openai/harmony 规范
  // ============================================================
  
  // 核心 Harmony 标签
  private static readonly HARMONY_CORE_TAGS = [
    'start',      // 消息开始
    'message',    // 消息内容开始
    'end',        // 消息结束
  ] as const;

  // 角色标签
  private static readonly HARMONY_ROLE_TAGS = [
    'developer',  // 开发者/系统提示
    'user',       // 用户消息
    'assistant',  // 助手回复
    'system',     // 系统消息
  ] as const;

  // 功能标签
  private static readonly HARMONY_FEATURE_TAGS = [
    'channel',
    'thinking',
    'constrain',
    'tool_call',
    'tool_calls', 
    'function_call',
    'function_calls',
    'call',
    'final',
    'response',
    'analysis',     // 分析内容
    'instructions', // 指令
  ] as const;

  // 所有标签合集
  private static readonly ALL_TAGS = [
    ...GptOssTagHandler.HARMONY_CORE_TAGS,
    ...GptOssTagHandler.HARMONY_ROLE_TAGS,
    ...GptOssTagHandler.HARMONY_FEATURE_TAGS,
  ] as const;

  // ============================================================
  // 正则表达式模式
  // ============================================================

  // 匹配 <|tag|> 格式的标签
  private readonly tagPattern: RegExp;
  
  // 匹配 <|start|>role<|message|> 格式（角色声明）
  private readonly roleDeclarationPattern = /<\|start\|>\s*(developer|user|assistant|system)\s*<\|message\|>/gi;
  
  // ============================================================
  // Commentary 格式清理（GPT-OSS 特有）
  // ============================================================
  
  // 1. 完整的 commentary to=xxx json{...} 格式
  private readonly commentaryJsonPattern = /commentary\s+to=[^\s]+\s*json\s*\{[^}]*\}/gi;
  
  // 2. commentary to=xxx><arguments>...</arguments> 混合格式（GPT-OSS 常见错误输出）
  private readonly commentaryXmlMixedPattern = /commentary\s+to=[^\s>]+>?<arguments>[^<]*<\/arguments>(?:<\/\w+>)*/gi;
  
  // 3. commentary to=xxx 后跟任意内容直到行尾或 </
  private readonly commentaryToEndPattern = /commentary\s+to=[^\s<>\n]+[^<\n]*/gi;
  
  // 4. 独立的 "commentary" 关键字
  private readonly standaloneCommentary = /\bcommentary\b/gi;
  
  // 5. 残留的 to=xxx.xxx 格式（commentary 被部分清理后的残留）
  private readonly toEqualsPattern = /\bto=[a-zA-Z0-9_.]+(?:>[^<]*)?/gi;
  
  // ============================================================
  // XML 工具调用标签清理
  // ============================================================
  
  // 完整的 <use_mcp_tool>...</use_mcp_tool> 块
  private readonly useMcpToolBlockPattern = /<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/gi;
  
  // 单独的 XML 标签
  private readonly xmlToolTagsPattern = /<\/?(?:use_mcp_tool|server_name|tool_name|arguments|tool_call|function_call)>/gi;
  
  // XML 标签内容残片（如 tool_name>, ol_name>, </arguments> 等）
  private readonly xmlTagFragmentsPattern = /(?:\b\w*_name|\bserver|\btool|\barguments)>\s*(?:\{[^}]*\})?/gi;

  // 破损的 tool_name 片段（缺少 > 或被截断）
  private readonly brokenToolNamePattern = /<\/?\s*tool_name\b[^>\s]*>?/gi;

  // 悬空的闭合标签片段（如单独的 "</"）
  private readonly danglingCloseTagPattern = /<\/\s*$/gm;

  // 残留的工具执行短语（如 "web_search.run code" 被截断后残留）
  private readonly toolRunCodePattern = /\b(?:[a-z]_|[a-z]+_)?search\.run\s+codes?\b/gi;
  
  // ============================================================
  // GPT-OSS <json> 标签清理
  // ============================================================
  
  // 完整的 <json>...</json> 块（包含内容）
  private readonly jsonTagBlockPattern = /<json>\s*\{[^}]*\}\s*><\/json>/gi;
  
  // 单独的 <json> 和 </json> 标签
  private readonly jsonTagPattern = /<\/?json>/gi;
  
  // </assistant 或 </assistant> 残留标签
  private readonly assistantClosingPattern = /<\/assistant[^>]*>?/gi;
  
  // ============================================================
  // 其他清理模式
  // ============================================================
  
  // 匹配损坏的 commentary 格式
  private readonly corruptedCommentary = /commentary\w*["':}\]>]+[^<]*(?:<\/commentary>)?/gi;
  
  // 匹配 </commentary> 标签
  private readonly closingCommentary = /<\/commentary>/gi;
  
  // 匹配 JSON 残片（如 killld":"docx"}）
  private readonly jsonRemnants = /\b\w*["']\s*:\s*["'][^"']*["']\s*\}+(?:>\s*<\/commentary>)?/gi;

  // 匹配 Harmony 格式的完整消息块
  // <|start|>role<|message|>content<|end|>
  private readonly fullMessageBlockPattern = /<\|start\|>\s*(?:developer|user|assistant|system)\s*<\|message\|>[\s\S]*?<\|end\|>/gi;

  // 匹配行首的 # Instructions 或类似的 Harmony 指令标记
  private readonly instructionHeaderPattern = /^#\s*Instructions\s*$/gm;

  constructor() {
    // 动态构建标签匹配模式
    const tagAlternation = GptOssTagHandler.ALL_TAGS.join('|');
    this.tagPattern = new RegExp(`<\\|(?:${tagAlternation})\\|>`, 'gi');
  }

  mightContain(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    
    return (
      // Harmony 标签特征: <|
      text.includes('<|') ||
      // Commentary 指令（包括损坏的格式）
      lower.includes('commentary') ||
      // to= 残留
      lower.includes('to=') ||
      // </commentary> 闭合标签
      lower.includes('</commentary>') ||
      // XML 工具标签
      lower.includes('<use_mcp_tool') ||
      lower.includes('</use_mcp_tool>') ||
      lower.includes('<arguments>') ||
      lower.includes('</arguments>') ||
      lower.includes('_name>') ||
      // GPT-OSS <json> 标签
      lower.includes('<json>') ||
      lower.includes('</json>') ||
      // </assistant 残留
      lower.includes('</assistant') ||
      // Harmony 指令头
      lower.includes('# instructions')
    );
  }

  /**
   * 不进行工具调用解析
   * 
   * GPT-OSS 格式的工具调用解析已被移除，因为：
   * 1. 格式复杂，容易产生误匹配
   * 2. XMLHandler 已经可以处理 <use_mcp_tool> 格式
   * 3. 减少解析层次，提高稳定性
   */
  parse(_text: string): ParsedToolCall[] {
    // 不解析工具调用，只负责清理
    return [];
  }

  clean(text: string, _options?: CleanOptions): ProcessResult {
    if (!this.mightContain(text)) {
      return { text, toolCalls: [], processed: false };
    }

    let cleaned = text;
    const removedFragments: string[] = [];

    // ============================================================
    // 0. 保护 Markdown fenced code blocks（避免误伤示例代码）
    // ============================================================
    // 运行证据：模型在正常回答中会输出 ```xml ... <use_mcp_tool> ... ``` 示例，
    // 若我们在这里移除 XML 标签，会导致代码块“被掏空/乱码”（误伤）。
    const fencedBlocks: string[] = [];
    cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
      const idx = fencedBlocks.length;
      fencedBlocks.push(match);
      return `__CHATLESS_FENCED_BLOCK_${idx}__`;
    });

    // 0.2 保护 Markdown inline code（支持 1 个或多个反引号：`...` / ``...`` / ```...```），避免误伤行内示例
    // 运行证据：模型可能用双反引号包裹 `<use_mcp_tool>`（例如：``<use_mcp_tool>``），
    // 若我们移除其中的标签，会导致 ```` 断裂。
    const inlineCodes: string[] = [];
    cleaned = cleaned.replace(/(`+)([^`\n]*?)\1/g, (match) => {
      const idx = inlineCodes.length;
      inlineCodes.push(match);
      return `__CHATLESS_INLINE_CODE_${idx}__`;
    });


    // ============================================================
    // 阶段 1: 移除 Harmony 格式的完整结构
    // ============================================================

    // 1.1 移除完整的消息块 <|start|>role<|message|>...<|end|>
    // 注意：这会移除整个块，通常用于清理系统/开发者指令
    // 但我们只清理标签，保留内容
    cleaned = cleaned.replace(this.roleDeclarationPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // ============================================================
    // 阶段 2: 移除 XML 工具调用标签（优先处理）
    // ============================================================

    // 2.1 移除完整的 <use_mcp_tool>...</use_mcp_tool> 块
    cleaned = cleaned.replace(this.useMcpToolBlockPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 2.2 移除单独的 XML 工具标签
    cleaned = cleaned.replace(this.xmlToolTagsPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 2.3 移除 XML 标签片段（如 _name>, </arguments> 等）
    cleaned = cleaned.replace(this.xmlTagFragmentsPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // ============================================================
    // 阶段 3: 移除 Commentary 相关内容
    // ============================================================

    // 3.1 移除 commentary to=xxx json{...} 格式
    cleaned = cleaned.replace(this.commentaryJsonPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.2 移除 commentary to=xxx><arguments>... 混合格式
    cleaned = cleaned.replace(this.commentaryXmlMixedPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.3 移除 commentary to=xxx... 一般格式
    cleaned = cleaned.replace(this.commentaryToEndPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.4 移除损坏的 commentary 格式
    cleaned = cleaned.replace(this.corruptedCommentary, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.5 移除 </commentary> 闭合标签
    cleaned = cleaned.replace(this.closingCommentary, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.6 移除残留的 to=xxx 格式
    cleaned = cleaned.replace(this.toEqualsPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.7 移除独立的 "commentary" 关键字
    cleaned = cleaned.replace(this.standaloneCommentary, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.8 移除 JSON 残片
    cleaned = cleaned.replace(this.jsonRemnants, (match) => {
      removedFragments.push(match);
      return '';
    });

    // ============================================================
    // 阶段 3.9: 移除 GPT-OSS <json> 标签
    // ============================================================

    // 3.9.1 移除完整的 <json>...</json> 块
    cleaned = cleaned.replace(this.jsonTagBlockPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.9.2 移除单独的 <json> 和 </json> 标签
    cleaned = cleaned.replace(this.jsonTagPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.9.3 移除 </assistant 残留
    cleaned = cleaned.replace(this.assistantClosingPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.9.4 移除破损的 tool_name 标签片段
    cleaned = cleaned.replace(this.brokenToolNamePattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.9.5 移除悬空闭合标签片段（行尾 "</"）
    cleaned = cleaned.replace(this.danglingCloseTagPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 3.9.6 移除残留的工具执行短语
    cleaned = cleaned.replace(this.toolRunCodePattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // ============================================================
    // 阶段 4: 移除独立的 Harmony 标签
    // ============================================================

    // 4.1 移除所有 <|tag|> 格式的标签
    cleaned = cleaned.replace(this.tagPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // 4.2 移除 Harmony 指令头（如 # Instructions）
    cleaned = cleaned.replace(this.instructionHeaderPattern, (match) => {
      removedFragments.push(match);
      return '';
    });

    // ============================================================
    // 阶段 5: 清理残留
    // ============================================================

    // 5.1 清理尾部的 commentary 遗留
    cleaned = cleaned.replace(/\s+commentary\s*$/, '');
    cleaned = cleaned.replace(/^commentary\s+/, '');
    
    // 5.2 移除残留的 </assistant 等不完整标签
    cleaned = cleaned.replace(/<\/(?:assistant|user|system|developer)>/gi, '');

    // 4.2 清理多余的空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // 4.3 清理行首行尾的空白
    cleaned = cleaned.trim();

    // ============================================================
    // 6. 恢复 fenced code blocks
    // ============================================================
    if (fencedBlocks.length > 0) {
      cleaned = cleaned.replace(/__CHATLESS_FENCED_BLOCK_(\d+)__/g, (_m, n) => {
        const idx = Number(n);
        return Number.isFinite(idx) && fencedBlocks[idx] ? fencedBlocks[idx] : '';
      });
    }

    // 6.2 恢复 inline code
    if (inlineCodes.length > 0) {
      cleaned = cleaned.replace(/__CHATLESS_INLINE_CODE_(\d+)__/g, (_m, n) => {
        const idx = Number(n);
        return Number.isFinite(idx) && inlineCodes[idx] ? inlineCodes[idx] : '';
      });
    }


    return {
      text: cleaned,
      toolCalls: [],
      processed: removedFragments.length > 0,
      removedFragments,
    };
  }

  cleanIncomplete(text: string): string {
    let result = text;

    // 保护 fenced code blocks（允许未闭合，避免流式时误伤）
    const fencedBlocks: string[] = [];
    result = result.replace(/```[\s\S]*?(?:```|$)/g, (match) => {
      const idx = fencedBlocks.length;
      fencedBlocks.push(match);
      return `__CHATLESS_FENCED_BLOCK_${idx}__`;
    });

    // 保护 inline code（支持 1+ 反引号，允许未闭合）
    const inlineCodes: string[] = [];
    result = result.replace(/(`+)([^`\n]*?)(\1|$)/g, (match) => {
      const idx = inlineCodes.length;
      inlineCodes.push(match);
      return `__CHATLESS_INLINE_CODE_${idx}__`;
    });

    // ============================================================
    // 1. 移除不完整的 Commentary 指令
    // ============================================================
    // 移除 commentary to=xxx... 到行尾
    result = result.replace(/commentary\s+to=[^\n]*$/gi, '');
    // 移除孤立的 commentary
    result = result.replace(/\bcommentary\s*$/gi, '');

    // ============================================================
    // 2. 移除不完整的 Harmony 标签
    // ============================================================
    
    // 2.1 检查并移除不完整的 <|tag|> 标签
    for (const tag of GptOssTagHandler.ALL_TAGS) {
      const fullTag = `<|${tag}|>`;
      for (let len = fullTag.length - 1; len >= 2; len--) {
        const partial = fullTag.substring(0, len);
        if (result.endsWith(partial)) {
          result = result.slice(0, -partial.length);
          break;
        }
      }
    }

    // 2.2 移除孤立的 <|
    if (result.endsWith('<|')) {
      result = result.slice(0, -2);
    } else if (result.endsWith('<')) {
      // 检查是否是 Harmony 标签的开始，而非 HTML
      const lastLt = result.lastIndexOf('<');
      if (lastLt === result.length - 1) {
        const before = result.slice(Math.max(0, lastLt - 10), lastLt);
        // 如果前面没有其他 < 且不像 HTML，则移除
        if (!before.includes('<') || before.includes('<|')) {
          result = result.slice(0, -1);
        }
      }
    }

    // 2.3 移除不完整的角色声明（如 <|start|>user 但没有 <|message|>）
    const incompleteRoleDecl = /<\|start\|>\s*(developer|user|assistant|system)\s*$/i;
    result = result.replace(incompleteRoleDecl, '');

    // ============================================================
    // 3. 清理 Commentary 残留
    // ============================================================
    
    // 3.1 移除尾部的 commentary 关键字
    result = result.replace(/\s+commentary\s*$/, '');
    
    // 3.2 移除不完整的 commentary to= 
    result = result.replace(/commentary\s+to=\s*$/, '');
    result = result.replace(/commentary\s+$/, '');

    // ============================================================
    // 4. 清理 </commentary> 相关残留
    // ============================================================
    
    // 4.1 移除不完整的 </commentary>
    const incompleteClosingCommentary = /<\/commentary$/i;
    result = result.replace(incompleteClosingCommentary, '');
    
    // 4.2 移除不完整的 </comment
    if (result.endsWith('</comment') || result.endsWith('</commen') || 
        result.endsWith('</comme') || result.endsWith('</comm') ||
        result.endsWith('</com') || result.endsWith('</co') ||
        result.endsWith('</c') || result.endsWith('</')) {
      result = result.slice(0, result.lastIndexOf('<'));
    }

    // 恢复 fenced code blocks
    if (fencedBlocks.length > 0) {
      result = result.replace(/__CHATLESS_FENCED_BLOCK_(\d+)__/g, (_m, n) => {
        const idx = Number(n);
        return Number.isFinite(idx) && fencedBlocks[idx] ? fencedBlocks[idx] : '';
      });
    }

    // 恢复 inline code
    if (inlineCodes.length > 0) {
      result = result.replace(/__CHATLESS_INLINE_CODE_(\d+)__/g, (_m, n) => {
        const idx = Number(n);
        return Number.isFinite(idx) && inlineCodes[idx] ? inlineCodes[idx] : '';
      });
    }

    return result;
  }

  /**
   * 提取 Harmony 消息中的实际内容
   * 
   * 从 <|start|>role<|message|>content<|end|> 格式中提取 content
   * 
   * @param text Harmony 格式的文本
   * @returns 提取的内容数组
   */
  extractHarmonyContent(text: string): Array<{ role: string; content: string }> {
    const results: Array<{ role: string; content: string }> = [];
    
    const messagePattern = /<\|start\|>\s*(developer|user|assistant|system)\s*<\|message\|>([\s\S]*?)<\|end\|>/gi;
    let match;
    
    while ((match = messagePattern.exec(text)) !== null) {
      results.push({
        role: match[1].toLowerCase(),
        content: match[2].trim(),
      });
    }
    
    return results;
  }
}
