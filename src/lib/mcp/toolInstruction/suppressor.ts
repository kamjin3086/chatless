/**
 * 工具指令抑制器
 * 
 * ## 设计目标
 * 
 * 在流式输出过程中，确保"工具调用指令文本"不会短暂暴露给 UI，
 * 同时保证不会误伤正常文本（尤其是 HTML/代码里的 "<"）。
 * 
 * ## 工作原理
 * 
 * 1. **守卫窗口**: 保留尾部窗口避免半截起点被提前吐出
 * 2. **高置信度触发**: 仅在命中明确的指令起点后进入抑制态
 * 3. **可靠结束条件**: XML 闭合标签或 JSON 大括号闭合
 * 
 * ## 重构说明
 * 
 * 此模块是对原 `toolInstructionSuppressor.ts` 的重构，
 * 使用 `patterns.ts` 中定义的统一模式。
 */

import { 
  type SuppressionMode, 
  getSuppressionTriggers, 
  mightContainToolInstruction 
} from './patterns';

// 重新导出 SuppressionMode 供外部使用
export type { SuppressionMode } from './patterns';

export interface SuppressorOptions {
  /** 守卫窗口大小（默认 64） */
  guardWindow?: number;
  /** 最大缓冲区大小（默认 65536） */
  maxBuffer?: number;
}

export interface SuppressorUpdate {
  /** 可以显示给用户的文本 */
  visible: string;
  /** 是否刚进入抑制状态 */
  started: boolean;
  /** 是否刚结束抑制状态 */
  ended: boolean;
  /** 仅在 ended 时提供：完整被抑制的指令文本 */
  captured?: string;
}

export interface ToolInstructionSuppressor {
  /** 推送新的文本块 */
  push(chunk: string): SuppressorUpdate;
  /** 刷新缓冲区（流结束时调用） */
  flush(): { tail: string; captured?: string; hadSuppression: boolean };
  /** 获取当前状态 */
  getState(): { active: boolean; mode?: SuppressionMode };
}


