/**
 * 工具调用格式处理模块
 * 
 * ## 架构设计
 * 
 * 使用责任链模式处理多种工具调用格式：
 * 
 * 1. **格式处理器 (FormatHandler)**: 每种格式一个处理器
 *    - OpenAIHandler: OpenAI function_call 和 tool_calls
 *    - XMLHandler: MCP XML 格式
 *    - JsonHandler: JSON 格式工具调用
 *    - GptOssTagHandler: GPT-OSS 模板标签清理
 * 
 * 2. **处理管道 (ToolCallPipeline)**: 串联所有处理器
 *    - 按优先级顺序执行
 *    - 支持检测、解析、清理
 * 
 * ## 使用方法
 * 
 * ```typescript
 * import { getDefaultPipeline } from '@/lib/mcp/toolInstruction/formats';
 * 
 * const pipeline = getDefaultPipeline();
 * 
 * // 检测
 * if (pipeline.mightContainToolCall(text)) {
 *   // 解析
 *   const toolCalls = pipeline.parseAll(text);
 *   
 *   // 清理
 *   const { text: cleaned, toolCalls } = pipeline.clean(text);
 * }
 * ```
 */

// 类型导出
export type {
  ParsedToolCall,
  ProcessResult,
  FormatHandler,
  CleanOptions,
  ToolCallFormat,
  FormatMetadata,
} from './types';

export { FORMAT_REGISTRY } from './types';

// 管道导出
export {
  ToolCallPipeline,
  createPipeline,
  getDefaultPipeline,
  resetDefaultPipeline,
} from './pipeline';

// 处理器导出
export {
  OpenAIHandler,
  XMLHandler,
  JsonHandler,
  GptOssTagHandler,
  // 已弃用，保留向后兼容
  GptOssHandler,
  SimpleHandler,
} from './handlers';

