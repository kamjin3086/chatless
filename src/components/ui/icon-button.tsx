import * as React from "react";
import { cn } from "@/lib/utils";
import { VariantProps, cva } from "class-variance-authority";

const iconButtonVariants = cva(
  "inline-flex items-center justify-center cursor-pointer rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:pointer-events-none shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-blue-600 text-white hover:bg-blue-700",
        secondary:
          "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
      },
      size: {
        default: "h-8 w-8",
        sm: "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
);

interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  icon: React.ElementType;
  title?: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
);
IconButton.displayName = "IconButton"; 