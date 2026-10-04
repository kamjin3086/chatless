"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps, toast as sonnerToast } from "sonner"
import React, { useMemo, useState } from "react"
import { Check, Copy, X } from "lucide-react"

/**
 * 项目统一的Toast通知组件封装
 * 
 * 规范说明：
 * 1. 项目中所有右下角通知必须使用此封装的toast组件，禁止直接使用sonner库
 * 2. 此封装提供了统一的接口和样式，确保通知的一致性
 * 3. 支持success、error、info、warning、message五种通知类型
 * 4. 每种类型都支持description和duration参数
 * 5. 对于特殊需求，可以通过toast.raw访问原始的sonner toast
 * 
 * 使用示例：
 * ```typescript
 * import { toast } from "@/components/ui/sonner";
 * 
 * // 成功通知
 * toast.success("操作成功", { description: "详细信息" });
 * 
 * // 错误通知
 * toast.error("操作失败", { description: "错误详情", duration: 5000 });
 * 
 * // 信息通知
 * toast.info("提示信息");
 * 
 * // 警告通知
 * toast.warning("警告信息");
 * 
 * // 普通消息
 * toast.message("普通消息");
 * ```
 */

// 统一裁剪描述文本，避免右下角弹窗过长
export function trimToastDescription(input: unknown, maxLen: number = 180): string | undefined {
  if (input == null) return undefined;
  let raw: string;
  if (typeof input === 'string') raw = input;
  else if ((input as any)?.message) raw = String((input as any).message);
  else {
    try { raw = JSON.stringify(input); } catch { raw = String(input); }
  }
  raw = raw.replace(/\s+/g, ' ').trim();
  if (raw.length > maxLen) return raw.slice(0, maxLen) + '…';
  return raw;
}

