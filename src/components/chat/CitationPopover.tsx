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
import { useLocaleStore } from '@/store/localeStore';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';

function formatLocator(
  citation: Citation,
  t: (key: TranslationKey) => string,
): string {
  const loc = citation.locator;
  const parts: string[] = [];
  if (loc.page != null)
    parts.push(
      t('chatUi.citation.page').replace('{0}', () => String(loc.page)),
    );
  if (loc.sectionPath?.length) parts.push(loc.sectionPath.join(' > '));
  if (loc.lineStart != null) {
    const range =
      loc.lineEnd != null && loc.lineEnd !== loc.lineStart
        ? `${loc.lineStart}–${loc.lineEnd}`
        : `${loc.lineStart}`;
    parts.push(t('chatUi.citation.lines').replace('{0}', () => range));
  }
  const first = citation.range?.chunks[0];
  return (
    parts.join(' · ') ||
    (first
      ? t('chatUi.citation.chunk')
          .replace('{0}', () => String(first.chunkIndex + 1))
          .replace('{1}', () => String(first.startOffset))
          .replace('{2}', () => String(first.endOffset))
      : t('chatUi.citation.unknownLocation'))
  );
}

export function CitationPopover({
  citation,
  disabled,
}: { citation: Citation; disabled?: boolean }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const conversationId = useChatStore((state) => state.currentConversationId);
  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('chatUi.citation.view').replace('{0}', () =>
              String(citation.n),
            )}
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
                {formatLocator(citation, t)}
              </p>
              {citation.stale && (
                <p className="text-xs text-amber-600 mt-1">
                  {t('chatUi.citation.staleSource')}
                </p>
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
            {t('chatUi.citation.viewSource')}
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
