import { cn } from "@/lib/utils";

interface SectionCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  hoverable?: boolean;
  variant?: 'default' | 'flat';
}

export function SectionCard({ children, className, onClick, selected=false, hoverable=true, variant='default' }: SectionCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        variant === 'default'
          ? "rounded-md border glass-panel bg-white dark:bg-slate-900 text-left shadow-sm transition group border-slate-200 dark:border-slate-700"
          : "rounded-lg text-left transition group bg-transparent shadow-none border-0",
        hoverable && (variant === 'default' ? "hover:shadow-md cursor-pointer" : "cursor-pointer"),
        selected && "ring-2 ring-slate-400/35 bg-slate-100/60 dark:ring-slate-500/35 dark:bg-white/10",
        className
      )}
    >
      {children}
    </div>
  );
} 