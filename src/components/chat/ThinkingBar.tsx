"use client";

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Timer, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MemoizedMarkdown } from './MemoizedMarkdown';

interface ThinkingBarProps {
  thinkingContent: string;
  /** 思考时长（秒），由父组件计算并传入 */
  durationSeconds: number;
  /** 是否正在思考（用于显示动画效果） */
  isActive?: boolean;
}

/**
 * 格式化时长显示
 * @param seconds 秒数
 */
const formatDuration = (seconds: number): string => {
  const s = Math.floor(seconds);
  if (s < 60) {
    return `${s}秒`;
  } else if (s < 3600) {
    const minutes = Math.floor(s / 60);
    const remainingSeconds = s % 60;
    return `${minutes}分${remainingSeconds}秒`;
  } else {
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const remainingSeconds = s % 60;
    return `${hours}小时${minutes}分${remainingSeconds}秒`;
  }
};

/**
 * ThinkingBar - 纯展示组件
 * 
 * 设计原则：
 * 1. 所有计时逻辑由父组件负责
 * 2. 本组件只负责展示
 * 3. 没有内部定时器，没有复杂状态管理
 * 4. 单向数据流，简单可靠
 */
export const ThinkingBar = ({
  thinkingContent,
  durationSeconds,
  isActive = false,
}: ThinkingBarProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  // 使用 ref 来存储上一次渲染的内容，避免不必要的重渲染
  const [displayedContent, setDisplayedContent] = useState(thinkingContent);
  const lastUpdateTimeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  // 格式化时长
  const formattedDuration = formatDuration(durationSeconds);

  // 实施“平滑流式”渲染策略：
  // 1. 使用 requestAnimationFrame + 节流 (30-50ms) 来更新内容
  // 2. 这样既保证了实时感（比按行更流畅），又避免了 React 在高频 token 下的过载
  useEffect(() => {
    // 如果思考结束，立即显示最终完整内容
    if (!isActive) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setDisplayedContent(thinkingContent);
      return;
    }

    const update = () => {
      const now = Date.now();
      // 50ms 节流 (20fps)，人眼看着流畅，但对渲染性能压力小
      if (now - lastUpdateTimeRef.current > 50) {
        setDisplayedContent(thinkingContent);
        lastUpdateTimeRef.current = now;
      }
      animationFrameRef.current = requestAnimationFrame(update);
    };

    animationFrameRef.current = requestAnimationFrame(update);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [thinkingContent, isActive]);

  // 判断是否有内容
  const hasContent = displayedContent.trim().length > 0;
  
  // 提取最后一行作为预览
  // 优化：只查找最后一个换行符，避免整个 split 的开销
  const getLastLine = (text: string): string => {
    if (!text) return '';
    const lastIndex = text.lastIndexOf('\n');
    if (lastIndex === -1) return text;
    // 如果最后一行是空的（刚换行），显示上一行？不，还是显示空行光标效果比较好
    return text.substring(lastIndex + 1);
  };
  
  const displayText = isActive ? getLastLine(displayedContent) : thinkingContent;

  return (
    <div 
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "rounded-lg border-l-[3px] border transition-all duration-300 cursor-pointer",
        "bg-slate-50/40 dark:bg-slate-800/40 border-slate-300/50 border-r-slate-200/40 border-t-slate-200/40 border-b-slate-200/40",
        "dark:border-l-slate-600/50 dark:border-r-slate-700/40 dark:border-t-slate-700/40 dark:border-b-slate-700/40",
        "hover:bg-slate-50/60 dark:hover:bg-slate-800/60"
      )}
    >
      <div className="p-3.5">
        {/* 状态指示行 */}
        <div className="w-full flex items-center gap-2.5 group">
          {/* 旋转加载图标（思考中）或静态圆点（完成） */}
          <div className="relative flex items-center justify-center flex-shrink-0">
            {isActive ? (
              <>
                {/* 外圈光环效果 */}
                <div className="absolute w-5 h-5 rounded-full bg-blue-400/20 dark:bg-blue-400/10 animate-ping" />
                {/* 旋转图标 */}
                <Loader2 className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 relative z-10" 
                  style={{ animation: 'spin 1s linear infinite' }} />
              </>
            ) : (
              <div className="w-2 h-2 rounded-full bg-slate-400/70 flex-shrink-0" />
            )}
          </div>
          
          <span className={cn(
            "text-xs font-medium flex-shrink-0",
            isActive 
              ? "text-blue-600 dark:text-blue-400" 
              : "text-slate-500 dark:text-slate-400"
          )}>
            {isActive ? '正在思考' : '思考完成'}
          </span>

          {/* 时长显示 */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
            <Timer className="w-3 h-3" />
            <span className="font-mono tabular-nums">{formattedDuration}</span>
          </div>
          
          {/* 展开/收起图标 */}
          {hasContent && (
            <ChevronRight className={cn(
              "w-3.5 h-3.5 transition-transform text-slate-400 dark:text-slate-500 flex-shrink-0 ml-auto",
              isExpanded && "rotate-90"
            )} />
          )}
        </div>
        
        {/* 思考内容预览（思考中显示最新一行，完成后收起） */}
        <div 
          className={cn(
            "overflow-hidden transition-all duration-500 ease-in-out",
            isActive && !isExpanded && hasContent 
              ? "mt-3 max-h-20 opacity-100" // 增加 max-h 以容纳可能的换行
              : "mt-0 max-h-0 opacity-0"
          )}
        >
          <div className="text-sm text-slate-600/80 dark:text-slate-300/70 truncate pr-1 flex items-center">
            {/* 使用 span 包裹内容，避免重排 */}
            <span className="truncate">{displayText}</span>
            {isActive && (
              <span className="inline-block w-1.5 h-4 bg-blue-400/60 dark:bg-blue-500/60 ml-1 animate-pulse align-middle rounded-sm" />
            )}
          </div>
        </div>
      </div>

      {/* 完整思考内容（展开时） */}
      {isExpanded && hasContent && (
        <div className="px-3.5 pb-3.5 text-sm border-t border-slate-200/50 dark:border-slate-700/50 pt-3 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <div className="markdown-content-area text-slate-700 dark:text-slate-300">
            <MemoizedMarkdown content={displayedContent} sizeOverride='small' />
          </div>
        </div>
      )}
    </div>
  );
};
