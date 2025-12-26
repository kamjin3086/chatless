/**
 * 工具指令抑制器（稳定版）
 *
 * 目标：
 * - 在流式过程中，确保“工具调用指令文本”不会短暂暴露给 UI
 * - 同时保证 **不会误伤正常文本**（尤其是 HTML/代码里的 "<"）
 *
 * 设计要点：
 * - 仅在命中“高置信度起点”后才进入抑制态（例如 <use_mcp_tool>、<tool_call>、commentary to=...{）
 * - 抑制结束条件更可靠：
 *   - XML：找到闭合标签 </use_mcp_tool> / </tool_call>
 *   - JSON：检测到 { ... } 大括号闭合
 * - 在未命中指令前，保留 guardWindow 尾部窗口，避免“半截起点”被提前吐出
 */

export type SuppressionMode = 'xml_use_mcp_tool' | 'xml_tool_call' | 'json_like';

export interface SuppressorOptions {
  guardWindow?: number;
  maxBuffer?: number;
}

export interface SuppressorUpdate {
  visible: string;
  started: boolean;
  ended: boolean;
  /** 仅在 ended 时提供：完整被抑制的指令文本（可用于兜底解析为 tool_call） */
  captured?: string;
}

export interface ToolInstructionSuppressor {
  push(chunk: string): SuppressorUpdate;
  flush(): { tail: string; captured?: string; hadSuppression: boolean };
  getState(): { active: boolean; mode?: SuppressionMode };
}

