/**
 * 工具指令抑制器（桥接模块）
 * 
 * ## 重构说明
 * 
 * 此模块现在是 `@/lib/mcp/toolInstruction/suppressor` 的桥接层，
 * 保持原有接口以确保向后兼容性。
 * 
 * 所有实现细节已移至统一的工具指令处理模块。
 */

// 从统一模块重新导出
export { 
  type SuppressionMode,
  type SuppressorOptions,
  type SuppressorUpdate,
  type ToolInstructionSuppressor,
  createToolInstructionSuppressor 
} from '@/lib/mcp/toolInstruction/suppressor';
