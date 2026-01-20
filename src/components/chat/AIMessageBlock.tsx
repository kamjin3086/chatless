"use client";

import { useEffect, useRef, useState, useMemo } from 'react';
import { MemoizedMarkdown } from './MemoizedMarkdown';
import { ThinkingBar } from '@/components/chat/ThinkingBar';
// MessageStreamParser 已移除
import FoldingLoader from '../ui/FoldingLoader';
import { ToolCallCard } from '@/components/chat/ToolCallCard';
import { filterToolCallContent } from '@/lib/chat/segments';
// 采用成熟图片查看组件：yet-another-react-lightbox（需安装依赖）
// pnpm add yet-another-react-lightbox yet-another-react-lightbox/plugins/zoom yet-another-react-lightbox/plugins/fullscreen yet-another-react-lightbox/plugins/rotate yet-another-react-lightbox/plugins/download
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
// 顶部下载改用自定义按钮 + downloadService
import 'yet-another-react-lightbox/styles.css';
import { downloadService } from '@/lib/utils/downloadService';
import { Download as DownloadIcon, Maximize2, Copy as CopyIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AIMessageBlockProps {
  content: string;
  isStreaming: boolean;
  thinkingDuration?: number;
  thinking_start_time?: number; // 思考开始时间戳（毫秒）
  onStreamingComplete?: (duration: number) => void;
  id?: string; // for inline retry in ToolCallCard
  // 优先渲染结构化段（阶段B最小适配）
  segments?: Array<
    | { kind: 'text'; text: string }
    | { kind: 'think'; text: string }
    | { kind: 'image'; mimeType: string; data: string }
    | { kind: 'toolCard'; id: string; server: string; tool: string; args?: Record<string, unknown>; status: 'running' | 'success' | 'error'; resultPreview?: string; errorMessage?: string; schemaHint?: string; messageId: string }
  >;
  // 只读视图模型（优先级最高）
  viewModel?: {
    items: Array<any>;
    flags: { isThinking: boolean; isComplete: boolean; hasToolCalls: boolean };
  };
}

export function AIMessageBlock({
  content,
  isStreaming,
  thinkingDuration,
  thinking_start_time,
  onStreamingComplete,
  id,
  segments,
  viewModel
}: AIMessageBlockProps) {
  const [streamedState, _setStreamedState] = useState<null | {
    thinkingContent: string;
    regularContent: string;
    isThinking: boolean;
    elapsedTime: number;
    isFinished: boolean;
  }>(null);
  // 历史解析器已废弃：不再使用 MessageStreamParser，渲染完全依赖 segments。
  // const parserRef = useRef(new MessageStreamParser());
  const prevContentLength = useRef(0);
  const prevIsStreaming = useRef(isStreaming);
  const onStreamingCompleteRef = useRef(onStreamingComplete);
  
  // 统一跟踪状态变化，避免双 effect 竞争造成误触发
  useEffect(() => {
    const wasStreaming = prevIsStreaming.current;
    prevIsStreaming.current = isStreaming;
    if (wasStreaming && !isStreaming) {
      // 刚从流式结束
      prevContentLength.current = 0;
      if (streamedState && !streamedState.isFinished) {
        onStreamingCompleteRef.current?.(Math.floor(streamedState.elapsedTime / 1000));
      }
    }
  }, [isStreaming, streamedState]);
  
  // 更新ref的值
  useEffect(() => {
    onStreamingCompleteRef.current = onStreamingComplete;
  }, [onStreamingComplete]);

  // 检查内容是否包含think标签 - 只要检测到<think>就开始显示思考栏
  const hasThinkTags = useMemo(() => content.includes('<think>'), [content]);

      // 提前解析工具调用格式：<use_mcp_tool>（推荐）或 <tool_call>（兼容）或 JSON 格式的 {"type":"tool_call",...}
  const hasToolCallEarly = useMemo(() => 
    content.includes('<tool_call>') || 
    content.includes('<use_mcp_tool>') || 
    /"type"\s*:\s*"tool_call"/i.test(content), 
  [content]);
  useMemo(() => {
    if (!hasToolCallEarly) return null;
    // 1) XML 包裹
    const mXml = content.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    if (mXml && mXml[1]) {
      try {
        const obj = JSON.parse(mXml[1]);
        return { server: obj.server, tool: obj.tool, args: obj.parameters || obj.args || {} };
      } catch { /* ignore */ }
    }
    // 2) 代码块/纯文本 JSON
    try {
      // 尝试抓取最短含有 server/tool 的片段
      const mJson = content.match(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/i);
      if (mJson && mJson[0]) {
        const obj = JSON.parse(mJson[0]);
        return { server: obj.server || obj.mcp, tool: obj.tool || obj.tool_name, args: obj.parameters || obj.args || {} };
      }
    } catch { /* ignore */ }
    return null;
  }, [content, hasToolCallEarly]);

  // 提取已嵌入的卡片标记（可支持多次调用）
  useMemo(() => {
    // 渲染阶段统一在 mixedSegments 内处理
    return null;
  }, [content]);

  // 已去除非必要的状态写入，避免在流式阶段造成更新环

  const historicalState = useMemo(() => {
    if (isStreaming) return null;
    

    
    // 如果内容不包含think标签，直接返回纯文本状态
    // 注意：不再为没有think标签的消息显示思考栏，即使有thinking_duration
    // 这避免了误将普通消息识别为思考过程
    if (!hasThinkTags) {
      const result = {
        regularContent: content,
        thinkingContent: '',
        elapsedTime: 0,
        isThinking: false,
        isFinished: true
      };

      return result;
    }
    
    // 包含think标签的内容使用原有逻辑
    const thinkStart = content.indexOf('<think>');
    const thinkEnd = content.indexOf('</think>');
    
    // 如果只有开始标签，提取思考内容到结尾
    if (thinkStart !== -1 && thinkEnd === -1) {
      const thinkingContent = content.substring(thinkStart + 7);
      const regularContent = content.substring(0, thinkStart);
      const result = {
        regularContent,
        thinkingContent,
        elapsedTime: (thinkingDuration ?? 0) * 1000, // 转换为毫秒
        isThinking: false,
        isFinished: true
      };

      return result;
    }
    
    // 如果有完整的think标签
    if (thinkStart !== -1 && thinkEnd !== -1) {
      const thinkingContent = content.substring(thinkStart + 7, thinkEnd);
      // 确保正确处理换行符，避免内容丢失
      const regularContent = (content.substring(0, thinkStart) + content.substring(thinkEnd + 8)).trim();
      const result = {
        regularContent,
        thinkingContent,
        elapsedTime: (thinkingDuration ?? 0) * 1000, // 转换为毫秒
        isThinking: false,
        isFinished: true
      };

      return result;
    }
    
    // 如果没有think标签
    const result = {
      regularContent: content,
      thinkingContent: '',
      elapsedTime: 0,
      isThinking: false,
      isFinished: true
    };
    
    return result;
  }, [content, isStreaming, thinkingDuration, hasThinkTags]);

  // 计算实时经过的时间 - 使用定时器避免每次渲染都调用Date.now()
  const [realTimeElapsed, setRealTimeElapsed] = useState(() => {
    if (isStreaming && thinking_start_time) {
      return Date.now() - thinking_start_time;
    }
    if (thinkingDuration && thinkingDuration > 0) {
      return thinkingDuration * 1000;
    }
    return 0;
  });

  // 用于触发think段计时器的刷新（每秒更新一次）
  const [thinkTimerTick, setThinkTimerTick] = useState(0);

  useEffect(() => {
    if (!isStreaming || !thinking_start_time) {
      // 不在流式状态或没有开始时间，使用固定值
      if (thinkingDuration && thinkingDuration > 0) {
        setRealTimeElapsed(thinkingDuration * 1000);
      }
      return;
    }

    // 流式状态下，使用定时器更新
    const updateElapsed = () => {
      setRealTimeElapsed(Date.now() - thinking_start_time);
    };
    
    updateElapsed(); // 立即更新一次
    const interval = setInterval(updateElapsed, 1000);
    
    return () => clearInterval(interval);
  }, [isStreaming, thinking_start_time, thinkingDuration]);

  // 每秒触发一次，用于更新正在进行中的think段的时间显示
  useEffect(() => {
    if (!isStreaming) return;
    
    const interval = setInterval(() => {
      setThinkTimerTick(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isStreaming]);

  const state = streamedState ?? historicalState;
  


  // 检查是否没有任何内容（初始加载状态）—— segments 路径下以 segments 是否为空为准
  const hasNoContent = isStreaming && (!Array.isArray(segments) || segments.length === 0) && !content;

  // 从 segments 中提取思考内容，替代旧的 MessageStreamParser 机制
  const thinkTextFromSegments = useMemo(() => {
    const src: any[] = Array.isArray(viewModel?.items) ? (viewModel?.items) : (Array.isArray(segments) ? (segments as any[]) : []);
    let acc = '';
    for (const s of src) {
      // s 为 any，直接访问
      if (s && s.kind === 'think') acc += String(s.text || '');
    }
    return acc;
  }, [segments, viewModel?.items]);

  // 将一条 AI 消息中的多种片段（普通文本、<think> 块、工具卡片）按出现顺序混合渲染，避免"消息粘连"
  const mixedSegments = useMemo(() => {
    const src: any[] = Array.isArray(viewModel?.items) ? (viewModel?.items) : (Array.isArray(segments) ? (segments as any[]) : []);
    if (Array.isArray(src) && src.length > 0) {
      const list: Array<{ 
        type: 'card'|'think'|'text'|'image'; 
        text?: string; 
        data?: any; 
        duration?: number; 
        startTime?: number;
      }> = [];
      for (const s of src) {
        if (s && s.kind === 'toolCard') list.push({ type: 'card', data: s });
        // 保留think段，让每个think都有独立的思考栏，传递duration和startTime
        else if (s && s.kind === 'think') list.push({ 
          type: 'think', 
          text: s.text || '', 
          duration: s.duration, 
          startTime: s.startTime 
        });
        else if (s && s.kind === 'text') list.push({ type: 'text', text: s.text || '' });
        else if (s && s.kind === 'image') list.push({ type: 'image', data: s });
      }
      // 调试开关，默认关闭
      try {
        const { trace } = require('@/lib/debug/Trace');
        trace('ui', id, 'mixedSegments', { 
          total: list.length, 
          cards: list.filter(s=>s.type==='card').length, 
          thinks: list.filter(s=>s.type==='think').length, 
          texts: list.filter(s=>s.type==='text').length 
        });
      } catch { /* noop */ }
      return list;
    }
    return [];
  }, [id, segments, viewModel?.items]); // 移除 content 和 state?.regularContent 依赖，它们不影响 segments 的结构

  // 计算当前处于“思考中”的 think 段索引：
  // 规则：从后往前找到第一个 type==='think' 且未结束的段（duration 为 undefined/null/0 视为未结束）。
  const activeThinkIndex = useMemo(() => {
    for (let i = mixedSegments.length - 1; i >= 0; i--) {
      const s: any = mixedSegments[i];
      if (s && s.type === 'think') {
        const d = s.duration;
        if (d === undefined || d === null || d === 0) return i;
        break; // 遇到已完成的最后一个 think，则之前的都不再活跃
      }
    }
    return -1;
  }, [mixedSegments]);

  // 将所有图片段聚合，避免把长段文本割裂
  const images = useMemo(() => {
    const src: any[] = Array.isArray(viewModel?.items) ? (viewModel?.items) : (Array.isArray(segments) ? (segments as any[]) : []);
    const out: Array<{ src: string; filename: string }> = [];
    src.forEach((s: any, idx: number) => {
      if (s && s.kind === 'image') {
        const url = `data:${s.mimeType};base64,${s.data}`;
        out.push({ src: url, filename: `image-${(id||'msg')}-${idx}.png` });
      }
    });
    return out;
  }, [segments, viewModel?.items, id]);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  return (
    <div className="ai-markdown-container group w-full max-w-full min-w-0">
   
      {/* 初始加载状态 - 当AI还没有任何响应时显示 */}
      {hasNoContent && (
        <div key="loader-waiting" className="flex items-center gap-3 py-2">
          <div className="flex items-center gap-2">
            <FoldingLoader size={22} />
          </div>
          <span className="text-xs italic text-slate-500 dark:text-slate-400">等待响应...</span>
        </div>
      )}

      {/* 思考进度条：仅在没有结构化segments时显示全局思考栏（兼容旧消息） */}
      {/* 修复：只有在真正有思考内容时才显示思考栏，避免误将普通消息识别为思考过程 */}
      <AnimatePresence initial={false}>
        {(mixedSegments.length === 0) && (
          (!!viewModel && viewModel.flags?.isThinking) || 
          (!!thinkTextFromSegments && thinkTextFromSegments.trim().length > 0) || 
          (!!state && !!state.thinkingContent && state.thinkingContent.trim().length > 0)
        ) && (
          <motion.div
            layout
            key="global-thinking"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <ThinkingBar
              thinkingContent={thinkTextFromSegments || state?.thinkingContent || ''}
              // 将毫秒转换为秒
              durationSeconds={Math.floor(realTimeElapsed / 1000)}
              // 仅在"流式进行中"或显式标记为思考中时显示活跃态
              isActive={ (viewModel?.flags?.isThinking !== undefined) ? !!viewModel?.flags?.isThinking : !!isStreaming }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 消息内容（混合片段顺序渲染） */}
      {(mixedSegments.length > 0) && (
        <div className="relative min-w-0 max-w-full w-full">
          {mixedSegments.length > 0 ? (
            <div className="flex flex-col gap-3">
              {mixedSegments.map((seg, idx) => {
                // 关键调试：仅当准备渲染工具卡片时打印一次，帮助确认UI层已收到segments
                // 默认关闭的日志
                if (seg.type === 'card') {
                  const d = seg.data;
                  return (
                    <div key={`card-wrap-${d.id || idx}`}>
                      <ToolCallCard
                      key={`card-${d.id || idx}-${idx}`}
                      server={d.server}
                      tool={d.tool}
                      status={d.status}
                      args={d.args}
                      resultPreview={d.resultPreview}
                      errorMessage={d.errorMessage}
                      schemaHint={d.schemaHint}
                      messageId={d.messageId}
                      cardId={d.id}
                      />
                    </div>
                  );
                }
                // 独立渲染每个 think 段的思考栏
                if (seg.type === 'think') {
                  // 是否为当前活跃的思考段：仅由activeThinkIndex决定，避免全局标志干扰
                  const isCurrentThinking = idx === activeThinkIndex;
                  
                  // 计算时长：
                  // 1. 如果已经有duration（已完成的think段），直接使用
                  // 2. 如果正在进行中（isCurrentThinking），使用该段的startTime计算实时时长
                  // 3. 否则使用startTime计算到当前的时长（降级处理）
                  let durationSeconds = 0;
                  if (seg.duration !== undefined && seg.duration !== null && seg.duration > 0) {
                    durationSeconds = seg.duration;
                  } else if (isCurrentThinking && seg.startTime) {
                    const _ = thinkTimerTick; // 触发重新计算
                    durationSeconds = Math.floor((Date.now() - seg.startTime) / 1000);
                  } else if (seg.startTime) {
                    durationSeconds = Math.floor((Date.now() - seg.startTime) / 1000);
                  }
                  
                  return (
                    <div key={`think-${idx}`}>
                      <ThinkingBar
                        thinkingContent={seg.text || ''}
                        durationSeconds={durationSeconds}
                        isActive={isCurrentThinking}
                      />
                    </div>
                  );
                }
                if (seg.type === 'image') {
                  const img = seg.data as { mimeType: string; data: string };
                  const src = `data:${img.mimeType};base64,${img.data}`;
                  const prevType = idx > 0 ? mixedSegments[idx - 1]?.type : null;
                  const needSoftDivider = prevType === 'card';
                  const i = Math.max(0, images.findIndex((x)=>x.src===src));
                  return (
                    <div key={`img-inline-${idx}`} className={needSoftDivider ? 'pt-2 border-t border-dashed border-slate-200/60 dark:border-slate-700/60' : undefined}>
                      <div className="relative inline-block group">
                        <img
                          src={src}
                          alt="generated"
                          className="max-w-[50vw] max-h-[50vh] w-auto h-auto object-contain rounded-md border border-slate-200/60 dark:border-slate-700/60"
                          onClick={() => { setLightboxIndex(i); setLightboxOpen(true); }}
                          onDoubleClick={() => { setLightboxIndex(i); setLightboxOpen(true); }}
                        />
                        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1 bg-white/80 dark:bg-slate-900/70 backdrop-blur-md px-1.5 py-1 rounded-full shadow-sm ring-1 ring-slate-200/60 dark:ring-slate-700/60">
                          <button
                            className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                            onClick={() => { setLightboxIndex(i); setLightboxOpen(true); }}
                            title="查看"
                            aria-label="查看"
                          >
                            <Maximize2 size={16} className="text-slate-800 dark:text-slate-200" />
                          </button>
                          <button
                            className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                            onClick={async () => {
                              try {
                                const res = await fetch(src);
                                const blob = await res.blob();
                                await downloadService.downloadFile(`image-${(id||'msg')}-${idx}.png`, blob, blob.type);
                              } catch { /* noop */ }
                            }}
                            title="下载"
                            aria-label="下载"
                          >
                            <DownloadIcon size={16} className="text-slate-800 dark:text-slate-200" />
                          </button>
                          <button
                            className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                            onClick={async () => {
                              try {
                                const res = await fetch(src);
                                const blob = await res.blob();
                                const item = new (window as any).ClipboardItem({ [blob.type]: blob });
                                await (navigator as any).clipboard.write([item]);
                              } catch { /* noop */ }
                            }}
                            title="复制到剪贴板"
                            aria-label="复制到剪贴板"
                          >
                            <CopyIcon size={16} className="text-slate-800 dark:text-slate-200" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                // 渲染文本段落 - 跳过空内容
                const textContent = seg.text || '';
                if (!textContent.trim()) {
                  return null; // 不渲染空的文本段落
                }
                const prevType = idx > 0 ? mixedSegments[idx - 1]?.type : null;
                const needSoftDivider = prevType === 'card';
                return (
                  <div key={`md-wrap-${idx}`} className={needSoftDivider ? 'pt-3 border-t border-dashed border-slate-200/60 dark:border-slate-700/60' : undefined}>
                    <div className="markdown-content-area">
                      {(() => {
                        // 使用统一的StreamingMarkdown组件，支持流式和非流式markdown渲染
                        const { StreamingMarkdown } = require('./StreamingMarkdown');
                        return <StreamingMarkdown content={textContent} isStreaming={isStreaming} />;
                      })()}
                    </div>
                  </div>
                );
              })}
              {(() => {
                // 兜底：当 segments 中没有任何 text 段时，使用 regularContent/content 进行一次性渲染
                // 注意：这里的fallback主要用于向后兼容，正常流式应该都通过segments渲染
                const hasTextSegment = mixedSegments.some(s => s.type === 'text' && (s.text || '').trim().length > 0);
                const fallbackText = (state?.regularContent || content || '').trim();
                const fallbackTextCleaned = filterToolCallContent(fallbackText);
                if (!hasTextSegment && fallbackText.length > 0) {
                  return (
                    <div key="md-fallback" className="pt-3 border-t border-dashed border-slate-200/60 dark:border-slate-700/60">
                      <div className="markdown-content-area">
                        {(() => {
                          const { StreamingMarkdown } = require('./StreamingMarkdown');
                          return <StreamingMarkdown content={fallbackTextCleaned} isStreaming={isStreaming} />;
                        })()}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          ) : null}
          {/* MCP调用识别阶段：检测到（或抑制阀已识别到）工具调用但卡片尚未出现时显示加载动画 */}
          {isStreaming && (hasToolCallEarly || !!(viewModel as any)?.flags?.isToolDetecting) && mixedSegments.filter(s => s.type === 'card').length === 0 && (
            <div key="loader-tool-detecting" className="flex items-center gap-3 py-2">
              <div className="flex items-center gap-2">
                <FoldingLoader key="loader-tool" size={22} />
              </div>
              <span className="text-xs italic text-slate-500 dark:text-slate-400">正在识别工具调用指令…</span>
            </div>
          )}
          {/* 思考结束到卡片出现的过渡期占位：当仍在流式但暂无任何片段时显示 */}
          {isStreaming && !hasNoContent && !hasToolCallEarly && mixedSegments.length === 0 && (
            <div key="loader-preparing" className="flex items-center gap-3 py-2">
              <div className="flex items-center gap-2">
                <FoldingLoader key="loader-reply" size={22} />
              </div>
              <span className="text-xs italic text-slate-500 dark:text-slate-400">正在准备回复…</span>
            </div>
          )}
          {/* 悬浮显示字数 */}
          {/* <div className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[11px] text-gray-400 bg-gray-50/80 dark:bg-gray-800/60 backdrop-blur px-1.5 py-0.5 rounded select-none pointer-events-none">
            {(() => {
              const text = state?.regularContent || '';
              return `字数: ${text.replace(/\s+/g,'').length}`;
            })()}
          </div> */}
        </div>
      )}

      {/* 当没有任何结构化片段时，回退为渲染纯正文（兼容非流式RAG或历史消息） */}
      {(mixedSegments.length === 0) && !!(state?.regularContent || content) && (
        <div className="relative min-w-0 max-w-full w-full markdown-content-area">
          <MemoizedMarkdown content={filterToolCallContent((state?.regularContent || content))} />
        </div>
      )}

      {/* 取消集中渲染：图片已内联呈现 */}

      {/* 成熟 Lightbox 预览，含缩放/旋转/全屏/下载 */}
      {lightboxOpen && (
        <Lightbox
          open
          close={() => setLightboxOpen(false)}
          index={lightboxIndex}
          controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
          animation={{ swipe: 0 }}
          carousel={{ finite: false }}
          slides={images.map((im) => ({ src: im.src } as any))}
          plugins={[Zoom as any, Fullscreen as any]}
        />
      )}

      {/* 顶部悬浮下载按钮（使用 downloadService） */}
      {lightboxOpen && images[lightboxIndex] && (
        <div className="fixed top-3 right-3 z-[1001] bg-white/80 dark:bg-slate-900/70 backdrop-blur-md ring-1 ring-slate-200/60 dark:ring-slate-700/60 rounded-full shadow-sm p-1">
          <button
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={async () => {
              try {
                const im = images[lightboxIndex];
                const res = await fetch(im.src);
                const blob = await res.blob();
                await downloadService.downloadFile(im.filename, blob, blob.type);
              } catch { /* noop */ }
            }}
            title="下载"
            aria-label="下载"
          >
            <DownloadIcon size={18} className="text-slate-800 dark:text-slate-200" />
          </button>
        </div>
      )}
    </div>
  );
} 