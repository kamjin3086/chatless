import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TranslationKey } from '@/i18n/types';
import {
  type AndroidDocumentAttachment,
  type AndroidDocumentPickStatus,
  getAndroidDocumentAttachment,
  pickAndroidDocumentAttachment,
  removeAndroidDocumentAttachment,
} from '@/lib/documents/android/androidDocumentAttachment';
import { useLocaleStore } from '@/store/localeStore';

const errors: Record<
  Exclude<AndroidDocumentPickStatus, 'cancelled'>,
  TranslationKey
> = {
  empty: 'androidDocument.empty',
  inaccessible: 'androidDocument.inaccessible',
  oversized: 'androidDocument.oversized',
  scanned: 'androidDocument.scanned',
  unsupported: 'androidDocument.unsupported',
};

type AttachmentState = {
  conversationId: string;
  attachment?: AndroidDocumentAttachment;
  busy?: boolean;
  error?: TranslationKey;
};

export function useAndroidDocumentAttachment(conversationId?: string) {
  const [state, setState] = useState<AttachmentState>();
  const activeScope = useRef<
    { conversationId: string; pending: boolean } | undefined
  >(undefined);
  useEffect(() => {
    if (!conversationId) return;
    const scope = { conversationId, pending: false };
    activeScope.current = scope;
    void getAndroidDocumentAttachment(conversationId).then(
      (attachment) => {
        if (activeScope.current === scope)
          setState({ conversationId, attachment });
      },
      () => {
        if (activeScope.current === scope)
          setState({ conversationId, error: 'androidDocument.inaccessible' });
      },
    );
    return () => {
      activeScope.current = undefined;
    };
  }, [conversationId]);

  const visible =
    conversationId && state?.conversationId === conversationId
      ? state
      : undefined;
  async function update(action: 'pick' | 'remove') {
    const scope = activeScope.current;
    if (
      !scope ||
      !visible ||
      scope.conversationId !== visible.conversationId ||
      scope.pending
    )
      return;
    const { conversationId, attachment } = visible;
    const stillInScope = () => activeScope.current === scope;
    scope.pending = true;
    setState({ conversationId, attachment, busy: true });
    let next: AttachmentState = { conversationId, attachment };
    try {
      if (action === 'pick') {
        const result = await pickAndroidDocumentAttachment(
          conversationId,
          stillInScope,
        );
        if (result.status === 'ready')
          next = { conversationId, attachment: result.attachment };
        else if (result.status !== 'cancelled')
          next.error = errors[result.status];
      } else if (attachment) {
        await removeAndroidDocumentAttachment(
          conversationId,
          attachment.handle,
        );
        next = {
          conversationId,
          attachment: await getAndroidDocumentAttachment(conversationId),
        };
      }
    } catch {
      next.error = 'androidDocument.inaccessible';
    } finally {
      scope.pending = false;
      if (stillInScope()) setState(next);
    }
  }

  return {
    state: visible,
    pick:
      visible && !visible.busy
        ? () => {
            void update('pick');
          }
        : undefined,
    remove: () => {
      void update('remove');
    },
  };
}

export function AndroidDocumentAttachmentStatus({
  state,
  disabled,
  onRemove,
}: {
  state?: AttachmentState;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useLocaleStore((s) => s.t);
  useLocaleStore((s) => s.locale);
  if (!state?.attachment && !state?.error && !state?.busy) return null;
  return (
    <div className="mb-2 rounded-lg border border-border px-3 py-2 text-xs">
      {state.attachment && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <FileText aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0 break-all font-medium">
              {state.attachment.name}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled || state.busy}
          >
            {t('androidDocument.remove')}
          </Button>
        </div>
      )}
      <div role="status" className="text-muted-foreground">
        {state.busy && <p>{t('androidDocument.working')}</p>}
        {state.error && <p className="text-destructive">{t(state.error)}</p>}
        {state.attachment && <p>{t('androidDocument.disclosure')}</p>}
      </div>
    </div>
  );
}
