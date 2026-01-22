/**
 * 工具指令处理模块
 * 
 * ## 模块职责
 * 
 * 集中处理所有与工具调用指令相关的功能：
 * 
 * - **patterns**: 统一的模式定义
 * - **filter**: 过滤/清理工具指令
 * - **detector**: 检测/解析工具指令
 * - **suppressor**: 流式抑制器
 * - **marker**: 工具卡片标记
 * 
 * ## 设计原则
 * 
 * 1. **单一数据源**: 所有正则模式在 patterns.ts 中定义
 * 2. **关注点分离**: 过滤、检测、抑制各司其职
 * 3. **向后兼容**: 保持与原有接口的兼容性
 * 
 * ## 使用示例
 * 
 * ```typescript
 * import { 
 *   filterForDisplay, 
 *   detectToolInstruction,
 *   createToolInstructionSuppressor 
 * } from '@/lib/mcp/toolInstruction';
 * 
 * // 过滤显示内容
 * const cleanText = filterForDisplay(rawText);
 * 
 * // 检测工具调用
 * const result = detectToolInstruction(text);
 * if (result.detected) {
 *   console.log(`检测到工具调用: ${result.server}.${result.tool}`);
 * }
 * 
 * // 流式抑制
 * const suppressor = createToolInstructionSuppressor();
 * const update = suppressor.push(chunk);
 * ```
 */

// 模式定义
export { 
  type ToolInstructionFormat,
  type PatternDefinition,
  type SuppressionMode,
  type SuppressionTrigger,
  TOOL_INSTRUCTION_PATTERNS,
  INCOMPLETE_TAG_PREFIXES,
  MIN_INCOMPLETE_PREFIX_LENGTH,
  getSuppressionTriggers,
  mightContainToolInstruction
} from './patterns';

// 过滤器
export {
  type FilterMode,
  type FilterOptions,
  filterToolInstructions,
  filterForDisplay,
  filterForPersist
} from './filter';

// 检测器
export {
  type DetectionResult,
  detectToolInstruction
} from './detector';

// 抑制器
export {
  type SuppressorOptions,
  type SuppressorUpdate,
  type ToolInstructionSuppressor,
  createToolInstructionSuppressor
} from './suppressor';

// 标记工具
export {
  type ToolCardMarker,
  createToolCardMarker,
  hasToolCardMarker,
  extractToolCardMarker
} from './marker';

// 格式处理模块（新架构）
export {
  // 类型
  type ParsedToolCall,
  type ProcessResult,
  type FormatHandler,
  type CleanOptions,
  type ToolCallFormat,
  type FormatMetadata,
  FORMAT_REGISTRY,
  // 管道
  ToolCallPipeline,
  createPipeline,
  getDefaultPipeline,
  resetDefaultPipeline,
  // 处理器
  OpenAIHandler,
  XMLHandler,
  JsonHandler,
  GptOssTagHandler,
  // 已弃用，保留向后兼容
  GptOssHandler,
  SimpleHandler,
} from './formats';

