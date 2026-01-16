export type ToolCallStatus = 'running' | 'success' | 'error' | 'pending_auth';

export interface TextSegment { kind: 'text'; text: string }
export interface ThinkSegment { 
  kind: 'think'; 
  text: string;
  startTime?: number; // 开始时间戳（毫秒）
  duration?: number; // 思考时长（秒）
}
export interface ImageSegment { kind: 'image'; mimeType: string; data: string }
export interface ToolCardSegment {
  kind: 'toolCard';
  id: string;
  server: string;
  tool: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  resultPreview?: string;
  errorMessage?: string;
  schemaHint?: string;
  messageId: string;
}

export type MessageSegment = TextSegment | ThinkSegment | ImageSegment | ToolCardSegment;

export function ensureTextTail(segments: MessageSegment[], initialText: string): MessageSegment[] {
  const out = [...segments];
  if (out.length === 0 || out[out.length - 1].kind !== 'text') {
    out.push({ kind: 'text', text: initialText });
  }
  return out;
}

export function appendText(segments: MessageSegment[], chunk: string): MessageSegment[] {
  if (!chunk) return segments;
  
  const out = [...segments];
  
  // 获取或创建最后一个text segment
  let lastText = '';
  if (out.length === 0 || out[out.length - 1].kind !== 'text') {
    // 创建新的text segment
    out.push({ kind: 'text', text: '' });
  }
  
  // 累积文本：先追加新chunk到原始文本
  const lastSegment = out[out.length - 1] as TextSegment;
  lastText = (lastSegment.text || '') + chunk;
  
  // 🔑 关键修复：对整个累积的文本进行过滤
  // 这样可以确保未完成的工具调用指令片段被实时移除
  const filtered = filterToolCallContent(lastText);
  
  // 更新text segment的内容为过滤后的文本
  lastSegment.text = filtered;
  
  return out;
}

/**
 * 统一的内容过滤器（Segments层的核心职责）
 * 
 * ## 重构说明
 * 
 * 此函数现在委托给 `@/lib/mcp/toolInstruction` 模块，
 * 使用统一的模式定义进行过滤。
 * 
 * ## 职责
 * 
 * 过滤掉所有不应该在UI中显示的内容：
 * - 完整的工具调用指令块
 * - 未完成的工具调用指令片段（流式场景的关键）
 * - JSON格式的工具调用
 * - 内部工具卡片标记
 * 
 * @param text 要过滤的原始文本
 * @returns 过滤后的文本
 */
export function filterToolCallContent(text: string): string {
  if (!text) return '';
  
  // 使用统一的工具指令过滤模块
  // 延迟导入以避免循环依赖
  try {
    const { filterForDisplay } = require('@/lib/mcp/toolInstruction');
    return filterForDisplay(text);
  } catch {
    // 降级：使用简化的本地过滤逻辑
    return fallbackFilter(text);
  }
}

/**
 * 降级过滤函数（当模块加载失败时使用）
 */
function fallbackFilter(text: string): string {
  let out = text;
  
  // 移除内部标记
  out = out.replace(/\{[^}]*"__tool_call_card__"[^}]*\}/g, '');
  
  // 移除完整的 XML 指令块
  out = out.replace(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/gi, '');
  out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  
  // 移除 JSON 格式的工具调用
  out = out.replace(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi, '');
  
  // 移除未完成的指令片段
  out = out.replace(/<use_mcp_tool>[\s\S]*$/i, '');
  out = out.replace(/<tool_call>[\s\S]*$/i, '');
  
  return out;
}

export function appendThinkText(segments: MessageSegment[], chunk: string): MessageSegment[] {
  if (!chunk) return segments;
  const out = [...segments];
  if (out.length === 0 || out[out.length - 1].kind !== 'think') {
    // 创建新的think段，记录开始时间
    out.push({ kind: 'think', text: chunk, startTime: Date.now() });
  } else {
    // 追加到现有think段
    (out[out.length - 1] as ThinkSegment).text = ((out[out.length - 1] as ThinkSegment).text || '') + chunk;
  }
  return out;
}

/**
 * 完成最后一个think段，记录其持续时长
 */
export function finishLastThink(segments: MessageSegment[]): MessageSegment[] {
  if (segments.length === 0) return segments;
  const out = [...segments];
  const last = out[out.length - 1];
  if (last.kind === 'think' && last.startTime && !last.duration) {
    const durationMs = Date.now() - last.startTime;
    (out[out.length - 1] as ThinkSegment).duration = Math.round(durationMs / 100) / 10; // 保留1位小数的秒数
  }
  return out;
}

export function insertRunningCard(
  segments: MessageSegment[],
  card: Omit<ToolCardSegment, 'status'> & { status?: ToolCallStatus }
): MessageSegment[] {
  const out = [...segments];
  
  // 防止重复：检查是否已存在相同ID的卡片
  const existingCardIndex = out.findIndex(s => 
    s.kind === 'toolCard' && 
    s.id === card.id
  );
  
  if (existingCardIndex !== -1) {
    console.warn(`[insertRunningCard] 卡片 ${card.id} 已存在，跳过插入`);
    return out;
  }
  
  // 关键修复：必须带上 kind: 'toolCard'，否则上层统计与渲染将无法识别为卡片
  //@ts-expect-error  必须忽略ts的类型检查，否则会报错
  out.push({ kind: 'toolCard', ...card, status: 'running' } as ToolCardSegment);
  return out;
}

export function updateCardStatus(
  segments: MessageSegment[],
  match: { id?: string; server: string; tool: string },
  to: Partial<Pick<ToolCardSegment, 'status' | 'resultPreview' | 'errorMessage' | 'schemaHint'>>
): MessageSegment[] {
  return segments.map((s) => {
    if (s.kind !== 'toolCard') return s;
    const idOk = match.id ? s.id === match.id : true;
    // 允许更新 running 或 pending_auth 状态的卡片
    if (idOk && s.server === match.server && s.tool === match.tool && (s.status === 'running' || s.status === 'pending_auth')) {
      // 特殊处理：如果 errorMessage 是 'pending_auth'，状态应该是 'pending_auth' 而不是 'error'
      if (to.errorMessage === 'pending_auth') {
        return { ...s, status: 'pending_auth', errorMessage: to.errorMessage } as ToolCardSegment;
      }
      return { ...s, ...to } as ToolCardSegment;
    }
    return s;
  });
}

