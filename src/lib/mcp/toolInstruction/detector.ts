/**
 * 工具指令检测器
 * 
 * ## 设计目标
 * 
 * 从文本中检测和提取工具调用指令信息。
 * 
 * ## 重构说明
 * 
 * 现在委托给 formats/pipeline 进行统一的格式处理，
 * 保持向后兼容的 API。
 * 
 * ## 功能
 * 
 * 1. **检测**: 判断文本是否包含工具调用指令
 * 2. **提取**: 从文本中解析出服务器、工具、参数等信息
 * 3. **分类**: 识别指令格式类型
 */

import { 
  type ToolInstructionFormat,
  mightContainToolInstruction
} from './patterns';
import { getDefaultPipeline, type ParsedToolCall, type ToolCallFormat } from './formats';

/**
 * 检测结果
 */
export interface DetectionResult {
  /** 是否检测到工具调用 */
  detected: boolean;
  /** 指令格式类型 */
  format?: ToolInstructionFormat;
  /** 服务器名称 */
  server?: string;
  /** 工具名称 */
  tool?: string;
  /** 工具参数 */
  args?: Record<string, unknown>;
  /** 原始匹配文本 */
  rawMatch?: string;
}

/**
 * 将新格式映射到旧格式（向后兼容）
 */
function mapFormat(format: ToolCallFormat): ToolInstructionFormat {
  const mapping: Record<ToolCallFormat, ToolInstructionFormat> = {
    'openai_function_call': 'json_tool_call',
    'openai_tool_calls': 'json_tool_call',
    'xml_use_mcp_tool': 'xml_use_mcp_tool',
    'xml_tool_call': 'xml_tool_call',
    'xml_function': 'xml_tool_call',
    'gpt_oss_channel': 'gpt_oss',
    'gpt_oss_commentary': 'gpt_oss',
    'gpt_oss_tags': 'gpt_oss_tags',
    'json_tool_call': 'json_tool_call',
    'commentary_simple': 'commentary',
    'function_like': 'function_like',
    'internal_marker': 'internal_marker',
    'unknown': 'json_tool_call',
  };
  return mapping[format] || 'json_tool_call';
}

/**
 * 将 ParsedToolCall 转换为 DetectionResult
 */
function toDetectionResult(parsed: ParsedToolCall): DetectionResult {
  return {
    detected: true,
    format: mapFormat(parsed.format),
    server: parsed.server,
    tool: parsed.tool,
    args: parsed.args,
    rawMatch: parsed.rawText,
  };
}

/**
 * 检测文本中是否包含工具调用指令
 * 
 * 使用统一的 Pipeline 架构进行检测和解析
 */
export function detectToolInstruction(text: string): DetectionResult {
  if (!text || !mightContainToolInstruction(text)) {
    return { detected: false };
  }
  
  try {
    const pipeline = getDefaultPipeline();
    const parsed = pipeline.parseFirst(text);
    
    if (parsed) {
      return toDetectionResult(parsed);
    }
  } catch (e) {
    console.warn('[detectToolInstruction] Pipeline 解析失败:', e);
  }
  
  return { detected: false };
}

