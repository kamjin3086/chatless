/**
 * 统一面板样式配置
 * 
 * 所有输入提及面板（/提示词、@MCP、#技能）共用的样式常量
 * 每种面板有独特的颜色主题
 */

// 面板容器样式
export const panelContainerClass = [
  // 基础
  "rounded-xl border overflow-hidden",
  // 背景
  "bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm",
  // 边框和阴影
  "border-slate-200 dark:border-slate-700",
  "shadow-xl shadow-slate-200/50 dark:shadow-black/30",
  // 动画：统一使用 150ms 的淡入 + 微弱上移
  "animate-in fade-in-0 slide-in-from-bottom-2 duration-150",
].join(" ");

// 面板头部样式
export const panelHeaderClass = [
  "flex items-center justify-between",
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
  "max-h-72 overflow-y-auto",
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
  "px-3 py-2",
  "border-t border-slate-100 dark:border-slate-800",
  "text-[11px] text-slate-500 dark:text-slate-400",
].join(" ");

// 面板宽度配置
export const panelWidth = {
  sm: 280,
  md: 360,
  lg: 440,
};

// 计算面板位置（基于 textarea 锚点）
export function calcPanelPosition(
  anchorEl: HTMLElement | null,
  panelWidthPx: number = panelWidth.md
): { left: number; bottom: number; width: number } | null {
  if (!anchorEl) return null;
  
  const rect = anchorEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 水平居中于锚点，但不超出视口
  let left = rect.left + rect.width / 2 - panelWidthPx / 2;
  left = Math.max(8, Math.min(left, viewportWidth - panelWidthPx - 8));
  
  // 底部对齐到锚点上方
  const bottom = viewportHeight - rect.top + 8;
  
  return { left, bottom, width: panelWidthPx };
}

