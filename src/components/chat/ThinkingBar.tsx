"use client";

import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StreamingMarkdown } from './StreamingMarkdown';

interface ThinkingBarProps {
  thinkingContent: string;
  /** 思考时长（秒），由父组件计算并传入 */
  durationSeconds: number;
  /** 是否正在思考（用于显示动画效果） */
  isActive?: boolean;
}

const formatDuration = (seconds: number): string => {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}秒`;
  if (s < 3600) {
    const minutes = Math.floor(s / 60);
    const remainingSeconds = s % 60;
    return `${minutes}分${remainingSeconds}秒`;
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const remainingSeconds = s % 60;
  return `${hours}小时${minutes}分${remainingSeconds}秒`;
};

export const ThinkingBar = ({
  thinkingContent,
  durationSeconds,
  isActive = false,
}: ThinkingBarProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formattedDuration = formatDuration(durationSeconds);

  // 内容由父级按帧推入；这里不再自己跑 rAF 二次节流（那是多余的重复渲染）。
  const hasContent = thinkingContent.trim().length > 0;

  const getLastLine = (text: string): string => {
    if (!text) return '';
    const lastIndex = text.lastIndexOf('\n');
    if (lastIndex === -1) return text;
    return text.substring(lastIndex + 1);
  };

  const displayText = isActive ? getLastLine(thinkingContent) : thinkingContent;

  if (isActive) {
    return (
      <div className="my-1">
        <button
          type="button"
          onClick={() => hasContent && setIsExpanded(!isExpanded)}
          className={cn(
            "inline-flex items-center gap-1.5 max-w-full text-left text-xs text-blue-600/90 dark:text-blue-400/90",
            hasContent && "hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          )}
          aria-expanded={isExpanded}
        >
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          <span>正在思考</span>
          {durationSeconds > 0 && (
            <span className="text-slate-400 dark:text-slate-500 font-mono tabular-nums">{formattedDuration}</span>
          )}
          {hasContent && (
            <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
          )}
        </button>
        {!isExpanded && hasContent && displayText.trim() && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate pl-4">
            {displayText}
            <span className="inline-block w-1 h-3 bg-blue-400/50 ml-0.5 animate-pulse align-middle rounded-sm" />
          </p>
        )}
        {isExpanded && hasContent && (
          <div className="mt-2 pl-4 text-sm border-l border-slate-200/60 dark:border-slate-700/50">
            <div className="markdown-content-area text-slate-600 dark:text-slate-300">
              <StreamingMarkdown content={thinkingContent} sizeOverride="small" isStreaming={isActive} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
        className={cn(
          "inline-flex items-center gap-1 max-w-full text-left text-xs text-slate-400 dark:text-slate-500",
          hasContent && "hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
        )}
        aria-expanded={isExpanded}
        disabled={!hasContent}
      >
        <span>思考了 {formattedDuration}</span>
        {hasContent && (
          <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
        )}
      </button>
      {isExpanded && hasContent && (
        <div className="mt-2 pl-4 text-sm border-l border-slate-200/40 dark:border-slate-700/40">
          <div className="markdown-content-area text-slate-600 dark:text-slate-300">
            <StreamingMarkdown content={thinkingContent} sizeOverride="small" />
          </div>
        </div>
      )}
    </div>
  );
};
