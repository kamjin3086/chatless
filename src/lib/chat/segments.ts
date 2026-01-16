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

/**
 * 工具指令特征检测（仅检测增量部分 + 尾部边界）
 * 
 * 优化：不对整个文本进行特征检测，只检测：
 * 1. 新增的 chunk
 * 2. 尾部 30 字符（处理跨 chunk 的特征）
 */
function needsToolCallFilter(existingText: string, chunk: string): boolean {
  // 检测 chunk 本身
  if (chunk.includes('<') || chunk.includes('{') || chunk.includes('_')) {
    // 快速排除：没有可能的起始字符
    const chunkLower = chunk.toLowerCase();
    if (
      chunkLower.includes('<use_mcp') ||
      chunkLower.includes('<tool_c') ||
      chunkLower.includes('"type"') ||
      chunk.includes('__tool_call_card__')
    ) {
      return true;
    }
  }
  
  // 检测边界：尾部 30 字符 + chunk 组合
  if (existingText.length > 0) {
    const boundary = existingText.slice(-30) + chunk;
    const boundaryLower = boundary.toLowerCase();
    if (
      boundaryLower.includes('<use_mcp') ||
      boundaryLower.includes('<tool_c')
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * 高性能文本追加：针对流式场景优化
 * 
 * 设计原则：
 * 1. 最小化内存分配：复用现有对象引用
 * 2. 延迟过滤：只在检测到工具指令特征时才过滤
 * 3. 增量检测：只检测新增部分和边界
 * 4. Immer 兼容：返回新数组引用以触发更新
 */
export function appendText(segments: MessageSegment[], chunk: string): MessageSegment[] {
  if (!chunk) return segments;
  
  const lastIdx = segments.length - 1;
  
  // 快速路径：追加到现有 text segment
  if (lastIdx >= 0 && segments[lastIdx].kind === 'text') {
    const lastSegment = segments[lastIdx] as TextSegment;
    const existingText = lastSegment.text || '';
    const newText = existingText + chunk;
    
    // 增量特征检测（只检测 chunk 和边界）
    const shouldFilter = needsToolCallFilter(existingText, chunk);
    
    // 创建浅拷贝（只拷贝数组壳，复用其他 segment 引用）
    const out = segments.slice();
    out[lastIdx] = {
      kind: 'text',
      text: shouldFilter ? filterToolCallContent(newText) : newText
    };
    return out;
  }
  
  // 慢速路径：创建新 text segment
  return [...segments, { kind: 'text', text: chunk }];
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

/**
 * 高性能思考文本追加
 * 使用同样的浅拷贝策略优化内存分配
 */
export function appendThinkText(segments: MessageSegment[], chunk: string): MessageSegment[] {
  if (!chunk) return segments;
  
  const lastIdx = segments.length - 1;
  
  if (lastIdx >= 0 && segments[lastIdx].kind === 'think') {
    // 追加到现有 think segment
    const lastSegment = segments[lastIdx] as ThinkSegment;
    const out = segments.slice();
    out[lastIdx] = {
      ...lastSegment,
      text: (lastSegment.text || '') + chunk
    };
    return out;
  }
  
  // 创建新的 think segment
  return [...segments, { kind: 'think', text: chunk, startTime: Date.now() }];
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

