import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import {
  forgetAndroidDirectory,
  getAndroidDirectorySelection,
  pickAndroidDirectory,
  type AndroidDirectorySelection as Selection,
} from '@/lib/documents/android/androidDirectorySelection';
import { useLocaleStore } from '@/store/localeStore';

export function AndroidDirectorySelection({
  conversationId,
}: { conversationId: string }) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const [selection, setSelection] = useState<Selection>();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const revision = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    async function refresh() {
      if (pending.current || document.visibilityState !== 'visible') return;
      const request = ++revision.current;
      const next = await getAndroidDirectorySelection(conversationId).catch(
        () => ({ status: 'unavailable' as const }),
      );
      if (request === revision.current) setSelection(next);
    }
    void refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      revision.current += 1;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [conversationId]);

  async function change(action: 'pick' | 'forget') {
    if (pending.current) return;
    pending.current = true;
    const request = ++revision.current;
    setWorking(true);
    setFailed(false);
    try {
      const next = await (action === 'pick'
        ? pickAndroidDirectory
        : forgetAndroidDirectory)(conversationId);
      if (request !== revision.current || next.status === 'cancelled') return;
      if (next.status === 'unavailable') setFailed(true);
      else setSelection(next);
    } catch {
      if (request === revision.current) setFailed(true);
    } finally {
      pending.current = false;
      if (request === revision.current) setWorking(false);
    }
  }

  const hasSelection =
    selection?.status === 'ready' || selection?.status === 'revoked';
  return (
    <section
      className="mx-auto max-w-3xl px-3 pb-1 text-xs"
      aria-label={t('androidDirectory.label')}
    >
      <div className="flex flex-wrap items-center gap-x-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          disabled={working}
          onClick={() => void change('pick')}
        >
          {t(
            hasSelection
              ? 'androidDirectory.reselect'
              : 'androidDirectory.choose',
          )}
        </Button>
        {hasSelection && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11"
            disabled={working}
            onClick={() => void change('forget')}
          >
            {t('androidDirectory.forget')}
          </Button>
        )}
        {selection?.status === 'ready' && (
          <span className="min-w-0 break-all" aria-live="polite">
            {selection.folder.name}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">
        {t('androidDirectory.disclosure')}
      </p>
      {(failed ||
        selection?.status === 'revoked' ||
        selection?.status === 'unavailable') && (
        <p className="text-muted-foreground" role="status">
          {t(
            failed || selection?.status === 'unavailable'
              ? 'androidDirectory.unavailable'
              : 'androidDirectory.revoked',
          )}
        </p>
      )}
    </section>
  );
}
