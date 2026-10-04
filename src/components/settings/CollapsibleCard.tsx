import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CollapsibleCardProps {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleCard({ title, icon: Icon, defaultOpen = false, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible defaultOpen={defaultOpen} className="setting-collapse mb-3">
      <CollapsibleTrigger className="setting-collapse-trigger text-left">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          <Icon className="w-4 h-4 flex-shrink-0" />
          <span>{title}</span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-500 transition-transform duration-200",
            open ? "rotate-180" : "rotate-0"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="setting-collapse-content">
        <div className="border-t border-slate-100 dark:border-slate-700/50 pt-4 space-y-6">
            {children}
          </div>
        </CollapsibleContent>
    </Collapsible>
  );
} 