import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AndroidPhoto } from '@/lib/android/androidPhoto';
import { useLocaleStore } from '@/store/localeStore';
import type { AndroidPhotoFeedback } from './useAndroidPhotoDraft';

export function AndroidPhotoPreview({
  photo,
  providerName,
  modelId,
  status,
  feedback,
  disabled,
  onRemove,
}: {
  photo?: AndroidPhoto;
  providerName?: string;
  modelId?: string;
  status: AndroidPhotoFeedback;
  feedback?: AndroidPhotoFeedback | null;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useLocaleStore((state) => state.t);
  useLocaleStore((state) => state.locale);
  if (!photo && !feedback) return null;
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-border p-2 text-sm">
      {photo && (
        <div className="flex items-start gap-2">
          <img
            src={photo.dataUrl}
            alt={t('androidPhoto.preview')}
            className="size-20 shrink-0 rounded-md object-contain"
          />
          <div className="min-w-0 flex-1 break-words" role="status">
            <p>
              {t('androidPhoto.recipient')}: <strong>{modelId || '—'}</strong>
              {providerName && ` (${providerName})`}
            </p>
            <p className="text-muted-foreground">
              {t(`androidPhoto.${status}`)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-12 shrink-0"
            aria-label={t('androidPhoto.remove')}
            disabled={disabled}
            onClick={onRemove}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      {feedback && (!photo || feedback !== status) && (
        <p role="status">{t(`androidPhoto.${feedback}`)}</p>
      )}
    </div>
  );
}
