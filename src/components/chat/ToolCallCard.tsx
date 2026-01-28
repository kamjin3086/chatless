"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { Check, X, Globe, Pin } from 'lucide-react';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/components/ui/sonner';
import { resumeToolCallFromCard } from '@/lib/mcp/approval/resumeToolFromCard';
import { presentToolCard } from './toolCardPresentation';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { getProcessSandbox } from '@/lib/skills/sandbox';
import { continueAfterToolCardAction } from '@/lib/mcp/approval/continueToolAfterCardAction';
// 不再在卡片内部触发重试逻辑

type ToolCallStatus = 'success' | 'error' | 'running' | 'pending_auth' | 'stopped';

interface ToolCallCardProps {
  server: string;
  tool: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  resultPreview?: string;
  errorMessage?: string;
  schemaHint?: string; // e.g. required keys or example JSON
  messageId?: string; // enable inline retry when present
  cardId?: string; // 用于授权管理
}

export function ToolCallCard({ server, tool, status, args, resultPreview, errorMessage, schemaHint, messageId, cardId }: ToolCallCardProps) {
  const presentation = React.useMemo(() => presentToolCard({ server, tool, args }), [server, tool, args]);
  const { approveAuthorization, rejectAuthorization, hasPendingAuthorization } = useAuthorizationStore();
  
  // 检查是否有待授权请求
  // 关键：以 status 为准；避免 errorMessage 残留导致“审批完成但 UI 仍像待审批”
  const authKey = cardId && messageId ? `${messageId}:${cardId}` : undefined;
  const isPendingAuth = status === 'pending_auth' || (!!authKey && hasPendingAuthorization(authKey));

  // 重要：工具卡片**永远不默认展开详情**。预览区（两行）足够让用户做审批判断；点击卡片才展开详情。
  const [open, setOpen] = React.useState<boolean>(false);

  const rememberHint =
    isPendingAuth && String(server || '').toLowerCase() === 'filesystem' && presentation.kind === 'path'
      ? '确认后会记住该目录，后续更顺畅'
      : isPendingAuth && String(server || '').toLowerCase() === 'shell_executor' && typeof (args as any)?.workingDir === 'string' && String((args as any).workingDir).trim()
        ? '确认后会记住该工作目录，减少重复确认'
        : undefined;
  
  // 处理授权批准
  const handleApprove = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;

    // 立即 UI 反馈：变为 running（避免“点了没反应/延迟”）
    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_HIT',
        server,
        tool,
        args,
        cardId,
      });
    } catch {
      // ignore
    }

    const ok = approveAuthorization(authKey);
    if (!ok) {
      // 残留/恢复会话：pending 授权不在 store 中。我们用 preApprove + 恢复执行保证点击有结果。
      toast.info('审批已接收', { description: '正在尝试从会话状态恢复并继续执行…' });
      void resumeToolCallFromCard({
        assistantMessageId: messageId,
        cardId,
        server,
        tool,
        args,
      }).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error('恢复执行失败', { description: msg });
        try {
          useChatStore.getState().dispatchMessageAction(messageId, {
            type: 'TOOL_RESULT',
            server,
            tool,
            ok: false,
            errorMessage: `审批已过期，且恢复执行失败：${msg}`,
            cardId,
          } as any);
        } catch {
          // ignore
        }
      });
    }
  }, [authKey, messageId, cardId, server, tool, args, approveAuthorization]);
  
  // 处理授权拒绝
  const handleReject = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;

    // 立即 UI 反馈：标记为拒绝
    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: '用户拒绝',
        cardId,
      } as any);
    } catch {
      // ignore
    }

    const ok = rejectAuthorization(authKey);
    if (!ok) {
      toast.info('已拒绝', { description: '该审批记录已不在队列中（可能是恢复会话的残留卡片）。' });
    }
  }, [authKey, messageId, cardId, server, tool, rejectAuthorization]);

  const handleStopRunning = React.useCallback(() => {
    if (!messageId || !cardId) return;
    const coord = ToolCallCoordinator.getInstance();
    coord.cancelToolCard(messageId, cardId);

    // best-effort: 如果是 shell_executor，尝试取消后端执行
    if (String(server || '').toLowerCase() === 'shell_executor') {
      try {
        const sandbox = getProcessSandbox();
        const executionId = `shell:${messageId}:${String(cardId)}`;
        void sandbox.cancel(executionId);
      } catch {
        // ignore
      }
    }

    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: 'stopped',
        cardId,
      } as any);
    } catch {
      // ignore
    }
    toast.info('已停止该步骤', { description: '该工具已标记为停止（best-effort 取消执行）。' });
    // 继续 agent：给 follow-up 一个“已停止”结果，避免后续工具卡/agent 卡死
    void continueAfterToolCardAction({
      assistantMessageId: messageId,
      cardId,
      server,
      tool,
      args,
      result: { skipped: true, reason: 'USER_STOPPED' },
    }).catch(() => {});
  }, [messageId, cardId, server, tool, args]);

  const handleSkipRunning = React.useCallback(() => {
    if (!messageId || !cardId) return;
    const coord = ToolCallCoordinator.getInstance();
    coord.cancelToolCard(messageId, cardId);

    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: 'skipped',
        cardId,
      } as any);
    } catch {
      // ignore
    }

    toast.info('已跳过该步骤', { description: '将继续后续步骤（忽略该工具的最终输出）。' });
    void continueAfterToolCardAction({
      assistantMessageId: messageId,
      cardId,
      server,
      tool,
      args,
      result: { skipped: true, reason: 'USER_SKIPPED' },
    }).catch(() => {});
  }, [messageId, cardId, server, tool, args]);
  
  return (
    <div
      className={cn(
        // 更“列表项”风格：弱化卡片边框、降低高度与字号
        'w-full overflow-hidden rounded-md bg-slate-50/30 dark:bg-slate-900/10',
        'transition-colors cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-900/20'
      )}
      onClick={() => setOpen((o) => !o)}
    >
      {/* 紧凑两行摘要 */}
      <div className="px-3 py-2 flex items-start gap-2 min-w-0">
        {/* 左侧：状态点 */}
        <div className="mt-1">
          {isPendingAuth ? (
            <div className="flex items-center justify-center w-6" title="等待授权">
              <span className="inline-flex items-center gap-0.5">
                <span className="w-1 h-1 rounded-full bg-indigo-500/90 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-indigo-500/90 animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-1 h-1 rounded-full bg-indigo-500/90 animate-bounce" style={{ animationDelay: '240ms' }} />
              </span>
            </div>
          ) : status === 'running' ? (
            <div className="flex items-center justify-center w-6" title="调用中...">
              <Pin className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
          ) : status === 'stopped' ? (
            <div title="已停止">
              <span className="inline-flex rounded-full h-2 w-2 bg-slate-400 dark:bg-slate-500" />
            </div>
          ) : status === 'success' ? (
            <div title="调用成功">
              <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
            </div>
          ) : (
            <div title="调用失败">
              <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            </div>
          )}
        </div>

        {/* 中间：两行文本（尽量用户友好，不暴露技术字段） */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            {server === WEB_SEARCH_SERVER_NAME ? (
              <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            ) : null}
            <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {presentation.titleLine}
            </span>
          </div>

          {presentation.detailLineFull ? (
            <div
              className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300 truncate"
              title={presentation.detailLineFull}
            >
              <span className="text-slate-400 dark:text-slate-500">
                {presentation.detailLineLabel ? `${presentation.detailLineLabel}: ` : ''}
              </span>
              <span className={cn(
                presentation.kind === 'shell' ? 'font-mono' : undefined
              )}>
                {presentation.detailLineFull}
              </span>
            </div>
          ) : null}
        </div>

        {/* 右侧：审批按钮（仅 pending_auth） */}
        {isPendingAuth ? (
          <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleApprove}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold transition-colors active:scale-95"
              title={rememberHint ? `确认并继续执行（${rememberHint}）` : '确认并继续执行'}
            >
              <Check className="w-3.5 h-3.5 text-white" />
              确认
            </button>
            <button
              onClick={handleReject}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors active:scale-95"
              title="取消执行"
            >
              <X className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
              取消
            </button>
          </div>
        ) : null}

        {/* 右侧：运行中可跳过/停止 */}
        {!isPendingAuth && status === 'running' ? (
          <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleStopRunning}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition-colors active:scale-95"
              title="停止该工具（best-effort）"
            >
              停止
            </button>
            <button
              onClick={handleSkipRunning}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/70 hover:bg-white dark:bg-slate-900/30 dark:hover:bg-slate-900/40 text-[11px] font-semibold text-slate-600 dark:text-slate-300 transition-colors active:scale-95 border border-slate-200/60 dark:border-slate-700/60"
              title="跳过等待该工具，继续后续步骤"
            >
              跳过
            </button>
          </div>
        ) : null}
      </div>

      {/* 可展开详情区：参数/结果/错误 */}
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 space-y-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            工具：<span className="font-mono">{server}.{tool}</span>
          </div>
          {rememberHint ? (
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              <span className="font-semibold">提示：</span>
              {rememberHint}
            </div>
          ) : null}
          {args && Object.keys(args).length > 0 && (
            <div className="text-[12px] text-slate-700 dark:text-slate-300">
              <div className="mb-1 font-semibold text-slate-800 dark:text-slate-200">参数</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-slate-100/60 dark:bg-slate-900/30 rounded-md p-2 border border-slate-200/60 dark:border-slate-800/60">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {status === 'success' && resultPreview && (
            <div className="text-[12px] text-slate-700 dark:text-slate-300">
              <div className="mb-1 font-semibold text-slate-800 dark:text-slate-200">结果</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-slate-100/60 dark:bg-slate-900/30 rounded-md p-2 border border-slate-200/60 dark:border-slate-800/60">
                {resultPreview}
              </pre>
            </div>
          )}

          {status === 'error' && (
            <div className="text-[12px] text-red-800 dark:text-red-300">
              <div className="mb-1 font-semibold">错误信息</div>
              <div className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-red-50/70 dark:bg-red-950/30 rounded-md p-2 border border-red-200/70 dark:border-red-900/50">
                {errorMessage || '未知错误'}
              </div>
              {schemaHint && (
                <div className="mt-2 text-[12px] text-slate-700 dark:text-slate-300">
                  <div className="mb-1 font-semibold text-slate-800 dark:text-slate-200">修复建议</div>
                  <div className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[12px] bg-slate-100/60 dark:bg-slate-900/30 rounded-md p-2 border border-slate-200/60 dark:border-slate-800/60">
                    {schemaHint}
                  </div>
                </div>
              )}
            </div>
          )}

          {status === 'stopped' && (
            <div className="text-[12px] text-slate-700 dark:text-slate-300">
              <div className="mb-1 font-semibold">已停止</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {errorMessage === 'skipped' ? '已跳过该步骤，忽略该工具输出。' : '用户已停止该步骤。'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

