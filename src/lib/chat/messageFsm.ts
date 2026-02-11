import type { Message } from '@/types/chat';
import { ensureTextTail, appendText, appendThinkText, insertRunningCard, updateCardStatus, finishLastThink, filterToolCallContent } from './segments';

export type FsmState = 'RENDERING_BODY' | 'RENDERING_THINK' | 'TOOL_RUNNING' | 'TOOL_DONE' | 'TOOL_ERROR' | 'COMPLETE';

export type MessageAction =
  | { type: 'TOKEN_APPEND'; chunk: string }
  | { type: 'THINK_START' }
  | { type: 'THINK_APPEND'; chunk: string }
  | { type: 'THINK_END' }
  | { type: 'TOOL_DETECTING_START' }
  | { type: 'TOOL_DETECTING_END' }
  | { type: 'TOOL_HIT'; server: string; tool: string; args?: Record<string, unknown>; cardId: string }
  | { type: 'TOOL_RESULT'; server: string; tool: string; ok: true; resultPreview: string; cardId?: string }
  | { type: 'TOOL_RESULT'; server: string; tool: string; ok: false; errorMessage: string; schemaHint?: string; cardId?: string }
  | { type: 'STREAM_END' };

export interface MessageModel {
  segments: NonNullable<Message['segments']>;
  fsm: FsmState;
  id: string;
  detectingTool?: boolean;
}

export function initModel(msg: Message): MessageModel {
  const segs = Array.isArray(msg.segments) ? msg.segments : [];
  // 从已有 segments 推断 FSM，避免在 flush/reduce 时把工具运行态“重置”为 RENDERING_BODY
  // 否则会出现：工具卡片已插入但 STREAM_END 仍把消息判定为 COMPLETE/sent，造成 UI 状态错乱。
  let hasToolRunning = false;
  let hasToolError = false;
  let hasToolSuccess = false;
  for (const s of segs as any[]) {
    if (s?.kind !== 'toolCard') continue;
    const st = String(s?.status || '');
    if (st === 'running' || st === 'pending_auth') hasToolRunning = true;
    else if (st === 'error') hasToolError = true;
    else if (st === 'success') hasToolSuccess = true;
  }

  let fsm: FsmState = 'RENDERING_BODY';
  const last: any = segs.length ? (segs as any[])[segs.length - 1] : undefined;
  if (last?.kind === 'think') fsm = 'RENDERING_THINK';

  if (hasToolRunning) fsm = 'TOOL_RUNNING';
  else if (hasToolError) fsm = 'TOOL_ERROR';
  else if (hasToolSuccess) fsm = 'TOOL_DONE';

  const streamEnded = !!(msg as any)._streamEnded;
  if (streamEnded && fsm !== 'TOOL_RUNNING' && fsm !== 'TOOL_ERROR') {
    fsm = 'COMPLETE';
  }

  return { segments: segs, fsm, id: msg.id, detectingTool: false };
}

