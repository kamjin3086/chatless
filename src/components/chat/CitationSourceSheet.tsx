'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetBody,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { TranslationKey } from '@/i18n/types';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';
import type { Citation } from '@/lib/rag/evidenceTypes';
import type {
  CitationSourceReader,
  SourceReadMode,
} from '@/lib/rag/CitationSourceReader';

function sourceErrorKey(code: string): TranslationKey {
  switch (code) {
    case 'NO_CONTINUATION':
      return 'citationSource.noContinuation';
    case 'CURSOR_INVALID':
      return 'citationSource.locationUnavailable';
    case 'INDEX_NOT_READY':
      return 'citationSource.indexNotReady';
    case 'FILE_MISSING':
      return 'citationSource.fileMissing';
    case 'FILE_OPEN_FAILED':
      return 'citationSource.fileOpenFailed';
    default:
      return 'citationSource.unavailable';
  }
}

export function CitationSourceSheet({
  citation,
  conversationId,
  open,
  onOpenChange,
}: {
  citation: Citation;
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslation();
  const reader = useRef<CitationSourceReader | null>(null);
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey>();
  const [currentVersion, setCurrentVersion] = useState(false);

  const load = useCallback(
    async (
      source: CitationSourceReader,
      mode: SourceReadMode,
      next?: string,
    ) => {
      setBusy(true);
      setError(undefined);
      try {
        const result = await source.read(mode, next);
        if (reader.current !== source) return;
        if (!result.ok) {
          setError(sourceErrorKey(result.code));
          setText('');
          setCursor(undefined);
          return;
        }
        setText(result.text);
        setCursor(result.nextCursor);
        if (mode === 'current' || mode === 'exact')
          setCurrentVersion(mode === 'current');
      } catch {
        if (reader.current === source) {
          setError('citationSource.readFailed');
          setText('');
          setCursor(undefined);
        }
      } finally {
        if (reader.current === source) setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    let owned: CitationSourceReader | undefined;
    setText('');
    setCursor(undefined);
    setError(undefined);
    setCurrentVersion(false);
    setBusy(false);
    if (!conversationId) {
      setError('citationSource.conversationRequired');
      return;
    }
    setBusy(true);
    void import('@/lib/rag/CitationSourceReader')
      .then(({ CitationSourceReader: Reader }) => {
        if (!active) return;
        owned = new Reader(citation, conversationId);
        reader.current = owned;
        return load(owned, owned.hasExactLocation ? 'exact' : 'current');
      })
      .catch(() => {
        if (active) {
          setError('citationSource.readerLoadFailed');
          setBusy(false);
        }
      });
    return () => {
      active = false;
      reader.current = null;
      owned?.dispose();
    };
  }, [open, conversationId, citation, load]);

  async function openFile() {
    const source = reader.current;
    if (!source) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await source.openCurrentFile(
        useLocaleStore.getState().locale,
      );
      if (!result.ok && reader.current === source)
        setError(sourceErrorKey(result.code));
    } catch {
      if (reader.current === source) setError('citationSource.openFailed');
    } finally {
      if (reader.current === source) setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        closeLabel={t('common.close')}
        className="flex w-full flex-col sm:max-w-xl"
        style={{
          top: 'var(--titlebar-height, 0px)',
          height: 'calc(100dvh - var(--titlebar-height, 0px))',
        }}
      >
        <SheetHeader className="pr-6 text-start">
          <SheetTitle
            className="break-words line-clamp-3"
            title={citation.documentName}
          >
            {citation.documentName}
          </SheetTitle>
          <SheetDescription>{t('citationSource.description')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 space-y-6 py-4">
          <section aria-label={t('citationSource.snapshot')}>
            <h3 className="mb-2 text-sm font-medium">
              {t('citationSource.snapshot')}
            </h3>
            <blockquote className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {citation.quote}
            </blockquote>
          </section>
          <section
            data-citation-source-text
            aria-label={t('citationSource.original')}
            aria-busy={busy}
          >
            <h3 className="mb-2 text-sm font-medium">
              {t(
                currentVersion
                  ? 'citationSource.currentHeading'
                  : 'citationSource.exactHeading',
              )}
            </h3>
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {t(error)}
              </p>
            )}
            {busy && (
              <p role="status" className="mb-3 text-sm text-muted-foreground">
                {t('citationSource.loading')}
              </p>
            )}
            {!busy && !error && !text && (
              <p className="text-sm text-muted-foreground">
                {t('citationSource.empty')}
              </p>
            )}
            {text && (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {text}
              </div>
            )}
          </section>
        </SheetBody>
        <div className="space-y-3 px-6 pb-6">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !reader.current?.hasExactLocation}
              onClick={() =>
                reader.current && void load(reader.current, 'exact')
              }
            >
              {t('citationSource.exact')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                !reader.current ||
                (!reader.current.hasExactLocation && !text)
              }
              onClick={() =>
                reader.current && void load(reader.current, 'neighbors')
              }
            >
              {t('citationSource.neighbors')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !cursor}
              onClick={() =>
                reader.current && void load(reader.current, 'more', cursor)
              }
            >
              {t('citationSource.more')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !reader.current}
              onClick={() =>
                reader.current && void load(reader.current, 'current')
              }
            >
              {t('citationSource.current')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !reader.current}
              onClick={() => void openFile()}
            >
              {t('citationSource.openFile')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('citationSource.versionNote')}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