export function createToolInstructionSuppressor(opts?: SuppressorOptions): ToolInstructionSuppressor {
  const guardWindow = Math.max(16, Math.min(256, opts?.guardWindow ?? 64));
  const maxBuffer = Math.max(2048, Math.min(131072, opts?.maxBuffer ?? 65536));

  let buffer = '';
  let active = false;
  let mode: SuppressionMode | undefined = undefined;
  let braceDepth = 0;
  let seenJsonStart = false;
  let captured = '';

  const triggers: Array<{ re: RegExp; mode: SuppressionMode }> = [
    { re: /<use_mcp_tool>/i, mode: 'xml_use_mcp_tool' },
    { re: /<tool_call>/i, mode: 'xml_tool_call' },
    // GPT‑OSS / to= / 函数式变体：必须出现 "{" 才进入抑制，降低误判
    { re: /<\|channel\|\>\s*commentary\s+to=[^\n{]{1,200}\{/i, mode: 'json_like' },
    { re: /commentary\s+to=[^\n{]{1,200}\{/i, mode: 'json_like' },
    { re: /(?:^|\s)to\s*=\s*[a-z0-9_.-]+\s*\{/i, mode: 'json_like' },
    { re: /(?:^|\s)[a-z0-9_]+\.[a-z0-9_]+\s*\{/i, mode: 'json_like' },
  ];

  const findEarliestTrigger = (text: string): null | { index: number; mode: SuppressionMode } => {
    let bestIdx = -1;
    let bestMode: SuppressionMode | undefined;
    for (const t of triggers) {
      const m = t.re.exec(text);
      if (!m) continue;
      if (bestIdx === -1 || m.index < bestIdx) {
        bestIdx = m.index;
        bestMode = t.mode;
      }
    }
    if (bestIdx === -1 || !bestMode) return null;
    return { index: bestIdx, mode: bestMode };
  };

  const enterSuppression = (suppressedTail: string, m: SuppressionMode) => {
    active = true;
    mode = m;
    braceDepth = 0;
    seenJsonStart = false;
    buffer = suppressedTail;
    captured = suppressedTail;
  };

  const exitSuppression = (tailAfter: string) => {
    active = false;
    mode = undefined;
    braceDepth = 0;
    seenJsonStart = false;
    buffer = tailAfter;
  };

  const processActive = (): { ended: boolean; tailAfter: string; capturedEnded?: string } => {
    if (!active || !mode) return { ended: false, tailAfter: '' };

    if (mode === 'xml_use_mcp_tool') {
      const closeIdx = buffer.search(/<\/use_mcp_tool>/i);
      if (closeIdx >= 0) {
        const endPos = closeIdx + '</use_mcp_tool>'.length;
        const endedCaptured = buffer.slice(0, endPos);
        const tailAfter = buffer.slice(endPos);
        return { ended: true, tailAfter, capturedEnded: endedCaptured };
      }
      return { ended: false, tailAfter: '' };
    }

    if (mode === 'xml_tool_call') {
      const closeIdx = buffer.search(/<\/tool_call>/i);
      if (closeIdx >= 0) {
        const endPos = closeIdx + '</tool_call>'.length;
        const endedCaptured = buffer.slice(0, endPos);
        const tailAfter = buffer.slice(endPos);
        return { ended: true, tailAfter, capturedEnded: endedCaptured };
      }
      return { ended: false, tailAfter: '' };
    }

    // json_like：以大括号闭合为结束条件；如果迟迟没有 '{'，遇到换行/分号边界也结束（容错）
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === '{') {
        seenJsonStart = true;
        braceDepth++;
      } else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      }

      const isBoundary = ch === '\n' || ch === ';';
      const done = (seenJsonStart && braceDepth === 0) || (!seenJsonStart && isBoundary);
      if (done) {
        const tailAfter = buffer.slice(i + 1);
        const endedCaptured = buffer.slice(0, i + 1);
        return { ended: true, tailAfter, capturedEnded: endedCaptured };
      }
    }
    return { ended: false, tailAfter: '' };
  };

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

    // 追加到缓冲
    buffer += incoming;

    // 快速路径：当缓冲中不包含任何“可能触发工具指令”的特征时，直接全部透传，避免普通文本被 guardWindow 延迟。
    // 触发工具指令的形态至少需要出现：
    // - XML: '<'
    // - JSON / 函数式 / to=: '{' 或 'to=' / 'commentary'
    // 因此在完全“无特征”的情况下，立即输出是安全且更符合流式体验的。
    if (!active) {
      const looksRisky =
        buffer.includes('<') ||
        buffer.includes('{') ||
        /<\|channel\|>/i.test(buffer) ||
        /commentary\s+to=/i.test(buffer) ||
        /(?:^|\s)to\s*=/i.test(buffer);
      if (!looksRisky) {
        visible += buffer;
        buffer = '';
        return { visible, started: false, ended: false };
      }
    }

    // 1) 未在抑制态：检查触发
    if (!active) {
      const hit = findEarliestTrigger(buffer);
      if (hit) {
        const before = buffer.slice(0, hit.index);
        const suppressedTail = buffer.slice(hit.index);
        visible += before;
        enterSuppression(suppressedTail, hit.mode);
        started = true;
      } else {
        // 未命中：按 guardWindow 释放，避免半截起点提前吐出
        if (buffer.length > guardWindow) {
          visible += buffer.slice(0, buffer.length - guardWindow);
          buffer = buffer.slice(-guardWindow);
        } else {
          // 缓冲不足窗口，先不输出
          visible += '';
        }
      }
    }

    // 2) 在抑制态：吞掉，直到结束条件满足
    if (active) {
      // 进入抑制态后，buffer 已被 enterSuppression 重设为 suppressedTail；
      // 若本次 push 是在已抑制态下进入，这里需要同步 captured
      if (!started) captured += incoming;
      trimBufferIfNeeded();

      const r = processActive();
      if (r.ended) {
        ended = true;
        endedCaptured = r.capturedEnded;

        // 仅使用“本次确切闭合”的 capturedEnded 作为 captured 输出，避免把尾部正常文本也算进去
        const capturedOut = endedCaptured ?? captured;
        const tailAfter = r.tailAfter || '';

        // 退出抑制并把尾部放回 buffer，继续尝试吐出一部分（遵循 guardWindow）
        exitSuppression(tailAfter);

        // 清理 captured（下一段重新累计）
        captured = '';

        if (buffer.length > 0) {
          // 退出抑制后把尾部当作普通文本处理一次（不再递归触发新的抑制，交给后续 push）
          if (buffer.length > guardWindow) {
            visible += buffer.slice(0, buffer.length - guardWindow);
            buffer = buffer.slice(-guardWindow);
          }
        }

        return { visible, started, ended, captured: capturedOut };
      }

      // 仍在抑制：不输出任何抑制内容
      return { visible, started, ended };
    }

    return { visible, started, ended };
  };

  const flush = () => {
    // flush 只用于：把 guardWindow 尾巴补齐输出，避免“尾巴丢字”
    // 若仍在抑制态：不输出尾巴（都是指令），但把 captured 返回给上层兜底解析
    if (active) {
      const cap = captured || buffer;
      // 重置
      buffer = '';
      captured = '';
      active = false;
      mode = undefined;
      braceDepth = 0;
      seenJsonStart = false;
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


