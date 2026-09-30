"use client"

import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
  id?: string;
}

const sizeCfg = {
  sm: { track: "h-5 w-9", thumb: "size-4", on: "translate-x-4" },
  md: { track: "h-6 w-11", thumb: "size-5", on: "translate-x-5" },
  lg: { track: "h-7 w-14", thumb: "size-6", on: "translate-x-7" },
} as const;

const SwitchImpl = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked = false,
      onCheckedChange,
      disabled = false,
      className,
      size = "md",
      id,
    },
    ref
  ) => {
    const cfg = sizeCfg[size];

    return (
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        data-slot="switch"
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          "glass-switch-track inline-flex shrink-0 items-center rounded-full p-0.5 align-middle transition-colors duration-200 ease-out",
          cfg.track,
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          checked
            ? "glass-switch-on bg-sky-500 dark:bg-sky-400"
            : "bg-slate-300 dark:bg-slate-600",
          className
        )}
      >
        <span
          aria-hidden
          className={cn(
            "glass-switch-knob pointer-events-none block shrink-0 rounded-full shadow-sm ring-0 transition-transform duration-200 ease-out will-change-transform",
            cfg.thumb,
            checked ? cfg.on : "translate-x-0"
          )}
        />
      </button>
    );
  }
);

SwitchImpl.displayName = "Switch";

export { SwitchImpl as Switch };
