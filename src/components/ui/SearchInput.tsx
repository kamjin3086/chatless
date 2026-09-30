"use client";
import React from "react";
import { cn } from "@/lib/utils";

export type SearchInputVariant =
  | "basic"            // 简洁基础型
  | "withIcon"         // 内嵌图标型
  | "underlineAnimated"// 动效下划线型
  | "withButton"       // 按钮组合型
  | "bold";            // 加粗底边

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onSubmit"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  variant?: SearchInputVariant;
  onSubmit?: () => void;
  allowClear?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索…",
  variant = "withIcon",
  onSubmit,
  className,
  allowClear = false,
  ...rest
}: SearchInputProps) {
  if (variant === "underlineAnimated") {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <input
          {...rest}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="glass-field w-full h-8 py-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white/50 dark:bg-white/6 text-sm text-slate-800 dark:text-slate-100 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/25 focus-visible:border-slate-400/55 transition-colors duration-200"
          onKeyDown={(e)=>{ if (e.key === 'Enter') onSubmit?.(); }}
        />
      </div>
    );
  }

  if (variant === "withButton") {
    return (
      <div className={cn("flex items-center gap-1 rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white/50 dark:bg-white/6 glass-field", className)}>
        <input
          {...rest}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="flex-1 min-w-0 h-8 py-1.5 pl-2.5 border-0 bg-transparent text-slate-800 dark:text-slate-100 text-sm appearance-none focus:outline-none focus-visible:ring-0"
          onKeyDown={(e)=>{ if (e.key === 'Enter') onSubmit?.(); }}
        />
        <button type="button" className="p-1.5 mr-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200" onClick={onSubmit}>
          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </button>
      </div>
    );
  }

  if (variant === "bold") {
    return (
      <input
        {...rest}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(
          "glass-field w-full h-8 py-1.5 px-3 rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white/50 dark:bg-white/6 text-sm text-slate-800 dark:text-slate-100 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/25 focus-visible:border-slate-400/55 transition-colors duration-200",
          className
        )}
        onKeyDown={(e)=>{ if (e.key === 'Enter') onSubmit?.(); }}
      />
    );
  }

  if (variant === "basic") {
    return (
      <input
        {...rest}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(
          "glass-field w-full h-8 py-1.5 px-3 rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white/50 dark:bg-white/6 text-sm text-slate-800 dark:text-slate-100 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/25 focus-visible:border-slate-400/55 transition-colors duration-200",
          className
        )}
        onKeyDown={(e)=>{ if (e.key === 'Enter') onSubmit?.(); }}
      />
    );
  }

  // withIcon (默认) — 玻璃主题下与 glass-field 一致的框式搜索
  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none">
        <svg className="w-4 h-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      </div>
      {allowClear && value && (
        <button
          type="button"
          aria-label="clear"
          className="absolute inset-y-0 right-1 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          onClick={() => {
            const ev = { target: { value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;
            onChange(ev);
          }}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      )}
      <input
        {...rest}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="glass-field w-full h-8 py-1.5 pl-8 pr-6 rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white/50 dark:bg-white/6 text-sm text-slate-800 dark:text-slate-100 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/25 focus-visible:border-slate-400/55 transition-colors duration-200"
        onKeyDown={(e)=>{ if (e.key === 'Enter') onSubmit?.(); }}
      />
    </div>
  );
}


