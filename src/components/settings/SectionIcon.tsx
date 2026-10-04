"use client";

import React from "react";

export type SectionIconPreset =
  | "brand"      // 渐变品牌色（默认）
  | "teal"       // 绿色系渐变
  | "indigo"     // 靛蓝系渐变
  | "gray"       // 中性灰底
  | "glass"      // 半透明玻璃
  | "outline";   // 细边框无底色

interface SectionIconProps {
  icon: React.ElementType;
  preset?: SectionIconPreset;
  className?: string; // 外层附加类（例如控制大小）
  size?: number;      // 容器尺寸（px），默认 32
}

/**
 * 统一的设置区块图标容器，支持多套预设样式。
 * 尽量保持最小 API：传入 Icon 组件，指定 preset 即可。
 */
export function SectionIcon({ icon: Icon, preset = "brand", className = "", size = 32 }: SectionIconProps) {
  const base = "rounded-md flex items-center justify-center shadow-sm";

  const wrap = (() => {
    switch (preset) {
      case "teal":
        return "bg-gradient-to-br from-green-500/15 to-teal-600/15 dark:from-green-400/15 dark:to-teal-400/15 ring-1 ring-teal-300/40 dark:ring-teal-700/40";
      case "indigo":
        return "bg-gradient-to-br from-indigo-500/15 to-purple-600/15 dark:from-indigo-400/15 dark:to-purple-400/15 ring-1 ring-indigo-300/40 dark:ring-indigo-700/40";
      case "gray":
        // 改为无底色细描边，避免大片灰底影响观感
        return "bg-transparent ring-1 ring-slate-300 dark:ring-slate-600";
      case "glass":
        return "bg-white/70 dark:bg-slate-800/40 backdrop-blur supports-[backdrop-filter]:backdrop-blur-sm ring-1 ring-white/70 dark:ring-slate-700/60";
      case "outline":
        return "bg-transparent ring-1 ring-slate-300 dark:ring-slate-600";
      case "brand":
      default:
        return "bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-800 dark:to-brand-900 ring-1 ring-brand-200/50 dark:ring-brand-800/40";
    }
  })();

  const iconColor = (() => {
    switch (preset) {
      case "teal":
        return "text-teal-600 dark:text-teal-400";
      case "indigo":
        return "text-indigo-600 dark:text-indigo-400";
      case "gray":
        return "text-slate-600 dark:text-slate-300";
      case "glass":
        return "text-slate-700 dark:text-slate-200";
      case "outline":
        return "text-slate-600 dark:text-slate-300";
      case "brand":
      default:
        return "text-brand-600 dark:text-brand-400";
    }
  })();

  // 将 px 尺寸转为 Tailwind 内联 style，避免生成过多类名
  const sizeStyle: React.CSSProperties = { width: size, height: size };

  return (
    <div className={`${base} ${wrap} ${className}`} style={sizeStyle}>
      <Icon className={`w-4 h-4 ${iconColor}`} />
    </div>
  );
}


