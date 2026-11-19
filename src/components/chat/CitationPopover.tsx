'use client';

import { useState } from 'react';
import type { Citation } from '@/lib/rag/evidenceTypes';
import { useChatStore } from '@/store/chatStore';
import { Button } from '@/components/ui/button';
import { CitationSourceSheet } from './CitationSourceSheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { FileText } from 'lucide-react';

function formatLocator(citation: Citation): string {
  const loc = citation.locator;
  const parts: string[] = [];
  if (loc.page != null) parts.push(`第 ${loc.page} 页`);
  if (loc.sectionPath?.length) parts.push(loc.sectionPath.join(' > '));
  if (loc.lineStart != null) {
    parts.push(
      `行 ${loc.lineStart}${loc.lineEnd != null && loc.lineEnd !== loc.lineStart ? `–${loc.lineEnd}` : ''}`,
    );
  }
  const first = citation.range?.chunks[0];
  return (
    parts.join(' · ') ||
    (first
      ? `片段 ${first.chunkIndex + 1} · 偏移 ${first.startOffset}–${first.endOffset}`
      : '未知位置')
  );
}

export function CitationPopover({
  citation,
  disabled,
}: { citation: Citation; disabled?: boolean }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const conversationId = useChatStore((state) => state.currentConversationId);
  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`查看引用 ${citation.n}`}
            className="mx-0.5 inline-flex items-center rounded-md px-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            disabled={disabled}
          >
            [{citation.n}]
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 max-h-72 overflow-y-auto text-sm"
          align="start"
          onCloseAutoFocus={(event) => {
            if (sourceOpen) event.preventDefault();
          }}
        >
          <div className="flex items-start gap-2 mb-2">
            <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <div className="min-w-0 break-words">
              <p className="font-medium">{citation.documentName}</p>
              <p className="text-xs text-muted-foreground">
                {formatLocator(citation)}
              </p>
              {citation.stale && (
                <p className="text-xs text-amber-600 mt-1">来源文档已变化</p>
              )}
            </div>
          </div>
          <blockquote className="border-l-2 pl-2 text-muted-foreground whitespace-pre-wrap break-words text-xs">
            {citation.quote}
          </blockquote>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => {
              setPopoverOpen(false);
              setSourceOpen(true);
            }}
          >
            查看原文
          </Button>
        </PopoverContent>
      </Popover>
      <CitationSourceSheet
        citation={citation}
        conversationId={conversationId}
        open={sourceOpen}
        onOpenChange={setSourceOpen}
      />
    </>
  );
}