export function createToolInstructionSuppressor(opts?: SuppressorOptions): ToolInstructionSuppressor {
  const guardWindow = Math.max(16, Math.min(256, opts?.guardWindow ?? 64));
  const maxBuffer = Math.max(2048, Math.min(131072, opts?.maxBuffer ?? 65536));
  
  const triggers = getSuppressionTriggers();

  
  let buffer = '';
  let active = false;
  let mode: SuppressionMode | undefined = undefined;
  let braceDepth = 0;
  let seenJsonStart = false;
  let captured = '';
  let isReversedFormat = false; // 标记是否是反向格式 json{...}commentary
  
  /**
   * 查找最早的触发点
   */
  const findEarliestTrigger = (text: string): null | { index: number; mode: SuppressionMode; reversed?: boolean } => {
    let bestIdx = -1;
    let bestMode: SuppressionMode | undefined;
    let reversed = false;
    
    for (const t of triggers) {
      const m = t.pattern.exec(text);
      if (!m) continue;
      if (bestIdx === -1 || m.index < bestIdx) {
        bestIdx = m.index;
        bestMode = t.mode;
        // 检测是否是反向格式（json{...}commentary）
        reversed = /json\s*\{/i.test(m[0]);
      }
    }
    
    if (bestIdx === -1 || !bestMode) return null;
    return { index: bestIdx, mode: bestMode, reversed };
  };
  
  /**
   * 进入抑制状态
   */
  const enterSuppression = (suppressedTail: string, m: SuppressionMode, reversed = false) => {
    active = true;
    mode = m;
    braceDepth = 0;
    seenJsonStart = false;
    isReversedFormat = reversed;
    buffer = suppressedTail;
    captured = suppressedTail;
  };
  
  /**
   * 退出抑制状态
   */
  const exitSuppression = (tailAfter: string) => {
    active = false;
    mode = undefined;
    braceDepth = 0;
    seenJsonStart = false;
    isReversedFormat = false;
    buffer = tailAfter;
  };
  
  /**
   * 处理抑制状态中的缓冲区
   */
  const processActive = (): { ended: boolean; tailAfter: string; capturedEnded?: string } => {
    if (!active || !mode) return { ended: false, tailAfter: '' };
    
    if (mode === 'xml_use_mcp_tool') {
      const closeIdx = buffer.search(/<\/use_mcp_tool>/i);
      if (closeIdx >= 0) {
        const endPos = closeIdx + '</use_mcp_tool>'.length;
        return { 
          ended: true, 
          tailAfter: buffer.slice(endPos),
          capturedEnded: buffer.slice(0, endPos)
        };
      }
      return { ended: false, tailAfter: '' };
    }
    
    if (mode === 'xml_tool_call') {
      const closeIdx = buffer.search(/<\/tool_call>/i);
      if (closeIdx >= 0) {
        const endPos = closeIdx + '</tool_call>'.length;
        return { 
          ended: true, 
          tailAfter: buffer.slice(endPos),
          capturedEnded: buffer.slice(0, endPos)
        };
      }
      return { ended: false, tailAfter: '' };
    }
    
    // json_like：以大括号闭合为结束条件
    // 对于反向格式 json{...}commentary to=...，需要等到换行符才结束
    
    // 关键修复：每次扫描 buffer 时必须重置 braceDepth 和 seenJsonStart
    // 因为每次 processActive 都是从头扫描整个 buffer
    // 之前的 bug：这些变量是持久化的，导致每次扫描都累加 braceDepth
    braceDepth = 0;
    seenJsonStart = false;
    
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === '{') {
        seenJsonStart = true;
        braceDepth++;
      } else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      }
      
      const isBoundary = ch === '\n' || ch === ';';
      
      // 对于反向格式，只在换行符处结束，确保 commentary to=... 部分也被抑制
      if (isReversedFormat) {
        if (isBoundary) {
          return { 
            ended: true, 
            tailAfter: buffer.slice(i + 1),
            capturedEnded: buffer.slice(0, i + 1)
          };
        }
        continue;
      }
      
      const done = (seenJsonStart && braceDepth === 0) || (!seenJsonStart && isBoundary);
      
      if (done) {

        return { 
          ended: true, 
          tailAfter: buffer.slice(i + 1),
          capturedEnded: buffer.slice(0, i + 1)
        };
      }
    }

    return { ended: false, tailAfter: '' };
  };
  
  /**
   * 修剪过长的缓冲区
   */
  const trimBufferIfNeeded = () => {
    if (buffer.length > maxBuffer) buffer = buffer.slice(-maxBuffer);
    if (captured.length > maxBuffer) captured = captured.slice(-maxBuffer);
  };
  
  const push = (chunk: string): SuppressorUpdate => {
    const incoming = String(chunk || '');
    if (!incoming) return { visible: '', started: false, ended: false };
    
    let started = false;
    let ended = false;
    let visible = '';
    let endedCaptured: string | undefined;
    
    buffer += incoming;
    
    // 快速路径：当缓冲中不包含任何可能触发工具指令的特征时，直接透传
    if (!active && !mightContainToolInstruction(buffer)) {

      visible += buffer;
      buffer = '';
      return { visible, started: false, ended: false };
    }
    
    // 1) 未在抑制态：检查触发
    if (!active) {
      const hit = findEarliestTrigger(buffer);

      if (hit) {
        const before = buffer.slice(0, hit.index);
        const suppressedTail = buffer.slice(hit.index);
        visible += before;
        enterSuppression(suppressedTail, hit.mode, hit.reversed);
        started = true;
      } else {
        // 未命中：按 guardWindow 释放
        if (buffer.length > guardWindow) {
          visible += buffer.slice(0, buffer.length - guardWindow);
          buffer = buffer.slice(-guardWindow);
        }
      }
    }
    
    // 2) 在抑制态：吞掉，直到结束条件满足
    if (active) {
      if (!started) captured += incoming;
      trimBufferIfNeeded();
      
      const r = processActive();
      if (r.ended) {
        ended = true;
        endedCaptured = r.capturedEnded;
        
        const capturedOut = endedCaptured ?? captured;
        const tailAfter = r.tailAfter || '';
        
        exitSuppression(tailAfter);
        captured = '';
        
        if (buffer.length > 0) {
          if (buffer.length > guardWindow) {
            visible += buffer.slice(0, buffer.length - guardWindow);
            buffer = buffer.slice(-guardWindow);
          }
        }
        
        return { visible, started, ended, captured: capturedOut };
      }
      
      return { visible, started, ended };
    }
    
    return { visible, started, ended };
  };
  
  const flush = () => {
    if (active) {
      const cap = captured || buffer;
      buffer = '';
      captured = '';
      active = false;
      mode = undefined;
      braceDepth = 0;
      seenJsonStart = false;
      isReversedFormat = false;
      return { tail: '', captured: cap || undefined, hadSuppression: true };
    }
    
    const tail = buffer;
    buffer = '';
    return { tail, hadSuppression: false };
  };
  
  return {
    push,
    flush,
    getState: () => ({ active, mode }),
  };
}
