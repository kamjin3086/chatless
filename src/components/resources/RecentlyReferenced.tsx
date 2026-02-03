'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FileText, FileJson, FileCode, Clock } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface RecentReference {
  id: string;
  type: string;
  name: string;
  context: string;
  time: string;
  conversationId: string;
}

interface RecentlyReferencedProps {
  references: RecentReference[];
  onNavigate?: (convId: string) => void;
}

// 获取简约图标
const getIcon = (type: string) => {
  const t = type.toLowerCase();
  if (t === 'json') return <FileJson className="h-3.5 w-3.5 text-slate-400" />;
  if (['md', 'markdown', 'txt'].includes(t)) return <FileCode className="h-3.5 w-3.5 text-slate-400" />;
  return <FileText className="h-3.5 w-3.5 text-slate-400" />;
};

export function RecentlyReferenced({ references, onNavigate }: RecentlyReferencedProps) {
  const [hover, setHover] = useState(false);
  const visibleRefs = hover ? references : references.slice(0, 1);

  return (
    <div
      className="group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <h3 className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        最近引用
      </h3>

      {references.length === 0 ? (
        <div className="text-[11px] text-slate-400 py-1">暂无</div>
      ) : (
        <ScrollArea className={cn(
          'transition-all',
          hover ? 'h-32' : 'h-8'
        )}>
          <div className="space-y-0.5">
            {visibleRefs.map(ref => (
              <div
                key={ref.id}
                className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                onClick={() => onNavigate && (onNavigate as any)(ref.conversationId)}
              >
                <div className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 dark:bg-slate-800">
                  {getIcon(ref.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">{ref.name}</p>
                  {hover && (
                    <p className="truncate text-[10px] text-slate-400">{ref.time}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
} 