// 将未知描述值转换为可显示的字符串
function toDisplayString(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if ((input as any)?.message) return String((input as any).message);
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

// 判断是否需要折叠显示（多行或较长）
function shouldCollapse(text: string): boolean {
  if (!text) return false;
  if (text.includes('\n')) return true;
  return text.length > 160;
}

//（旧版CollapsibleDetails已移除，逻辑并入 CollapsibleDetailsWithControl）

// 将描述渲染为可折叠UI（当文本较长或多行时）
type ToastIdRef = React.MutableRefObject<string | number | null>;

function CollapsibleDetailsWithControl(props: { text: string; toastIdRef: ToastIdRef; initialAutoCloseMs?: number; leaveAutoCloseMs?: number }) {
  const { text, toastIdRef, initialAutoCloseMs = 7000, leaveAutoCloseMs = 3000 } = props;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const leaveTimerRef = React.useRef<number | null>(null);
  const initialTimerRef = React.useRef<number | null>(null);

  const preview = useMemo(() => {
    const s = text.replace(/\s+/g, ' ').trim();
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  }, [text]);

  const clearLeaveTimer = () => {
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };
  const scheduleLeaveClose = () => {
    clearLeaveTimer();
    const id = toastIdRef.current;
    if (id == null) return;
    leaveTimerRef.current = window.setTimeout(() => {
      try { sonnerToast.dismiss(id); } catch { /* ignore */ }
    }, leaveAutoCloseMs);
  };

  React.useEffect(() => {
    // 初始阶段：若用户未展开且未悬停，几秒后自动关闭（与普通toast一致）
    const id = toastIdRef.current;
    if (id == null) return;
    initialTimerRef.current = window.setTimeout(() => {
      if (!expanded) {
        try { sonnerToast.dismiss(id); } catch { /* ignore */ }
      }
    }, initialAutoCloseMs);
    return () => {
      if (initialTimerRef.current) window.clearTimeout(initialTimerRef.current);
      clearLeaveTimer();
    };
  }, [expanded, toastIdRef, initialAutoCloseMs]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const rootRef = React.useRef<HTMLElement | null>(null);

  // 绑定到整条 toast 元素，确保准确的离开/进入判定；同时实现点击外部与 ESC 关闭
  React.useEffect(() => {
    const root = wrapperRef.current?.closest('[data-sonner-toast]') as HTMLElement | null;
    rootRef.current = root;
    if (!root) return;

    const onEnter = () => {
      // 悬停时取消任何关闭定时器
      if (initialTimerRef.current) { window.clearTimeout(initialTimerRef.current); initialTimerRef.current = null; }
      if (leaveTimerRef.current) { window.clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    };
    const onLeave = () => {
      if (expanded) {
        // 鼠标离开整条通知后，延迟关闭
        clearLeaveTimer();
        const id = toastIdRef.current;
        if (id != null) {
          leaveTimerRef.current = window.setTimeout(() => {
            try { sonnerToast.dismiss(id); } catch { /* noop */ }
          }, leaveAutoCloseMs);
        }
      }
    };

    root.addEventListener('mouseenter', onEnter);
    root.addEventListener('mouseleave', onLeave);

    // 点击外部立即关闭
    const handleDocPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (root && target && !root.contains(target)) {
        const id = toastIdRef.current;
        if (id != null) { try { sonnerToast.dismiss(id); } catch { /* noop */ } }
      }
    };
    document.addEventListener('pointerdown', handleDocPointerDown, true);

    // ESC 关闭
    const handleKeydown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        const id = toastIdRef.current;
        if (id != null) { try { sonnerToast.dismiss(id); } catch { /* noop */ } }
      }
    };
    window.addEventListener('keydown', handleKeydown);

    return () => {
      root.removeEventListener('mouseenter', onEnter);
      root.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('pointerdown', handleDocPointerDown, true);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [expanded, toastIdRef, leaveAutoCloseMs]);

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => {
        clearLeaveTimer();
        // 鼠标进入时，取消初始自动关闭
        if (initialTimerRef.current) {
          window.clearTimeout(initialTimerRef.current);
          initialTimerRef.current = null;
        }
      }}
      onMouseLeave={(e) => {
        // 仅当真正离开整条toast时才触发（relatedTarget 不在 toast 内部）
        const root = rootRef.current;
        const next = e.relatedTarget as Node | null;
        if (root && next && root.contains(next)) return;
        if (expanded) scheduleLeaveClose();
      }}
    >
      {expanded ? (
        <div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800/70 dark:hover:bg-slate-700 dark:text-slate-200 transition-colors"
              title={copied ? "已复制" : "复制错误信息"}
              aria-label={copied ? "已复制" : "复制错误信息"}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="text-[11px]">{copied ? "已复制" : "复制"}</span>
            </button>
            <button
              type="button"
              onClick={() => { const id = toastIdRef.current; if (id != null) { try { sonnerToast.dismiss(id); } catch { /* noop */ } } }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800/70 dark:hover:bg-slate-700 dark:text-slate-200 transition-colors"
              title="关闭"
              aria-label="关闭"
            >
              <X className="w-3.5 h-3.5" />
              <span className="text-[11px]">关闭</span>
            </button>
          </div>
          <div className="mt-1.5 max-h-[55vh] overflow-y-auto overflow-x-hidden rounded-md border border-slate-100 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 p-2 text-[12px] leading-5 font-mono whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">
            {text}
          </div>
        </div>
      ) : (
        <div>
          <div className="mt-1.5 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
            {preview}
          </div>
          <div className="mt-1">
            <button
              type="button"
              onClick={() => {
                // 展开：不再提供收起；并取消任何初始关闭定时器
                setExpanded(true);
                if (initialTimerRef.current) {
                  window.clearTimeout(initialTimerRef.current);
                  initialTimerRef.current = null;
                }
              }}
              className="text-[12px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors underline-offset-2 hover:underline"
            >
              展开详情
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildDescription(
  desc?: React.ReactNode
): { node?: React.ReactNode; idRef?: ToastIdRef; duration?: number } {
  if (desc == null) return { node: undefined };
  if (typeof desc !== 'string') return { node: desc };
  const text = toDisplayString(desc);
  if (!shouldCollapse(text)) return { node: text };
  const idRef: ToastIdRef = { current: null };
  const node = <CollapsibleDetailsWithControl text={text} toastIdRef={idRef} />;
  // 使用极长持续时间，完全由我们的鼠标逻辑关闭
  return { node, idRef, duration: 365 * 24 * 60 * 60 * 1000 };
}

// 封装好的toast工具函数，提供统一的接口
export const toast = {
  success: (message: string, options?: { description?: React.ReactNode; duration?: number; action?: any }) => {
    const d = buildDescription(options?.description);
    const id = sonnerToast.success(message, {
      description: d.node,
      duration: d.duration ?? (options?.duration || 4000),
      action: options?.action,
    });
    if (d.idRef) d.idRef.current = id as any;
    return id;
  },
  
  error: (message: string, options?: { description?: React.ReactNode; duration?: number; action?: any }) => {
    const d = buildDescription(options?.description);
    const id = sonnerToast.error(message, {
      description: d.node,
      duration: d.duration ?? (options?.duration || 5000),
      action: options?.action,
    });
    if (d.idRef) d.idRef.current = id as any;
    return id;
  },
  
  info: (message: string, options?: { description?: React.ReactNode; duration?: number; action?: any }) => {
    const d = buildDescription(options?.description);
    const id = sonnerToast.info(message, {
      description: d.node,
      duration: d.duration ?? (options?.duration || 4000),
      action: options?.action,
    });
    if (d.idRef) d.idRef.current = id as any;
    return id;
  },
  
  warning: (message: string, options?: { description?: React.ReactNode; duration?: number; action?: any }) => {
    const d = buildDescription(options?.description);
    const id = sonnerToast.warning(message, {
      description: d.node,
      duration: d.duration ?? (options?.duration || 4000),
      action: options?.action,
    });
    if (d.idRef) d.idRef.current = id as any;
    return id;
  },
  
  message: (message: string, options?: { description?: React.ReactNode; duration?: number; action?: any }) => {
    const d = buildDescription(options?.description);
    const id = sonnerToast.message(message, {
      description: d.node,
      duration: d.duration ?? (options?.duration || 4000),
      action: options?.action,
    });
    if (d.idRef) d.idRef.current = id as any;
    return id;
  },
  
  // 直接暴露sonner的toast，用于特殊需求
  raw: sonnerToast,
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        // 使用更高对比度且更轻盈的样式，确保亮色/暗色模式的可读性
        position={props.position || "bottom-right"}
        expand
        toastOptions={{
          ...props.toastOptions,
          classNames: {
            ...props.toastOptions?.classNames,
            // 精致轻盈风格：半透明毛玻璃、柔和阴影、可选中文本
            toast:
              "relative rounded-xl border px-3.5 py-2.5 backdrop-blur-lg glass-overlay " +
              "shadow-[0_8px_28px_rgba(0,0,0,0.08)] ring-1 ring-black/5 " +
              "bg-white/90 text-slate-800 border-white/60 " +
              "dark:bg-slate-900/80 dark:text-slate-100 dark:border-white/10 dark:ring-white/10 " +
              "[&]:cursor-text select-text " +
              // 允许 toast 随内容增长，最多到视口的 65% 高度；超出时滚动
              "max-h-[65vh] overflow-y-auto",
            title: "text-[13px] font-semibold leading-5",
            description: "text-[12px] leading-5 text-slate-600 dark:text-slate-300",
            actionButton: "text-[12px]",
            cancelButton: "text-[12px]",
          },
        }}
        {...props}
      />

      {/* 全局覆写：1) 允许文本选择 2) 禁止拖动位移 3) 细化左右色条与主题色 */}
      <style jsx global>{`
        /* 允许在通知内选择文本以便复制 */
        .toaster [data-sonner-toast] {
          -webkit-user-select: text;
          user-select: text;
          /* 细化外观：左侧细色条用于类型区分 */
          border-left-width: 2px;
          border-left-style: solid;
          /* 禁止横向滚动条导致高度跳动 */
          overflow-x: hidden;
        }

        /* 禁止在拖拽/滑动状态下的平移，避免选中文本时卡片跟随鼠标移动 */
        .toaster [data-sonner-toast][data-swiping],
        .toaster [data-sonner-toast][data-dragging],
        .toaster [data-sonner-toast][data-swipe] {
          transform: none !important;
          translate: 0 !important;
        }

        /* 触摸环境下也避免横向滑动导致位移 */
        .toaster [data-sonner-toast] { touch-action: manipulation; }

        /* 不同类型的轻量配色（左侧色条） */
        .toaster [data-sonner-toast][data-type='success'] { border-left-color: #10b981; }
        .toaster [data-sonner-toast][data-type='error'] { border-left-color: #ef4444; }
        .toaster [data-sonner-toast][data-type='warning'] { border-left-color: #f59e0b; }
        .toaster [data-sonner-toast][data-type='info'],
        .toaster [data-sonner-toast][data-type='message'] { border-left-color: #0ea5e9; }

        /* 悬停时略微提升阴影与背景透明度，保持轻盈质感 */
        .toaster [data-sonner-toast]:hover {
          box-shadow: 0 10px 30px rgba(0,0,0,0.10);
          background: color-mix(in srgb, rgba(255,255,255,0.86) 100%, transparent);
        }
        @media (prefers-color-scheme: dark) {
          .toaster [data-sonner-toast]:hover {
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
            background: color-mix(in srgb, rgba(15,23,42,0.86) 100%, transparent);
          }
        }
      `}</style>
    </>
  )
}

export { Toaster }
