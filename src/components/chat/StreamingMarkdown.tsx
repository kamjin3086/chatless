"use client";

import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import { Streamdown } from 'streamdown';
import { useMarkdownFontSize } from '@/hooks/useMarkdownFontSize';
import { createMarkdownRenderers } from '@/lib/markdown/renderers';
import { preprocessMarkdownForSafeRender } from './markdownPreprocess';
import { streamdownRemarkPlugins } from '@/lib/markdown/remarkPlugins';
import { replaceAliasPathsForDisplayWithContext } from '@/lib/filesystemAllowlist/displayPathAliases';

interface StreamingMarkdownProps {
  content: string;
  isStreaming: boolean;
  className?: string;
  /** 将 @WorkDir/@Alias 路径展示为绝对路径（用于 assistant 最终总结降低歧义） */
  resolvePathAliases?: boolean;
  /** 可选：用于解析 @WorkDir 的会话上下文 */
  contextMessageId?: string;
  contextConversationId?: string;
}

/**
 * 高性能流式内容缓冲器 v2
 * 
 * 设计优化：
 * 1. **更低的基础延迟**：16ms 对齐显示器刷新率（60fps）
 * 2. **增量感知**：根据增量大小动态调整更新策略
 * 3. **平滑节流曲线**：使用对数函数而非线性函数
 * 4. **即时首帧**：第一个 token 立即显示，消除初始延迟
 */
class StreamingContentBuffer {
  private content = '';
  private displayContent = '';
  private listeners = new Set<() => void>();
  private rafId: number | null = null;
  private lastUpdateTime = 0;
  private isStreaming = false;
  private hasFirstToken = false;
  
  // 优化后的节流参数
  private static readonly MIN_INTERVAL_MS = 16;    // 对齐 60fps 显示器
  private static readonly BASE_INTERVAL_MS = 32;   // ~30fps 基础帧率
  private static readonly MAX_INTERVAL_MS = 100;   // 最大 10fps（短内容时仍保持流畅）
  
  // 长内容阈值（超过此长度开始降低帧率）
  private static readonly LONG_CONTENT_THRESHOLD = 2000;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.displayContent;

  private notify() {
    this.listeners.forEach(l => l());
  }

  /**
   * 计算动态节流间隔
   * 使用对数曲线实现平滑过渡
   */
  private getThrottleInterval(): number {
    const len = this.content.length;
    
    // 短内容：保持高帧率
    if (len < StreamingContentBuffer.LONG_CONTENT_THRESHOLD) {
      return StreamingContentBuffer.BASE_INTERVAL_MS;
    }
    
    // 长内容：使用对数曲线平滑增加间隔
    // log2(2000) ≈ 11, log2(10000) ≈ 13
    const logFactor = Math.log2(len / StreamingContentBuffer.LONG_CONTENT_THRESHOLD + 1);
    const interval = StreamingContentBuffer.BASE_INTERVAL_MS + (logFactor * 15);
    
    return Math.min(StreamingContentBuffer.MAX_INTERVAL_MS, interval);
  }

  private scheduleUpdate() {
    if (this.rafId !== null) return;
    
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const now = performance.now();
      const interval = this.getThrottleInterval();
      
      if (now - this.lastUpdateTime >= interval || !this.isStreaming) {
        if (this.displayContent !== this.content) {
          this.displayContent = this.content;
          this.lastUpdateTime = now;
          this.notify();
        }
      } else {
        // 还没到时间，继续等待
        this.scheduleUpdate();
      }
    });
  }

  update(content: string, isStreaming: boolean) {
    const contentChanged = this.content !== content;
    const streamingChanged = this.isStreaming !== isStreaming;
    
    this.content = content;
    this.isStreaming = isStreaming;
    
    if (!contentChanged && !streamingChanged) return;
    
    // 🔑 首个 token 立即显示（消除初始延迟）
    if (isStreaming && !this.hasFirstToken && content.length > 0) {
      this.hasFirstToken = true;
      this.displayContent = content;
      this.lastUpdateTime = performance.now();
      this.notify();
      return;
    }
    
    // 非流式模式或内容变短（清空）：立即更新
    if (!isStreaming || content.length < this.displayContent.length) {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.displayContent = content;
      this.lastUpdateTime = performance.now();
      this.hasFirstToken = content.length > 0;
      this.notify();
      return;
    }
    
    // 流式模式：使用 RAF 节流
    this.scheduleUpdate();
  }

  cleanup() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.hasFirstToken = false;
  }
}

/**
 * 流式Markdown渲染组件
 * 
 * 架构优化：
 * 1. 使用 useSyncExternalStore 实现高性能订阅
 * 2. 使用 RAF 对齐浏览器渲染周期，避免不必要的重绘
 * 3. 动态节流：根据内容长度自适应调整更新频率
 * 4. 组件级缓冲：每个实例独立管理自己的缓冲区
 */
export const StreamingMarkdown = React.memo(function StreamingMarkdown({ 
  content, 
  isStreaming, 
  className,
  resolvePathAliases,
  contextMessageId,
  contextConversationId
}: StreamingMarkdownProps) {
  const { size } = useMarkdownFontSize();
  
  // 静态主题配置
  const themeStyles = useMemo(() => ({ 
    headings: { h1: '', h2: '', h3: '', h4: '', h5: '', h6: '' }, 
    paragraph: '', 
    list: { ul: '', ol: '', li: '' }, 
    blockquote: '', 
    code: { inline: '', block: '' }, 
    link: '', 
    hr: '', 
    table: { table: '', th: '', td: '' }, 
    strong: '' 
  }), []);
  
  const { renderers, containerClass } = useMemo(
    () => createMarkdownRenderers(size, themeStyles), 
    [size, themeStyles]
  );

  // 使用 ref 持久化缓冲器实例
  const bufferRef = useRef<StreamingContentBuffer | null>(null);
  if (!bufferRef.current) {
    bufferRef.current = new StreamingContentBuffer();
  }
  const buffer = bufferRef.current;

  // 使用 useSyncExternalStore 订阅显示内容
  const displayContent = useSyncExternalStore(
    buffer.subscribe,
    buffer.getSnapshot,
    buffer.getSnapshot // SSR fallback
  );

  // 在 useEffect 中更新缓冲器状态，避免在渲染阶段触发状态更新
  // 使用 useLayoutEffect 确保在浏览器绘制前更新
  React.useLayoutEffect(() => {
    buffer.update(content, isStreaming);
  }, [buffer, content, isStreaming]);

  // 清理
  React.useEffect(() => {
    return () => buffer.cleanup();
  }, [buffer]);

  // Memoize 预处理（只在 displayContent 变化时计算）
  const displayWithResolvedPaths = useMemo(
    () =>
      resolvePathAliases
        ? replaceAliasPathsForDisplayWithContext({
            markdown: displayContent,
            messageId: contextMessageId,
            conversationId: contextConversationId,
          })
        : displayContent,
    [displayContent, resolvePathAliases, contextMessageId, contextConversationId]
  );
  const safe = useMemo(
    () => preprocessMarkdownForSafeRender(displayWithResolvedPaths, { wrapFullHtmlDocument: true }),
    [displayWithResolvedPaths]
  );

  return (
    <div className={`${containerClass} ${className || ''}`}>
      <Streamdown
        isAnimating={isStreaming}
        components={renderers}
        controls={true}
        remarkPlugins={streamdownRemarkPlugins}
      >
        {safe}
      </Streamdown>
    </div>
  );
});

