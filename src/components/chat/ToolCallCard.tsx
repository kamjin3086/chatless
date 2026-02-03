"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { Check, X, Globe, Loader2, ChevronRight } from 'lucide-react';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/components/ui/sonner';
import { resumeToolCallFromCard } from '@/lib/mcp/approval/resumeToolFromCard';
import { presentToolCard } from './toolCardPresentation';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { getProcessSandbox } from '@/lib/skills/sandbox';
import { continueAfterToolCardAction } from '@/lib/mcp/approval/continueToolAfterCardAction';

type ToolCallStatus = 'success' | 'error' | 'running' | 'pending_auth' | 'stopped';

interface ToolCallCardProps {
  server: string;
  tool: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  resultPreview?: string;
  errorMessage?: string;
  schemaHint?: string;
  messageId?: string;
  cardId?: string;
}

export function ToolCallCard({ server, tool, status, args, resultPreview, errorMessage, schemaHint, messageId, cardId }: ToolCallCardProps) {
  const presentation = React.useMemo(() => presentToolCard({ server, tool, args }), [server, tool, args]);
  const { approveAuthorization, rejectAuthorization, hasPendingAuthorization } = useAuthorizationStore();
  
  // 展开/折叠状态 - 默认折叠（预览模式）
  const [expanded, setExpanded] = React.useState(false);
  
  const authKey = cardId && messageId ? `${messageId}:${cardId}` : undefined;
  const isPendingAuth = status === 'pending_auth' || (!!authKey && hasPendingAuthorization(authKey));

  const rememberHint =
    isPendingAuth && String(server || '').toLowerCase() === 'filesystem' && presentation.kind === 'path'
      ? '确认后会记住该目录'
      : isPendingAuth && String(server || '').toLowerCase() === 'shell_executor' && typeof (args as any)?.workingDir === 'string' && String((args as any).workingDir).trim()
        ? '确认后会记住该目录'
        : undefined;
  
  const handleApprove = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;
    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_HIT',
        server,
        tool,
        args,
        cardId,
      });
    } catch { /* ignore */ }

    const ok = approveAuthorization(authKey);
    if (!ok) {
      toast.info('审批已接收', { description: '正在尝试恢复执行…' });
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
            errorMessage: `恢复执行失败：${msg}`,
            cardId,
          } as any);
        } catch { /* ignore */ }
      });
    }
  }, [authKey, messageId, cardId, server, tool, args, approveAuthorization]);
  
  const handleReject = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;
    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: '用户拒绝',
        cardId,
      } as any);
    } catch { /* ignore */ }

    const ok = rejectAuthorization(authKey);
    if (!ok) {
      toast.info('已拒绝');
    }
  }, [authKey, messageId, cardId, server, tool, rejectAuthorization]);

  const handleStopRunning = React.useCallback(() => {
    if (!messageId || !cardId) return;
    const coord = ToolCallCoordinator.getInstance();
    coord.cancelToolCard(messageId, cardId);

    if (String(server || '').toLowerCase() === 'shell_executor') {
      try {
        const sandbox = getProcessSandbox();
        const executionId = `shell:${messageId}:${String(cardId)}`;
        void sandbox.cancel(executionId);
      } catch { /* ignore */ }
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
    } catch { /* ignore */ }
    toast.info('已停止');
    try {
      const st = useChatStore.getState() as any;
      const conv = (st.conversations || []).find((c: any) => (c?.messages || []).some((m: any) => m?.id === messageId));
      const isAgent = String(conv?.tool_mode || '').toLowerCase() === 'agent';
      if (!isAgent) {
        void continueAfterToolCardAction({
          assistantMessageId: messageId,
          cardId,
          server,
          tool,
          args,
          result: { skipped: true, reason: 'USER_STOPPED' },
        }).catch(() => {});
      }
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }

    toast.info('已跳过');
    try {
      const st = useChatStore.getState() as any;
      const conv = (st.conversations || []).find((c: any) => (c?.messages || []).some((m: any) => m?.id === messageId));
      const isAgent = String(conv?.tool_mode || '').toLowerCase() === 'agent';
      if (!isAgent) {
        void continueAfterToolCardAction({
          assistantMessageId: messageId,
          cardId,
          server,
          tool,
          args,
          result: { skipped: true, reason: 'USER_SKIPPED' },
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }, [messageId, cardId, server, tool, args]);

  // 状态样式
  const statusColor = isPendingAuth 
    ? 'text-amber-500' 
    : status === 'running' 
      ? 'text-blue-500' 
      : status === 'stopped' 
        ? 'text-slate-400' 
        : status === 'success' 
          ? 'text-emerald-500' 
          : 'text-red-500';

  // 状态符号
  const StatusIcon = () => {
    if (status === 'running') {
      return <Loader2 className="w-3 h-3 animate-spin" />;
    }
    if (isPendingAuth) {
      return <span className="text-[10px] font-bold">?</span>;
    }
    if (status === 'success') {
      return <Check className="w-3 h-3" />;
    }
    if (status === 'error') {
      return <X className="w-3 h-3" />;
    }
    return <span className="text-[10px]">-</span>;
  };

  // 是否有详情可展开
  const hasDetails = (args && Object.keys(args).length > 0) || resultPreview || errorMessage;

  return (
    <div className="text-xs">
      {/* 预览行：可点击展开 */}
      <div 
        className={cn(
          "flex items-center gap-1.5 py-0.5 rounded transition-colors",
          hasDetails && "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30"
        )}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {/* 展开指示器 */}
        {hasDetails ? (
          <ChevronRight 
            className={cn(
              "w-3 h-3 text-slate-400 transition-transform shrink-0",
              expanded && "rotate-90"
            )} 
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* 状态图标 */}
        <span className={cn("shrink-0", statusColor)}>
          <StatusIcon />
        </span>

        {/* 工具名称和摘要 */}
        <div className="flex-1 min-w-0 flex items-center gap-1 truncate">
          {(server === WEB_SEARCH_SERVER_NAME || server === 'web_search') && (
            <Globe className="w-3 h-3 text-blue-500 shrink-0" />
          )}
          <span className="text-slate-600 dark:text-slate-300 shrink-0">
            {presentation.titleLine}
          </span>
          {(presentation.detailLineShort || presentation.detailLineFull) && (
            <>
              <span className="text-slate-300 dark:text-slate-600">→</span>
              <span className="text-slate-500 dark:text-slate-400 truncate" title={presentation.detailLineFull}>
                {presentation.detailLineShort || presentation.detailLineFull}
              </span>
            </>
          )}
          
          {/* 错误简要提示 */}
          {status === 'error' && !expanded && (
            <span className="text-red-500 truncate ml-1">
              {errorMessage && errorMessage.length > 30 ? errorMessage.slice(0, 30) + '…' : errorMessage}
            </span>
          )}
        </div>

        {/* 审批按钮 */}
        {isPendingAuth && (
          <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleApprove}
              className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              title={rememberHint || '确认'}
            >
              确认
            </button>
            <button
              onClick={handleReject}
              className="px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            >
              取消
            </button>
          </div>
        )}

        {/* 运行中操作 */}
        {!isPendingAuth && status === 'running' && (
          <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleStopRunning}
              className="px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            >
              停止
            </button>
            <button
              onClick={handleSkipRunning}
              className="px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
            >
              跳过
            </button>
          </div>
        )}
      </div>

      {/* 展开的详情区域 - 使用 CSS 过渡避免跳动 */}
      <div 
        className={cn(
          "overflow-hidden transition-all duration-150 ease-out",
          expanded && hasDetails ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="ml-6 mt-1 mb-1 pl-2 border-l border-slate-200/60 dark:border-slate-700/40 space-y-1 text-[11px]">
          {/* 参数 */}
          {args && Object.keys(args).length > 0 && (
            <div>
              <div className="text-slate-400 dark:text-slate-500 mb-0.5">参数</div>
              <pre className="text-slate-600 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/30 rounded p-1.5 overflow-auto max-h-28 whitespace-pre-wrap break-all font-mono text-[10px]">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* 成功结果 */}
          {status === 'success' && resultPreview && (
            <div>
              <div className="text-emerald-500/80 mb-0.5">结果</div>
              <pre className="text-slate-600 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/30 rounded p-1.5 overflow-auto max-h-36 whitespace-pre-wrap break-all font-mono text-[10px]">
                {resultPreview}
              </pre>
            </div>
          )}

          {/* 错误信息 */}
          {status === 'error' && (
            <div>
              <div className="text-red-500/80 mb-0.5">错误</div>
              <div className="text-red-600 dark:text-red-400 bg-red-50/60 dark:bg-red-900/10 rounded p-1.5 whitespace-pre-wrap break-all text-[10px]">
                {errorMessage || '未知错误'}
              </div>
              {schemaHint && (
                <div className="mt-1 text-slate-500 dark:text-slate-400 text-[10px]">
                  <span className="text-slate-400">提示: </span>{schemaHint}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
