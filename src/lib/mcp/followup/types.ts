export type GuidancePhase = 'tool_result';

export type ToolResultKind =
  | 'connection_error'
  | 'tool_error'
  | 'empty'
  | 'success';

export interface GuidanceContext {
  phase: GuidancePhase;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  kind: ToolResultKind;
  /**
   * 额外上下文（可选）。用于更精细规则匹配，但避免把UI状态耦合进来。
   */
  meta?: Record<string, unknown>;
}

export interface GuidanceRule {
  id: string;
  priority: number;
  match: {
    server?: string;
    tool?: string;
    kind?: ToolResultKind;
    /**
     * 对 result 的字符串化做匹配（用于轻量识别某些模式）。
     * 注意：不要在这里做重解析，避免性能/稳定性问题。
     */
    resultIncludes?: string[];
  };
  /**
   * 返回给模型的“下一步指引”。要求：短、明确、可执行。
   */
  guidance: (ctx: GuidanceContext) => string;
}

