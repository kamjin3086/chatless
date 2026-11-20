/**
 * 统一面板样式配置
 * 
 * 所有输入提及面板（#提示词、@MCP 和工作区文件、/技能）共用的样式常量
 * 每种面板有独特的颜色主题
 */

// 面板容器样式
export const panelContainerClass = [
  // 基础
  "glass-overlay flex flex-col rounded-xl border overflow-hidden",
  // 背景
  "bg-white/100 dark:bg-slate-900/95 backdrop-blur-sm",
  // 边框和阴影
  "border-slate-200 dark:border-slate-700",
  "shadow-xl shadow-slate-200/50 dark:shadow-black/30",
  // 动画：统一使用 150ms 的淡入 + 微弱上移
  "animate-in fade-in-0 slide-in-from-bottom-2 duration-150",
].join(" ");

// 面板头部样式
export const panelHeaderClass = [
  "flex shrink-0 items-center justify-between",
  "px-3 py-2.5",
  "border-b border-slate-100 dark:border-slate-800",
].join(" ");

// 面板头部标题标签样式（默认灰色）
export const panelTitleBadgeClass = [
  "px-2.5 py-1 rounded-lg text-xs font-medium",
  "text-slate-600 dark:text-slate-300",
  "bg-slate-100 dark:bg-slate-800",
].join(" ");

// 面板标题颜色主题
export const panelTitleThemes = {
  // 提示词 - 琥珀色
  prompt: "bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400",
  // MCP - 绿色
  mcp: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400",
  // 技能 - 紫色
  skill: "bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400",
};

// 面板列表容器样式
export const panelListClass = [
  "min-h-0 flex-1 max-h-72 overflow-y-auto",
  "py-1",
].join(" ");

// 面板列表项样式（未选中）
export const panelItemClass = [
  "mx-1 px-3 py-2 rounded-md",
  "cursor-pointer",
  "transition-colors duration-100",
].join(" ");

// 面板列表项样式（选中/hover）
export const panelItemActiveClass = [
  "bg-slate-100 dark:bg-slate-800",
].join(" ");

// 面板底部样式
export const panelFooterClass = [
  "shrink-0 px-3 py-2",
  "border-t border-slate-100 dark:border-slate-800",
  "text-[11px] text-slate-500 dark:text-slate-400",
].join(" ");

// 面板宽度配置
export const panelWidth = {
  sm: 280,
  md: 360,
  lg: 440,
};

export function composerPanelPosition(
  anchor: Pick<DOMRectReadOnly, 'left' | 'width' | 'top' | 'bottom'>,
  viewportWidth: number,
  viewportHeight: number,
  preferredWidth: number,
) {
  const gap = 8;
  const width = Math.max(0, Math.min(preferredWidth, viewportWidth - 2 * gap));
  const left = Math.max(gap, Math.min(anchor.left + (anchor.width - width) / 2, viewportWidth - width - gap));
  const above = anchor.top - 2 * gap;
  const below = viewportHeight - anchor.bottom - 2 * gap;
  const openAbove = above >= 360 || above >= below;
  return {
    left, width,
    ...(openAbove ? { bottom: viewportHeight - anchor.top + gap } : { top: anchor.bottom + gap }),
    maxHeight: Math.max(0, openAbove ? above : below),
  };
}

export function calcPanelPosition(anchor: HTMLElement | null, preferredWidth = panelWidth.md) {
  return anchor ? composerPanelPosition(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight, preferredWidth) : null;
}

