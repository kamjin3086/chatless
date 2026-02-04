"use client";

/**
 * 统一的操作面板组件
 * 
 * ## 设计目标
 * 
 * 为输入框周围的各种弹出面板提供统一的样式和交互体验。
 * 
 * ## 使用场景
 * 
 * - MCP 服务器快速切换
 * - 知识库选择
 * - 网络搜索设置
 * - 斜杠命令提示词
 * 
 * ## 样式规范
 * 
 * - 统一的圆角、阴影、背景模糊效果
 * - 一致的动画效果
 * - 响应式设计
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { X, Search, Settings, ChevronRight } from "lucide-react";

// ============================================
// ActionPanel 基础组件
// ============================================

/**
 * ActionPanel 容器
 */
export function ActionPanel({
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props}>{children}</PopoverPrimitive.Root>;
}

/**
 * ActionPanel 触发器
 */
export function ActionPanelTrigger({
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return (
    <PopoverPrimitive.Trigger asChild {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

/**
 * ActionPanel 内容区域
 */
export interface ActionPanelContentProps
  extends React.ComponentProps<typeof PopoverPrimitive.Content> {
  /** 面板宽度 */
  width?: "sm" | "md" | "lg" | "xl" | "auto";
  /** 最大高度 */
  maxHeight?: string;
  /** 是否显示关闭按钮 */
  showClose?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

const widthClasses = {
  sm: "w-64",
  md: "w-80",
  lg: "w-96",
  xl: "w-[28rem]",
  auto: "w-auto",
};

export function ActionPanelContent({
  className,
  children,
  width = "md",
  maxHeight = "24rem",
  showClose = false,
  onClose,
  align = "start",
  sideOffset = 8,
  ...props
}: ActionPanelContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // 基础样式
          "z-[9950] rounded-xl border",
          // 背景和模糊
          "bg-white/95 dark:bg-gray-800/95 backdrop-blur-md",
          // 阴影和边框
          "shadow-lg ring-1 ring-black/5 dark:ring-white/10",
          // 动画
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2",
          "data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2",
          "data-[side=top]:slide-in-from-bottom-2",
          // 宽度
          widthClasses[width],
          // 内边距
          "p-2",
          className
        )}
        style={{ maxHeight }}
        {...props}
      >
        {showClose && (
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

// ============================================
// ActionPanel 子组件
// ============================================

/**
 * 面板头部
 */
interface ActionPanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 标题 */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 图标 */
  icon?: React.ReactNode;
  /** 右侧操作区 */
  action?: React.ReactNode;
}

export function ActionPanelHeader({
  title,
  subtitle,
  icon,
  action,
  className,
  ...props
}: ActionPanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-2 pb-2 border-b border-gray-100 dark:border-gray-700/50",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {icon && (
          <div className="flex-shrink-0 text-gray-500 dark:text-gray-400">
            {icon}
          </div>
        )}
        <div>
          <h3 className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
            {title}
          </h3>
          {subtitle && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div className="flex items-center">{action}</div>}
    </div>
  );
}

/**
 * 搜索框
 */
interface ActionPanelSearchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 清除回调 */
  onClear?: () => void;
}

export function ActionPanelSearch({
  value,
  onChange,
  onClear,
  placeholder = "搜索...",
  className,
  ...props
}: ActionPanelSearchProps) {
  return (
    <div className={cn("relative px-1 py-2", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(
          "w-full pl-8 pr-3 py-1.5 text-sm",
          "rounded-lg border border-gray-200 dark:border-gray-600",
          "bg-gray-50/50 dark:bg-gray-700/50",
          "placeholder:text-gray-400 dark:placeholder:text-gray-500",
          "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400",
          "transition-all"
        )}
        {...props}
      />
      {value && onClear && (
        <button
          onClick={onClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-600"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/**
 * 列表容器
 */
interface ActionPanelListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 最大高度 */
  maxHeight?: string;
}

export function ActionPanelList({
  children,
  maxHeight = "16rem",
  className,
  ...props
}: ActionPanelListProps) {
  return (
    <div
      className={cn(
        "overflow-y-auto custom-scrollbar",
        className
      )}
      style={{ maxHeight }}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * 列表项
 */
interface ActionPanelItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** 图标 */
  icon?: React.ReactNode;
  /** 标题 */
  title: React.ReactNode;
  /** 描述 */
  description?: string;
  /** 右侧内容 */
  suffix?: React.ReactNode;
  /** 是否选中 */
  selected?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否显示箭头 */
  showArrow?: boolean;
}

export function ActionPanelItem({
  icon,
  title,
  description,
  suffix,
  selected = false,
  disabled = false,
  showArrow = false,
  className,
  ...props
}: ActionPanelItemProps) {
  return (
    <button
      className={cn(
        "group w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left",
        "transition-all duration-150",
        // 正常状态
        !disabled && !selected && "hover:bg-gray-100/80 dark:hover:bg-gray-700/50",
        // 选中状态
        selected && "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
        // 禁用状态
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      disabled={disabled}
      {...props}
    >
      {icon && (
        <div
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
            "bg-gray-100 dark:bg-gray-700",
            selected && "bg-blue-100 dark:bg-blue-800/50"
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium truncate",
            "text-gray-800 dark:text-gray-200",
            selected && "text-blue-700 dark:text-blue-300"
          )}
        >
          {title}
        </p>
        {description && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
            {description}
          </p>
        )}
      </div>
      {suffix && <div className="flex-shrink-0">{suffix}</div>}
      {showArrow && (
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
      )}
    </button>
  );
}

/**
 * 分隔线
 */
export function ActionPanelDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-px bg-gray-100 dark:bg-gray-700/50 my-1 mx-2",
        className
      )}
    />
  );
}

/**
 * 分组标题
 */
interface ActionPanelGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 标题 */
  title: string;
}

export function ActionPanelGroup({
  title,
  children,
  className,
  ...props
}: ActionPanelGroupProps) {
  return (
    <div className={cn("py-1", className)} {...props}>
      <div className="px-3 py-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * 空状态
 */
interface ActionPanelEmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 图标 */
  icon?: React.ReactNode;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
}

export function ActionPanelEmpty({
  icon,
  title,
  description,
  className,
  ...props
}: ActionPanelEmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-8 text-center",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="mb-2 text-gray-300 dark:text-gray-600">{icon}</div>
      )}
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
      {description && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
          {description}
        </p>
      )}
    </div>
  );
}

/**
 * 底部操作栏
 */
export function ActionPanelFooter({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-2 pt-2 mt-1 border-t border-gray-100 dark:border-gray-700/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * 设置链接按钮
 */
interface ActionPanelSettingsLinkProps {
  href: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

export function ActionPanelSettingsLink({
  href,
  onClick,
  children = "设置",
}: ActionPanelSettingsLinkProps) {
  // 使用 Next.js Link 需要动态导入
  const handleClick = (e: React.MouseEvent) => {
    onClick?.();
    // 手动导航
    window.location.href = href;
    e.preventDefault();
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
    >
      <Settings className="w-3.5 h-3.5" />
      {children}
    </button>
  );
}

