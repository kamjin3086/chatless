import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import {
  forgetAndroidPhotoBatch,
  getAndroidPhotoBatchSelection,
  pickAndroidPhotoBatch,
  type AndroidPhotoBatchSelection as Selection,
} from '@/lib/android/androidPhotoBatch';
import { useLocaleStore } from '@/store/localeStore';

export function AndroidPhotoBatchSelection({
  conversationId,
}: { conversationId: string }) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const [selection, setSelection] = useState<Selection>();
  const [working, setWorking] = useState<'pick' | 'forget' | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let current = true;
    void getAndroidPhotoBatchSelection(conversationId)
      .then((next) => {
        if (current) setSelection(next);
      })
      .catch(() => {
        if (current) setSelection({ status: 'unavailable' });
      });
    return () => {
      current = false;
    };
  }, [conversationId]);

  async function change(action: 'pick' | 'forget') {
    if (pending.current) return;
    pending.current = true;
    setWorking(action);
    setFailed(false);
    try {
      const next = await (action === 'pick'
        ? pickAndroidPhotoBatch
        : forgetAndroidPhotoBatch)(conversationId);
      // A cancelled picker or a second request in flight keeps the current batch.
      if (next.status === 'cancelled' || next.status === 'busy') return;
      if (next.status === 'unavailable') setFailed(true);
      else setSelection(next);
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setWorking(null);
    }
  }

  const count = selection?.status === 'ready' ? selection.count : null;
  return (
    <section
      className="mx-auto max-w-3xl px-3 pb-1 text-xs"
      aria-label={t('androidPhotos.label')}
    >
      <div className="flex flex-wrap items-center gap-x-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          disabled={working !== null}
          onClick={() => void change('pick')}
        >
          {t(
            count === null ? 'androidPhotos.choose' : 'androidPhotos.reselect',
          )}
        </Button>
        {count !== null && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11"
              disabled={working !== null}
              onClick={() => void change('forget')}
            >
              {t('androidPhotos.forget')}
            </Button>
            <span className="min-w-0 break-all" aria-live="polite">
              {t('androidPhotos.selected')}: {count}
            </span>
          </>
        )}
      </div>
      <p className="text-muted-foreground">{t('androidPhotos.disclosure')}</p>
      {working === 'pick' && (
        <p role="status">{t('androidPhotos.preparing')}</p>
      )}
      {(failed || selection?.status === 'unavailable') && (
        <p className="text-muted-foreground" role="status">
          {t('androidPhotos.unavailable')}
        </p>
      )}
    </section>
  );
}