export function reduce(model: MessageModel, action: MessageAction): MessageModel {
  switch (action.type) {
    case 'TOKEN_APPEND': {
      // —— 兜底修复：孤立的 </think>（无 <think>）——
      // 运行证据：部分模型会输出思考文本 + "</think>"，但漏掉 "<think>" 开始标签。
      // 结果：UI 看见 "</think>"，思考栏不出现。这里在 reducer 层“回填”成 think 段。
      try {
        const rawChunk = String(action.chunk || '');
        // 重要：无论是否触发 salvage，都不应把 <think>/<\think> 字面量渲染到正文里
        const chunk = rawChunk.replaceAll('</think>', '').replaceAll('<think>', '');

        if (rawChunk.includes('</think>') && model.fsm !== 'RENDERING_THINK') {
          const hasThinkSeg = (model.segments as any[]).some((s: any) => s && s.kind === 'think');
          const hasOpenThinkInText = (model.segments as any[]).some(
            (s: any) => s && s.kind === 'text' && String(s.text || '').includes('<think>')
          );
          const hasNonText = (model.segments as any[]).some((s: any) => s && s.kind !== 'text');

          if (!hasThinkSeg && !hasOpenThinkInText && !hasNonText) {
            const closeIdx = rawChunk.indexOf('</think>');
            const beforeClose = closeIdx >= 0 ? rawChunk.slice(0, closeIdx) : rawChunk;
            const afterClose = closeIdx >= 0 ? rawChunk.slice(closeIdx + '</think>'.length) : '';
            const existingText = (model.segments as any[])
              .filter((s: any) => s && s.kind === 'text')
              .map((s: any) => String(s.text || ''))
              .join('');

            const thinkingText = existingText + beforeClose;
            const nextSegs: any[] = [];
            if (thinkingText && thinkingText.trim().length > 0) {
              // duration 设为一个很小的正值，避免被当作“仍在思考中”（duration===0 会被当作活跃段）
              nextSegs.push({ kind: 'think', text: thinkingText, duration: 0.1 });
            }
            // 思考结束后保证有 text 尾巴，承接后续正文
            nextSegs.push({ kind: 'text', text: afterClose || '' });

            return { ...model, segments: nextSegs as any, fsm: 'RENDERING_BODY' };
          }
        }

        // 非 salvage 情况下：继续走正常 append，但使用“去标签”的 chunk，避免 '</think>' 泄漏到正文
        if (!chunk) return model;
      } catch {
        // ignore: never block streaming
      }

      if (model.fsm === 'RENDERING_THINK') {
        const base = [...model.segments];
        const rawChunk = String(action.chunk || '');
        const safeChunk = rawChunk.replaceAll('</think>', '').replaceAll('<think>', '');
        if (!safeChunk) return model;
        return { ...model, segments: appendThinkText(base, safeChunk) as any };
      }
      // 放开 TOOL_RUNNING 的返回：允许在工具执行期间继续渲染“安全正文”
      // 指令拦截交给抑制阀 + filterToolCallContent，避免误把指令残片渲染出来
      const base = ensureTextTail(model.segments, '');
      const rawChunk = String(action.chunk || '');
      const safeChunk = rawChunk.replaceAll('</think>', '').replaceAll('<think>', '');
      if (!safeChunk) return model;
      const next = appendText(base, safeChunk);
      return { ...model, segments: next as any };
    }
    case 'THINK_START': {
      // 转入思考段，追加一个空的 think 段，并记录开始时间
      const out = [...model.segments, { kind: 'think', text: '', startTime: Date.now() } as any];
      // 降噪：移除冗余FSM日志
      return { ...model, segments: out, fsm: 'RENDERING_THINK' };
    }
    case 'THINK_APPEND': {
      const out = appendThinkText(model.segments, action.chunk);
      // console.log('[FSM:THINK_APPEND]', { id: model.id, addLen: (action.chunk||'').length, segLen: out.length });
      return { ...model, segments: out as any, fsm: 'RENDERING_THINK' };
    }
    case 'THINK_END': {
      // 结束思考段，记录时长，然后回到正文
      
      // 先完成最后一个think段，记录其持续时长
      const finished = finishLastThink(model.segments);
      // 思考结束后在正文末尾创建一个空 text 段，确保后续正文不会"接着写在 think 段上"
      const base = ensureTextTail(finished, '');
      return { ...model, segments: base as any, fsm: 'RENDERING_BODY' };
    }
    case 'TOOL_DETECTING_START': {
      // 标记为“正在识别工具调用”，用于 UI 展示占位动画
      if (model.fsm === 'TOOL_RUNNING') return model;
      return { ...model, detectingTool: true };
    }
    case 'TOOL_DETECTING_END': {
      return { ...model, detectingTool: false };
    }
    case 'TOOL_HIT': {
      // 在插入卡片前，先清理尾部text中的任何指令残片，避免已累计的半截标签被显示
      const cleanedTail = (() => {
        const segs = Array.isArray(model.segments) ? [...model.segments] : [];
        if (segs.length > 0 && (segs[segs.length - 1] as any).kind === 'text') {
          const last: any = { ...(segs[segs.length - 1] as any) };
          last.text = filterToolCallContent(String(last.text || ''));
          segs[segs.length - 1] = last;
        }
        return ensureTextTail(segs, '');
      })();
      const next = insertRunningCard(cleanedTail, {
        id: action.cardId,
        server: action.server,
        tool: action.tool,
        args: action.args,
        messageId: model.id,
      } as any);
      
      return { ...model, segments: next as any, fsm: 'TOOL_RUNNING', detectingTool: false };
    }
    case 'TOOL_RESULT': {
      if (action.ok) {
        const next = updateCardStatus(model.segments, { id: action.cardId, server: action.server, tool: action.tool }, { status: 'success', resultPreview: action.resultPreview });
        
        return { ...model, segments: next as any, fsm: 'TOOL_DONE' };
      }
      // 特殊处理：如果是等待授权状态，不改变 fsm
      if (action.errorMessage === 'pending_auth') {
        const next = updateCardStatus(model.segments, { id: action.cardId, server: action.server, tool: action.tool }, { status: 'pending_auth' as any, errorMessage: action.errorMessage });
        
        return { ...model, segments: next as any, fsm: 'TOOL_RUNNING' }; // 保持 TOOL_RUNNING 状态
      }
      // 特殊处理：用户主动停止/跳过（不应渲染为 error 红态）
      if (action.errorMessage === 'stopped' || action.errorMessage === 'skipped') {
        const next = updateCardStatus(
          model.segments,
          { id: action.cardId, server: action.server, tool: action.tool },
          { status: 'stopped' as any, errorMessage: action.errorMessage }
        );
        return { ...model, segments: next as any, fsm: 'TOOL_DONE' };
      }
      const next = updateCardStatus(model.segments, { id: action.cardId, server: action.server, tool: action.tool }, { status: 'error', errorMessage: action.errorMessage, schemaHint: action.schemaHint });
      
      return { ...model, segments: next as any, fsm: 'TOOL_ERROR' };
    }
    case 'STREAM_END': {
      const nextFsm = model.fsm === 'RENDERING_BODY' ? 'COMPLETE' : model.fsm;
      
      return { ...model, fsm: nextFsm };
    }
    default:
      return model;
  }
}

