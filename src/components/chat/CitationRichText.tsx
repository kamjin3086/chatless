"use client";

import type { Citation } from '@/lib/rag/evidenceTypes';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FileText } from 'lucide-react';

function formatLocator(loc: Citation['locator']): string {
  const parts: string[] = [];
  if (loc.page != null) parts.push(`第 ${loc.page} 页`);
  if (loc.sectionPath?.length) parts.push(loc.sectionPath.join(' > '));
  if (loc.lineStart != null) {
    parts.push(`行 ${loc.lineStart}${loc.lineEnd != null && loc.lineEnd !== loc.lineStart ? `–${loc.lineEnd}` : ''}`);
  }
  return parts.join(' · ') || '未知位置';
}

export function CitationRichText({
  text,
  citations,
  isStreaming,
}: {
  text: string;
  citations?: Citation[];
  isStreaming?: boolean;
}) {
  if (!citations?.length) {
    return <>{text}</>;
  }

  const byN = new Map(citations.map((c) => [c.n, c]));
  const parts = text.split(/(\[\d+\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return <span key={i}>{part}</span>;
        const cite = byN.get(Number(m[1]));
        if (!cite) return <span key={i}>{part}</span>;
        return (
          <Popover key={i}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="mx-0.5 inline-flex items-center rounded-md px-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                disabled={isStreaming}
              >
                [{cite.n}]
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 max-h-72 overflow-y-auto text-sm" align="start">
              <div className="flex items-start gap-2 mb-2">
                <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{cite.documentName}</p>
                  <p className="text-xs text-muted-foreground">{formatLocator(cite.locator)}</p>
                  {cite.stale && (
                    <p className="text-xs text-amber-600 mt-1">来源文档已变化</p>
                  )}
                </div>
              </div>
              <blockquote className="border-l-2 pl-2 text-muted-foreground whitespace-pre-wrap text-xs">
                {cite.quote}
              </blockquote>
            </PopoverContent>
          </Popover>
        );
      })}
    </>
  );
}
