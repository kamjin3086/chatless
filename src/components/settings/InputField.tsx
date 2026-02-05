import React, { useState, useId } from "react";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, HelpCircle } from "lucide-react";

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
  tooltip?: string; // 问号提示
  icon?: React.ReactNode;
  wrapperClassName?: string;
  inline?: boolean; // 行内显示：标签与输入框同一行
  labelWidthClassName?: string; // 行内模式下标签宽度，例如 w-28
}

export function InputField({
  label,
  description,
  tooltip,
  icon,
  wrapperClassName,
  className,
  type,
  inline,
  labelWidthClassName,
  ...props
}: InputFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = type === 'password';
  const inputHasValue = typeof props.value === 'string' ? props.value.length > 0 : (typeof props.defaultValue === 'string' ? (props.defaultValue).length > 0 : false);
  const shouldShowEye = isPassword && inputHasValue;
  const currentType = isPassword ? (showPassword ? 'text' : 'password') : type;
  const id = useId();

  return (
    <div className={cn("group mb-4", inline ? "flex items-center gap-3" : "", wrapperClassName)}>
      <div className={cn("flex items-center gap-1.5", inline ? "" : "mb-1.5")}>
        <label
          htmlFor={id}
          className={cn(
            "text-sm font-medium text-gray-700 dark:text-gray-300",
            inline ? cn(labelWidthClassName ?? "w-28", "mb-0") : ""
          )}
        >
          {label}
        </label>
        {tooltip && (
          <div className="group/tooltip relative">
            <HelpCircle className="w-3 h-3 text-slate-400 hover:text-slate-600 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 max-w-xs">
              {tooltip}
            </div>
          </div>
        )}
      </div>
      <div className={cn("relative", inline ? "flex-1" : "")}>
        {icon && (
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          id={id}
          {...props}
          type={currentType}
          className={cn(
            // 尺寸与层次：更柔和的边框与更统一的高度/圆角/字号
            "w-full h-9 px-3 bg-white/90 dark:bg-slate-800/60",
            "border border-slate-300/60 dark:border-slate-600/60 rounded-lg text-sm",
            "placeholder:text-slate-400 dark:placeholder:text-slate-500",
            "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400/40",
            "transition-all duration-200 hover:border-blue-400/30 dark:text-slate-200",
            icon ? "pl-10" : "",
            shouldShowEye ? "pr-10" : "",
            className
          )}
        />
        {shouldShowEye && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none"
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {description && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      )}
    </div>
  );
} 