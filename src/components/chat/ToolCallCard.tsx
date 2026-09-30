"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { Check, X, Globe, Loader2, ChevronRight } from 'lucide-react';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/components/ui/sonner';
import { presentToolCard } from './toolCardPresentation';

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
  // Filesystem approvals can cover a whole folder, so the card offers the
  // time range of the grant instead of a bare yes/no.
  const pendingAuth = useAuthorizationStore((state) =>
    authKey ? state.pendingAuthorizations.get(authKey) : undefined);
  const approvalScope = pendingAuth?.scope;
  const filesystemScope = approvalScope?.kind === 'filesystem' ? approvalScope : undefined;
  const shellScope = approvalScope?.kind === 'shell' ? approvalScope : undefined;
  const directoryScope = filesystemScope && filesystemScope.op !== 'delete'
    ? filesystemScope
    : undefined;

  const rememberHint =
    isPendingAuth
      && String(server || '').toLowerCase() === 'shell_executor'
      && typeof (args as any)?.workingDir === 'string'
      && String((args as any).workingDir).trim()
      ? '确认后会记住该目录'
      : undefined;
  
  const handleApprove = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;
    const ok = approveAuthorization(authKey);
    if (!ok) {
      toast.info('审批已失效', { description: '请点击“继续”重新检查权限。' });
    }
  }, [authKey, messageId, cardId, approveAuthorization]);

  const handleApproveWith = React.useCallback((decision: 'always' | 'unrestricted') => {
    if (!authKey || !messageId || !cardId) return;
    const ok = approveAuthorization(authKey, decision);
    if (!ok) {
      toast.info('审批已失效', { description: '请点击“继续”重新检查权限。' });
      return;
    }
    if (decision === 'always') {
      toast.success(shellScope ? '以后所有命令都不再询问' : '该文件夹已加入白名单，读写不再询问');
      return;
    }
    // Turning prompts off must be as easy to undo as it was to enable.
    const conversationId = pendingAuth?.conversationId;
    toast.success('本会话内文件操作不再询问', {
      action: conversationId
        ? {
            label: '恢复询问',
            onClick: () => {
              void import('@/lib/mcp/accessPolicy')
                .then(({ setConversationAccess }) => {
                  setConversationAccess(shellScope ? 'shell' : 'fs', conversationId, 'ask');
                  toast.info(shellScope ? '已恢复命令询问' : '已恢复文件操作询问');
                })
                .catch(() => {});
            },
          }
        : undefined,
    });
  }, [authKey, messageId, cardId, approveAuthorization, pendingAuth?.conversationId, shellScope]);
  
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
  const resultUnknown = String(errorMessage || '').includes('EXECUTION_UNKNOWN');

  return (
    <div className="text-xs">
      {/* 预览行：可点击展开 */}
      <div 
        className={cn(
          // 允许换行：审批按钮在窄窗口下会掉到下一行右侧，而不是把整行撑出消息列
          // （撑出去的部分此前会被右下角的悬浮控件压住）。
          "flex flex-wrap items-center gap-x-1.5 gap-y-1 py-0.5 rounded transition-colors",
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
        <div className="flex-1 min-w-[8rem] flex items-center gap-1 truncate">
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
          <div
            className="shrink-0 ml-auto flex flex-wrap items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {shellScope ? (
              <>
                <button
                  onClick={handleApprove}
                  className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                  title={`只运行这一次：${shellScope.command || ''}`}
                >
                  仅本次
                </button>
                <button
                  onClick={() => handleApproveWith('unrestricted')}
                  className="px-2 py-0.5 text-[10px] border border-amber-400/70 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                  title="本会话内所有命令都不再询问，可在设置里改回"
                >
                  本会话不再询问
                </button>
                <button
                  onClick={() => handleApproveWith('always')}
                  className="px-2 py-0.5 text-[10px] border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                  title="以后所有命令都不再询问，可在设置里改回"
                >
                  始终不再询问
                </button>
              </>
            ) : filesystemScope ? (
              <>
                <button
                  onClick={handleApprove}
                  className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                  title={`只允许这一次：${filesystemScope.path}`}
                >
                  仅本次
                </button>
                {directoryScope && (
                  <button
                    onClick={() => handleApproveWith('always')}
                    className="px-2 py-0.5 text-[10px] border border-blue-500/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded transition-colors"
                    title={`把该文件夹加入白名单，长期允许读写（删除仍需确认）：${directoryScope.directory}`}
                  >
                    以后都允许
                  </button>
                )}
                <button
                  onClick={() => handleApproveWith('unrestricted')}
                  className="px-2 py-0.5 text-[10px] border border-amber-400/70 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                  title="本会话内所有文件操作（含删除）都不再询问，可在设置里改回"
                >
                  本会话不再询问
                </button>
              </>
            ) : (
              <button
                onClick={handleApprove}
                className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                title={rememberHint || '确认'}
              >
                确认
              </button>
            )}
            <button
              onClick={handleReject}
              className="px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            >
              {approvalScope ? '拒绝' : '取消'}
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
              {resultUnknown && (
                <div className="text-amber-600 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-900/20 rounded p-1.5 mb-1 text-[10px]">
                  执行结果未知。系统不会自动重试，请通过“继续”重新核对后再决定。
                </div>
              )}
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
