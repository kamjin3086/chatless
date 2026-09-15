import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-slate-200/70 bg-white/50 dark:border-slate-700/50 dark:bg-white/6 backdrop-blur-sm px-3 py-2 text-sm transition-all duration-200 placeholder:text-slate-400/90 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/25 focus-visible:border-slate-400/55 hover:border-slate-300/80 dark:hover:border-slate-600/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-100 glass-field resize-none",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea } 