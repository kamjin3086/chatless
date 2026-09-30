"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  value: number[];
  onValueChange: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  id?: string;
}

// 切换为原生 range（只保留配色），稳定兼容
const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, id }, ref) => {
    const cur = value?.[0] ?? min;
    const pct = (cur - min) / Math.max(1, (max - min));

    return (
      <input
        ref={ref}
        type="range"
        id={id}
        className={cn(
          'w-full h-1.5 rounded-full appearance-none cursor-pointer',
          'bg-gray-200 dark:bg-gray-700',
          // Thumb (WebKit)
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-500',
          '[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150',
          '[&::-webkit-slider-thumb]:hover:scale-105',
          // Thumb (Firefox)
          '[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4',
          '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-500',
          '[&::-moz-range-thumb]:shadow-md',
          // Track
          '[&::-webkit-slider-track]:rounded-full [&::-webkit-slider-track]:h-1.5',
          '[&::-moz-range-track]:rounded-full [&::-moz-range-track]:h-1.5',
          className
        )}
        style={{
          background: `linear-gradient(to right, rgb(59 130 246) 0%, rgb(59 130 246) ${Math.max(0, Math.min(100, pct * 100))}%, var(--slider-rest, rgb(229 231 235)) ${Math.max(0, Math.min(100, pct * 100))}%, var(--slider-rest, rgb(229 231 235)) 100%)`,
        }}
        value={cur}
        onInput={(e)=>onValueChange([parseFloat((e.target as HTMLInputElement).value)])}
        onChange={(e)=>onValueChange([parseFloat((e.target as HTMLInputElement).value)])}
        min={min}
        max={max}
        step={step}
      />
    );
  }
);

Slider.displayName = "Slider";

export { Slider }; 