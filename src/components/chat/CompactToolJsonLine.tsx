"use client";

import { useState } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CompactToolJson } from '@/lib/chat/compactToolJson';

export function CompactToolJsonLine({ tool }: { tool: CompactToolJson }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 max-w-full text-left text-xs text-slate-500 dark:text-slate-400",
          "hover:text-slate-700 dark:hover:text-slate-300 transition-colors rounded-md px-1 -mx-1"
        )}
        aria-expanded={expanded}
      >
        <Wrench className="w-3 h-3 shrink-0 opacity-70" />
        <span className="font-medium text-slate-600 dark:text-slate-300 truncate">{tool.name}</span>
        <span className="text-slate-400 dark:text-slate-500 truncate">· {tool.summary}</span>
        <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <pre className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-800/40 rounded-md px-2.5 py-2 overflow-x-auto border border-slate-200/50 dark:border-slate-700/50">
          {tool.raw}
        </pre>
      )}
    </div>
  );
}
