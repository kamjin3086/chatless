import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-400/40 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-slate-800 text-white hover:bg-slate-900 active:bg-slate-950 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white dark:active:bg-slate-100",
        soft:
          "bg-slate-100/90 text-slate-700 hover:bg-slate-200/90 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/16",
        destructive:
          "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
        outline:
          "border border-slate-200/80 bg-white/50 hover:bg-slate-50 hover:border-slate-300/80 dark:bg-white/5 dark:border-white/12 dark:hover:bg-white/10 dark:hover:border-white/18",
        secondary:
          "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/16",
        ghost:
          "hover:bg-slate-100/80 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-slate-100",
        link: "text-slate-600 underline-offset-4 hover:underline dark:text-slate-300",
        dialogPrimary:
          "bg-slate-800 text-white hover:bg-slate-900 active:bg-slate-950 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white",
        dialogSecondary:
          "bg-white/70 text-slate-700 border border-slate-200/80 hover:bg-slate-50 hover:border-slate-300/80 dark:bg-white/8 dark:text-slate-200 dark:border-white/12 dark:hover:bg-white/12",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-11 rounded-lg px-6 has-[>svg]:px-4 text-base",
        icon: "size-9 p-0",
        "icon-sm": "size-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
