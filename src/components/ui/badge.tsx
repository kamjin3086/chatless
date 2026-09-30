import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-all duration-200 overflow-hidden shadow-sm",
  {
    variants: {
      variant: {
        default:
          "border-slate-300/50 dark:border-white/15 bg-slate-700 text-white [a&]:hover:bg-slate-800",
        secondary:
          "border-slate-200/60 dark:border-white/12 bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300 [a&]:hover:bg-slate-200 dark:[a&]:hover:bg-white/16",
        destructive:
          "border-red-300/50 dark:border-red-600/50 bg-red-600 text-white [a&]:hover:bg-red-700 focus-visible:ring-red-500/20 dark:focus-visible:ring-red-500/40",
        outline:
          "text-gray-700 dark:text-gray-300 border-gray-300/60 dark:border-gray-600/50 bg-white/60 dark:bg-gray-900/40 backdrop-blur-sm [a&]:hover:bg-gray-50 dark:[a&]:hover:bg-gray-800/60 [a&]:hover:border-gray-400/60",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
