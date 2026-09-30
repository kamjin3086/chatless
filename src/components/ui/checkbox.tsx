"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      "relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-slate-300/80 bg-white/60 dark:border-slate-600/60 dark:bg-white/8 cursor-pointer transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/30 focus-visible:ring-offset-2 ring-offset-white dark:ring-offset-slate-900",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className={cn(
        "absolute inset-0 rounded-[3px] glass-checkbox-on bg-sky-500/85 dark:bg-sky-400/75 text-white flex items-center justify-center"
      )}
    >
      <Check className="h-3 w-3" strokeWidth={2.5} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
