"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { Check, X, Globe, Loader2, ChevronRight } from 'lucide-react';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { useConversationAccessStore } from '@/store/conversationAccessStore';
import { useChatStore } from '@/store/chatStore';
import { toast } from '@/components/ui/sonner';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import { formatToolDuration, presentToolCard, previewResult } from './toolCardPresentation';

type ToolCallStatus = 'success' | 'error' | 'running' | 'pending_auth' | 'stopped';

const STATUS_LABELS: Record<ToolCallStatus, TranslationKey> = {
  running: 'toolCall.status.running',
  pending_auth: 'toolCall.status.pendingApproval',
  success: 'toolCall.status.success',
  error: 'toolCall.status.error',
  stopped: 'toolCall.status.stopped',
};

// Keep the stored rejection unchanged; only the card's display is localized.
const USER_REJECTED_MESSAGE = '用户拒绝';

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
  /** Seconds the call took, when a result came back. Absent rows render as they always did. */
  duration?: number;
}

export function ToolCallCard({ server, tool, status, args, resultPreview, errorMessage, schemaHint, messageId, cardId, duration }: ToolCallCardProps) {
  const locale = useLocaleStore((state) => state.locale);
  const t = React.useCallback((key: TranslationKey) => translate(locale, key), [locale]);
  const presentation = React.useMemo(() => presentToolCard(locale, { server, tool, args }), [locale, server, tool, args]);
  const durationLabel = formatToolDuration(locale, duration);
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
  const directoryScope = filesystemScope?.op !== 'delete' ? filesystemScope?.directory : undefined;
  const knowledgeRead = approvalScope?.toolKey === 'knowledge:read';
  const sessionLabel = shellScope ? t('toolCallApproval.conversationShell')
    : filesystemScope ? t(filesystemScope.op === 'delete' ? 'toolCallApproval.conversationDelete' : 'toolCallApproval.conversationDirectory')
    : approvalScope?.automaticEligible ? t(knowledgeRead ? 'toolCallApproval.conversationKnowledgeRead' : 'toolCallApproval.conversationTool')
    : undefined;
  const sessionHint = shellScope ? t('toolCallApproval.conversationShellHint')
    : filesystemScope ? t(filesystemScope.op === 'delete' ? 'toolCallApproval.conversationDeleteHint' : 'toolCallApproval.conversationDirectoryHint')
    : t('toolCallApproval.conversationToolHint').replace('{tool}', () => knowledgeRead
      ? t('toolCallApproval.knowledgeReadTarget')
      : approvalScope?.label || t('toolCallApproval.thisTool'));

  const rememberHint =
    isPendingAuth
      && String(server || '').toLowerCase() === 'shell_executor'
      && typeof (args as any)?.workingDir === 'string'
      && String((args as any).workingDir).trim()
      ? t('toolCallApproval.rememberWorkingDirectory')
      : undefined;
  const path = filesystemScope?.path;
  const onceHint = rememberHint || (path
    ? t('toolCallApproval.oncePathHint').replace('{path}', () => path)
    : t('toolCallApproval.onceHint'));
  const alwaysHint = shellScope
    ? t('toolCallApproval.alwaysShellHint')
    : directoryScope && t('toolCallApproval.alwaysDirectoryHint').replace('{directory}', () => directoryScope);
  
  const handleApprove = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;
    const ok = approveAuthorization(authKey);
    if (!ok) {
      toast.info(t('toolCallApproval.expired'), { description: t('toolCallApproval.checkPermissionsAgain') });
    }
  }, [authKey, messageId, cardId, approveAuthorization, t]);

  const handleApproveWith = React.useCallback((decision: 'always' | 'unrestricted') => {
    if (!authKey || !messageId || !cardId) return;
    const ok = approveAuthorization(authKey, decision);
    if (!ok) {
      toast.info(t('toolCallApproval.expired'), { description: t('toolCallApproval.checkPermissionsAgain') });
      return;
    }
    if (decision === 'always') {
      toast.success(t(shellScope ? 'toolCallApproval.shellAllowed' : 'toolCallApproval.directoryAllowed'));
      return;
    }
    // Turning prompts off must be as easy to undo as it was to enable.
    const conversationId = pendingAuth?.conversationId;
    toast.info(t('toolCallApproval.conversationGrantPending'), {
      action: conversationId
        ? {
            label: t('toolCallApproval.revokeConversationGrant'),
            onClick: () => {
              useConversationAccessStore.getState().revoke(conversationId);
              const currentLocale = useLocaleStore.getState().locale;
              toast.info(translate(currentLocale, 'toolCallApproval.conversationGrantRevoked'));
            },
          }
        : undefined,
    });
  }, [authKey, messageId, cardId, approveAuthorization, pendingAuth?.conversationId, shellScope, t]);
  
  const handleReject = React.useCallback(() => {
    if (!authKey || !messageId || !cardId) return;
    try {
      useChatStore.getState().dispatchMessageAction(messageId, {
        type: 'TOOL_RESULT',
        server,
        tool,
        ok: false,
        errorMessage: USER_REJECTED_MESSAGE,
        cardId,
      } as any);
    } catch { /* ignore */ }

    const ok = rejectAuthorization(authKey);
    if (!ok) {
      toast.info(t('toolCallApproval.rejected'));
    }
  }, [authKey, messageId, cardId, server, tool, rejectAuthorization, t]);

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

  const statusLabel = t(STATUS_LABELS[status === 'running' ? status : isPendingAuth ? 'pending_auth' : status]);

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
  const displayedError = errorMessage === USER_REJECTED_MESSAGE ? t('toolCall.userRejected') : errorMessage;

  return (
    <div className="text-xs">
      {/* 预览行：可点击展开 */}
      <div 
        className={cn(
          // 允许换行：审批按钮在窄窗口下会掉到下一行右侧，而不是把整行撑出消息列
          // （撑出去的部分此前会被右下角的悬浮控件压住）。
          "flex flex-wrap items-center gap-x-1.5 gap-y-1 py-0.5 rounded-md transition-colors",
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
        <span className={cn("shrink-0", statusColor)} role="img" title={statusLabel} aria-label={statusLabel}>
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
              <span className="text-slate-500 dark:text-slate-400 truncate" title={presentation.detailLineFull}>
                {presentation.detailLineShort || presentation.detailLineFull}
              </span>
            </>
          )}
          
          {durationLabel && (
            <span
              className="shrink-0 text-slate-400 dark:text-slate-500 tabular-nums"
              title={t('toolCall.elapsed').replace('{duration}', durationLabel)}
            >
              · {durationLabel}
            </span>
          )}

          {/* 错误简要提示 */}
          {status === 'error' && !expanded && (
            <span className="text-red-500 truncate ml-1">
              {displayedError && displayedError.length > 30 ? displayedError.slice(0, 30) + '…' : displayedError}
            </span>
          )}
        </div>

        {/* 审批按钮 */}
        {isPendingAuth && (
          <div
            className="shrink-0 ml-auto flex flex-wrap items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-approval-choice="once"
              data-approval-run={messageId}
              onClick={handleApprove}
              className="px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              title={onceHint}
            >
              {t('toolCallApproval.once')}
            </button>
            {sessionLabel && (
              <button
                type="button"
                data-approval-choice="conversation"
                data-approval-run={messageId}
                onClick={() => handleApproveWith('unrestricted')}
                className="px-2 py-0.5 text-[10px] border border-blue-500/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md transition-colors"
                title={t('toolCallApproval.conversationRevocable').replace('{scope}', () => sessionHint)}
              >
                {sessionLabel}
              </button>
            )}
            {(shellScope || directoryScope) && (
              <button
                type="button"
                onClick={() => handleApproveWith('always')}
                className="px-2 py-0.5 text-[10px] border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                title={alwaysHint}
              >
                {t(shellScope ? 'toolCallApproval.alwaysShell' : 'toolCallApproval.alwaysDirectory')}
              </button>
            )}
            <button
              onClick={handleReject}
              className="px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
            >
              {t(approvalScope ? 'toolCallApproval.reject' : 'common.cancel')}
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
              <div className="text-slate-400 dark:text-slate-500 mb-0.5">{t('toolCall.arguments')}</div>
              <pre className="text-slate-600 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/30 rounded-md p-1.5 overflow-auto max-h-28 whitespace-pre-wrap break-all font-mono text-[10px]">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}

          {/* 成功结果 */}
          {status === 'success' && resultPreview && (
            <div>
              <div className="text-emerald-500/80 mb-0.5">{t('toolCall.result')}</div>
              <pre className="text-slate-600 dark:text-slate-300 bg-slate-50/80 dark:bg-slate-800/30 rounded-md p-1.5 overflow-auto max-h-36 whitespace-pre-wrap break-all font-mono text-[10px]">
                {previewResult(locale, resultPreview)}
              </pre>
            </div>
          )}

          {/* 错误信息 */}
          {status === 'error' && (
            <div>
              {resultUnknown && (
                <div className="text-amber-600 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-900/20 rounded-md p-1.5 mb-1 text-[10px]">
                  {t('toolCall.resultUnknown')}
                </div>
              )}
              <div className="text-red-500/80 mb-0.5">{t('toolCall.error')}</div>
              <div className="text-red-600 dark:text-red-400 bg-red-50/60 dark:bg-red-900/10 rounded-md p-1.5 whitespace-pre-wrap break-all text-[10px]">
                {displayedError || t('toolCall.unknownError')}
              </div>
              {schemaHint && (
                <div className="mt-1 text-slate-500 dark:text-slate-400 text-[10px]">
                  <span className="text-slate-400">{t('toolCall.hint')}{' '}</span>{schemaHint}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
