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
import type { Citation } from '@/lib/rag/evidenceTypes';
import type {
  CitationSourceReader,
  SourceReadMode,
} from '@/lib/rag/CitationSourceReader';

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
  const reader = useRef<CitationSourceReader | null>(null);
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
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
          setError(result.message);
          setText('');
          setCursor(undefined);
          return;
        }
        setText(result.text);
        setCursor(result.nextCursor);
        if (mode === 'current' || mode === 'exact')
          setCurrentVersion(mode === 'current');
      } catch (cause) {
        if (reader.current === source) {
          setError(
            cause instanceof Error ? cause.message : '来源读取失败，请重试。',
          );
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
      setError('请先打开引用所属的会话。');
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
          setError('来源读取器加载失败，请关闭面板后重试。');
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
      if (!(await source.openCurrentFile()) && reader.current === source)
        setError('未能打开当前原文件，请检查文件是否仍然存在。');
    } catch (cause) {
      if (reader.current === source)
        setError(cause instanceof Error ? cause.message : '原文件打开失败。');
    } finally {
      if (reader.current === source) setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
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
          <SheetDescription>
            历史引用保留快照；读取当前原文会重新检查会话挂载范围和文档版本。
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 space-y-6 py-4">
          <section aria-label="引用时快照">
            <h3 className="mb-2 text-sm font-medium">引用时快照</h3>
            <blockquote className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {citation.quote}
            </blockquote>
          </section>
          <section aria-label="当前原文" aria-busy={busy}>
            <h3 className="mb-2 text-sm font-medium">
              {currentVersion ? '当前版本（从文档开头读取）' : '引用对应原文'}
            </h3>
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="mb-3 text-sm text-muted-foreground">
                正在读取来源…
              </p>
            )}
            {!busy && !error && !text && (
              <p className="text-sm text-muted-foreground">
                此位置没有可读取的文本。
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
              引用位置
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
              相邻段落
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !cursor}
              onClick={() =>
                reader.current && void load(reader.current, 'more', cursor)
              }
            >
              下一段
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !reader.current}
              onClick={() =>
                reader.current && void load(reader.current, 'current')
              }
            >
              当前版本
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !reader.current}
              onClick={() => void openFile()}
            >
              打开当前文件
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            当前版本及原文件可能与历史引用不同；知识库已卸载或文档被删除时，仅保留快照。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
