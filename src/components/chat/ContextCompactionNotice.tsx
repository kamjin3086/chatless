"use client";

import { useState } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContextCompactionStore } from '@/store/contextCompactionStore';

/**
 * "历史已压缩"标记：默认只显示一行，点开才看摘要正文。
 * 自己订阅 store，不牵连外层已 memo 的消息组件。
 */
export function ContextCompactionNotice({ messageId }: { messageId: string }) {
  const notice = useContextCompactionStore((state) => state.notices[messageId]);
  const [open, setOpen] = useState(false);

  if (!notice) return null;

  return (
    <div className="mx-4 mb-1 text-[11px] text-slate-400 dark:text-slate-500">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-slate-600 dark:hover:text-slate-300"
        title="较早的历史已被摘要，模型看到的是摘要 + 最近几轮完整对话"
      >
        <Layers className="h-3 w-3" />
        <span>历史已压缩 {notice.coveredMessages} 条</span>
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200/60 bg-slate-50/70 p-2 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
          {notice.summary}
        </pre>
      )}
    </div>
  );
}
