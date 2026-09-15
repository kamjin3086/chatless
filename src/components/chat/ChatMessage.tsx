"use client";

import React, { useMemo, useEffect, useState } from 'react';
import { Copy, Star, RefreshCcw, Check, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { cn } from "@/lib/utils";
import { ContextMenu, createMessageMenuItems } from '@/components/ui/context-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useChatStore } from '@/store/chatStore';
import { UserMessageBlock } from './UserMessageBlock';
import { AIMessageBlock } from './AIMessageBlock';
import type { Message } from '@/types/chat';
import { motion } from 'framer-motion';

// Toggle for verbose internal logging. Set to true when debugging ChatMessage rendering.
const DEBUG_CHAT_MESSAGE = false;

interface ChatMessageProps {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: string;
  model?: string;
  onEdit?: (id: string) => void;
  onCopy?: (content: string) => void;
  onStar?: (id: string) => void;
  onRetry?: () => void;
  status: 'pending' | 'sending' | 'sent' | 'error' | 'loading' | 'aborted';
  thinking_duration?: number;
  thinking_start_time?: number; // 思考开始时间戳（毫秒）
  onSaveThinkingDuration?: (messageId: string, duration: number) => void;
  
  // 新增的文档引用props
  documentReference?: {
    fileName: string;
    fileType: string;
    fileSize: number;
    summary: string;
  };
  contextData?: string;
  
  // 知识库引用props
  knowledgeBaseReference?: {
    id: string;
    name: string;
  };
  citations?: Message['citations'];
  images?: string[];
  segments?: Message['segments'];
  viewModel?: Message['segments_vm'];
  version_group_id?: string;
  version_index?: number;
  /** 可选：外部注入的版本切换控制（用于版本组首条顶部展示） */
  versionControls?: { current: number; total: number; onPrev: () => void; onNext: () => void } | null;
}

const formatTimestamp = (timestamp: string | undefined): string => {
  if (!timestamp) return '';
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const isSameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday = d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate();
    const two = (n: number) => (n < 10 ? `0${n}` : String(n));
    const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
    if (isSameDay) return hm; // 当天只显示时间
    if (isYesterday) return `${hm} 昨日`;
    const md = `${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    const y = d.getFullYear();
    const sameYear = y === now.getFullYear();
    return sameYear ? `${hm} ${md}` : `${hm} ${y}-${md}`; // 日期显示在时间后面
  } catch {
    return '';
  }
};

function ChatMessageComponent({
  id,
  content,
  role,
  timestamp,
  model,
  onEdit,
  onCopy,
  onStar,
  onRetry,
  status,
  thinking_duration,
  thinking_start_time,
  onSaveThinkingDuration,
  
  // 新增的文档引用props
  documentReference,
  contextData,
  
  // 知识库引用props
  knowledgeBaseReference,
  citations,
  images,
  segments,
  viewModel,
  version_index: _version_index,
  versionControls = null,
}: ChatMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteMessage = useChatStore((s)=> s.deleteMessage);
  
  // 🔑 检测当前消息是否处于 AgentLoop 运行状态
  const isAgentLoopRunning = useChatStore((s) => {
    const runs = s.agentRuns || {};
    const run = runs[id];
    return run?.running === true;
  });
  
  // 🔑 修复界面跳动：追踪消息是否已完成过首次入场动画
  // 一旦消息已经"入场"过（有过内容），后续的追问流程不应再触发入场动画
  const hasEnteredRef = React.useRef(false);

  if (DEBUG_CHAT_MESSAGE) { /* noop */ }
  
  // 在组件挂载和更新时记录props变化
  useEffect(() => {
    if (DEBUG_CHAT_MESSAGE) { /* noop */ }
  }, [id, documentReference?.fileName, contextData, knowledgeBaseReference?.id, status, images?.length]);
  

  const isUser = role === "user";
  const isStreaming = status === 'loading';
  const isError = status === 'error';
  // 生成期间不显示时间与模型，避免视觉抖动；完成后再显示
  const formattedTime = isStreaming ? '' : formatTimestamp(timestamp);

  // 🔑 修复：检测消息是否已经有实质内容（segments 或 content）
  // 如果已有内容，则标记为"已入场"，避免追问时重复触发入场动画
  const hasContent = (Array.isArray(segments) && segments.length > 0) || (content && content.length > 0);
  if (hasContent && !hasEnteredRef.current) {
    hasEnteredRef.current = true;
  }
  
  // 🔑 修复界面抖动：检测是否有正在运行的工具调用
  // 如果有工具卡片且状态为 'running'，则认为消息尚未完成，不应显示时间戳
  const hasRunningToolCall = React.useMemo(() => {
    if (!Array.isArray(segments)) return false;
    return segments.some((seg: any) => 
      seg && seg.kind === 'toolCard' && seg.status === 'running'
    );
  }, [segments]);
  
  const isSettled = !isStreaming && status !== 'sending' && status !== 'pending';
  const shouldShowTimestamp = isSettled && !hasRunningToolCall && !isAgentLoopRunning;
  
  // 🔑 决定是否显示 AgentLoop 运行指示器
  // 条件：AI消息 + AgentLoop 正在运行 + 当前没有活跃的工具卡片正在运行
  const shouldShowAgentLoopIndicator = !isUser && isAgentLoopRunning && !hasRunningToolCall;
  
  // 仅对"正在生成/刚发送"的消息开启入场动画；历史消息不做入场动画，避免切换会话时整列表闪烁
  // 🔑 修复：如果消息已经入场过，不再触发入场动画
  const shouldAnimateEnter = !hasEnteredRef.current && (isStreaming || status === 'sending' || status === 'pending');

  const messageContent = useMemo(() => {
    if (DEBUG_CHAT_MESSAGE) { /* noop */ }
    return isUser 
      ? <UserMessageBlock 
          id={id}
          content={content}
          documentReference={documentReference}
          contextData={contextData}
          knowledgeBaseReference={knowledgeBaseReference}
          images={images}
          onEdit={onEdit}
          onCopy={onCopy}
          onDelete={() => setConfirmOpen(true)}
        /> 
      : <AIMessageBlock 
          content={content}
          isStreaming={isStreaming}
          thinkingDuration={thinking_duration}
          thinking_start_time={thinking_start_time}
          id={id}
          // 关键：把上层透传的 segments 优先交给 AIMessageBlock 做段驱动渲染（包含 think 段）
          segments={Array.isArray(segments) ? (segments as any) : undefined}
          citations={citations}
          viewModel={viewModel as any}
          onStreamingComplete={(duration) => {
            if (onSaveThinkingDuration) {
              onSaveThinkingDuration(id, duration);
            }
          }}
        />;
  }, [isUser, id, content, documentReference?.fileName, contextData, knowledgeBaseReference?.id, citations, images?.length, onEdit, onCopy, isStreaming, thinking_duration, thinking_start_time, onSaveThinkingDuration, segments, viewModel]);

  // ⚠️ 【Fallback机制】：优先使用 segments，仅在 segments 为空时使用 content
  // 
  // 设计原则：
  // 1. segments 是真实渲染内容的来源（由FSM驱动）
  // 2. content 作为fallback，兼容旧数据或异常情况
  // 
  // 注意：
  // - 正常情况下应该总是有 segments
  // - 如果频繁触发 content fallback，说明 segments 生成有问题
  // - content 可能包含工具调用指令，不应直接用于UI显示
  const copyVisibleText = useMemo(() => {
    try {
      if (Array.isArray(segments) && segments.length > 0) {
        const text = segments
          .filter((s: any) => s && s.kind === 'text' && typeof s.text === 'string')
          .map((s: any) => s.text)
          .join('');
        if (text && text.trim().length > 0) return text;
      }
    } catch { /* noop */ }
    // Fallback：仅在 segments 为空或出错时使用
    return content || '';
  }, [segments, content]);

  const handleCopy = async (contentToCopy: string) => {
    try {
      if (onCopy) {
        onCopy(contentToCopy);
      } else {
        await navigator.clipboard.writeText(contentToCopy);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  return (
    <div
      className={cn(
        "flex chat-transition group mt-2 mb-2 relative w-full focus-within:outline-none",
        isUser
          ? "flex-row-reverse justify-start max-w-[min(85%,42rem)] ml-auto"
          : "max-w-[min(100%,48rem)]"
      )}
      tabIndex={-1}
    >
      {/* 头像隐藏 */}
      {/* <div className="w-8 shrink-0"></div> */}
 
      {/* 消息内容 */}
      <div className={cn(
        "flex flex-col min-w-0 max-w-full",
        !isUser && "flex-1",
        isUser ? "items-end" : "items-start"
      )}>
        <ContextMenu
          menuItems={createMessageMenuItems(
            id,
            content,
            !isUser,
            onCopy || ((c) => { void c; }),
            isUser ? onEdit : undefined,
            !isUser ? onRetry : undefined,
            onStar,
            () => setConfirmOpen(true)
          )}
        >
          <motion.div
            initial={shouldAnimateEnter ? { opacity: 0, scale: 0.98 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.15
            }}
          >
            <div className={cn(
              isUser ? "max-w-full min-w-0" : "w-full max-w-full min-w-0",
              isUser
                ? "px-2.5 py-1.5 text-[14px] leading-[1.4] rounded-lg bg-blue-50/60 dark:bg-slate-800/40"
                : cn(
                    "px-2 py-1.5 rounded-lg",
                    isError && "border border-red-200/80 dark:border-red-800/60 bg-red-50/40 dark:bg-red-950/20"
                  )
            )}>
              {isError && !isUser && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mb-2 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>生成失败</span>
                </div>
              )}
              {messageContent}
            </div>
          </motion.div>
        </ContextMenu>

        {/* 删除确认对话框 */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除这条消息？</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  此操作不可撤销，将永久从会话中移除该条消息。
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmOpen(false); try { void deleteMessage(id); } catch { /* noop */ } }}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
 
        {/* AgentLoop 运行指示器：当 loop 运行中且没有工具卡片运行时显示 */}
        {shouldShowAgentLoopIndicator && (
          <div className="flex items-center gap-1.5 text-[11px] text-blue-500 dark:text-blue-400 ml-1 mt-1.5 self-start">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="animate-pulse">处理中...</span>
          </div>
        )}

        {/* 错误态常驻重试入口 */}
        {!isUser && isError && onRetry && !shouldShowTimestamp && (
          <div className="flex items-center gap-2 ml-1 mt-1.5 self-start">
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              aria-label="重试生成"
            >
              <RefreshCcw className="w-3 h-3" />
              重试
            </button>
          </div>
        )}

        {/* 元数据与操作：默认隐身，hover / 焦点时出现一次 */}
        {shouldShowTimestamp && (formattedTime || (!isUser && model)) && (
          <div className={cn(
            "flex items-center justify-between flex-nowrap text-[11px] text-slate-400 dark:text-slate-500 ml-1 mt-1",
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150",
            isError && "opacity-100",
            isUser ? "self-end" : "self-start w-full"
          )}>
            <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap overflow-hidden">
              {!isUser && model && (
                <span className="truncate max-w-[40vw]">{model}</span>
              )}
              {!isUser && model && formattedTime && (
                <span className="text-slate-300 dark:text-slate-600">·</span>
              )}
              <span className="shrink-0">{formattedTime}</span>
            </div>
            {!isUser && (
              <div className="flex items-center gap-0.5 whitespace-nowrap">
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className={cn(
                      "p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
                      isError
                        ? "text-red-500 hover:text-red-600 dark:text-red-400"
                        : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    )}
                    title="重试"
                    aria-label="重试生成"
                  >
                    <RefreshCcw className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => handleCopy(copyVisibleText)}
                  className={cn(
                    "p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
                    isCopied
                      ? "text-emerald-500"
                      : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  )}
                  title={isCopied ? "已复制" : "复制"}
                  aria-label={isCopied ? "已复制" : "复制消息"}
                >
                  {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => setConfirmOpen(true)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  title="删除"
                  aria-label="删除消息"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {onStar && (
                  <button
                    onClick={() => onStar(id)}
                    className="p-1 text-slate-400 hover:text-amber-500 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    title="收藏"
                    aria-label="收藏消息"
                  >
                    <Star className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 底部版本切换器（仅AI消息 + 有版本时显示） */}
        {!isUser && versionControls && versionControls.total > 1 && (
          <div className="flex items-center justify-center mt-3 mb-1">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-400 select-none">
              <button
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-full transition-all",
                  versionControls.current <= 1
                    ? "opacity-30 pointer-events-none"
                    : "hover:bg-slate-200/60 dark:hover:bg-slate-700/60 active:scale-95"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  versionControls.onPrev();
                }}
                title="上一版本"
                aria-label="上一版本"
              >
                ‹
              </button>
              <span className="font-medium tabular-nums">
                {versionControls.current} / {versionControls.total}
              </span>
              <button
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-full transition-all",
                  versionControls.current >= versionControls.total
                    ? "opacity-30 pointer-events-none"
                    : "hover:bg-slate-200/60 dark:hover:bg-slate-700/60 active:scale-95"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  versionControls.onNext();
                }}
                title="下一版本"
                aria-label="下一版本"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatMessage = React.memo(
  ChatMessageComponent,
  (prev: ChatMessageProps, next: ChatMessageProps) => {
    // 仅在关键属性变化时才重渲染
    return (
      prev.id === next.id &&
      prev.role === next.role &&
      prev.status === next.status &&
      prev.content === next.content &&
      prev.model === next.model &&
      prev.timestamp === next.timestamp &&
      prev.thinking_duration === next.thinking_duration &&
      prev.thinking_start_time === next.thinking_start_time &&
      (prev.images?.length || 0) === (next.images?.length || 0) &&
      // 结构化段的引用地址不变时视作不变（上层保证不可变更新）
      prev.segments === next.segments &&
      prev.viewModel === next.viewModel
    );
  }
); 