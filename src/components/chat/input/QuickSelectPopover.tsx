"use client";

/**
 * 简约上拉选择组件
 * 
 * 用于状态栏标签点击后的快速选择，风格统一、简约，支持颜色主题
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuickSelectOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

// 颜色主题配置
const colorThemes = {
  sky: {
    header: "text-sky-600 dark:text-sky-400",
    selected: "bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800",
    check: "text-sky-500",
  },
  violet: {
    header: "text-violet-600 dark:text-violet-400",
    selected: "bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-800",
    check: "text-violet-500",
  },
  emerald: {
    header: "text-emerald-600 dark:text-emerald-400",
    selected: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800",
    check: "text-emerald-500",
  },
  amber: {
    header: "text-amber-600 dark:text-amber-400",
    selected: "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800",
    check: "text-amber-500",
  },
  slate: {
    header: "text-slate-600 dark:text-slate-400",
    selected: "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700",
    check: "text-slate-500",
  },
};

type ColorTheme = keyof typeof colorThemes;

interface QuickSelectPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorEl: HTMLElement | null;
  options: QuickSelectOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  title?: string;
  emptyText?: string;
  accentColor?: ColorTheme;
}

export function QuickSelectPopover({
  open,
  onOpenChange,
  anchorEl,
  options,
  selectedId,
  onSelect,
  title,
  emptyText = "暂无可用选项",
  accentColor = "slate",
}: QuickSelectPopoverProps) {
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const theme = colorThemes[accentColor];

  // 计算位置
  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    setPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4,
    });
  }, [open, anchorEl]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange]);

  if (!open || !pos) return null;

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: pos.left,
        bottom: pos.bottom,
        minWidth: 180,
        maxWidth: 280,
        zIndex: 9999,
      }}
      className={cn(
        "rounded-xl border overflow-hidden glass-overlay",
        "bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm",
        "border-slate-200 dark:border-slate-700",
        "shadow-xl shadow-slate-200/50 dark:shadow-black/30",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
      )}
    >
      {/* 标题 */}
      {title && (
        <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
          <span className={cn("text-xs font-medium", theme.header)}>{title}</span>
        </div>
      )}

      {/* 选项列表 */}
      <ul className="py-1.5 max-h-52 overflow-y-auto">
        {options.length === 0 ? (
          <li className="px-3 py-4 text-center text-sm text-slate-400">
            {emptyText}
          </li>
        ) : (
          options.map((opt) => {
            const isSelected = selectedId === opt.id;
            return (
              <li
                key={opt.id}
                onClick={() => {
                  if (!opt.disabled) {
                    onSelect(opt.id);
                    onOpenChange(false);
                  }
                }}
                className={cn(
                  "mx-1.5 px-3 py-2 rounded-lg cursor-pointer",
                  "flex items-center justify-between gap-2",
                  "transition-all duration-100 border",
                  opt.disabled
                    ? "opacity-40 cursor-not-allowed border-transparent"
                    : isSelected
                    ? theme.selected
                    : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50"
                )}
              >
                <div className="min-w-0">
                  <div className={cn(
                    "text-sm truncate",
                    isSelected ? "font-medium text-slate-800 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"
                  )}>
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-[11px] text-slate-400 truncate">
                      {opt.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <Check className={cn("w-4 h-4 shrink-0", theme.check)} />
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  return typeof window !== "undefined" ? createPortal(panel, document.body) : panel;
}
