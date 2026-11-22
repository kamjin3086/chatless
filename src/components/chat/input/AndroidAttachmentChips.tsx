import { FolderOpen, Images } from 'lucide-react';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import {
  photoBatchCountLabel,
  type AndroidDirectoryState,
  type AndroidPhotoBatchState,
} from './androidAttachmentSelection';

const CHIP =
  'inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-500/20 bg-slate-500/8 px-2.5 py-1 text-xs font-medium text-slate-800 dark:border-slate-400/25 dark:text-slate-100';

/** The one state line worth interrupting for; a working folder picker says nothing extra. */
function attachmentNotice(
  t: (key: TranslationKey) => string,
  photoBatch: AndroidPhotoBatchState,
  directory: AndroidDirectoryState,
): string | null {
  if (photoBatch.working) return t('androidPhotos.preparing');
  if (photoBatch.failed) return t('androidPhotos.unavailable');
  if (directory.failed) return t('androidDirectory.unavailable');
  if (directory.revoked) return t('androidDirectory.revoked');
  return null;
}

/**
 * What this chat will send besides text: the picked photo batch and folder.
 *
 * The chips are state, not actions - picking, reselecting and forgetting all happen in the
 * attachment sheet, which also carries the disclosure sentences.
 */
export function AndroidAttachmentChips({
  photoBatch,
  directory,
}: {
  photoBatch: AndroidPhotoBatchState;
  directory: AndroidDirectoryState;
}) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);

  const photoLabel =
    photoBatch.count === null
      ? null
      : photoBatchCountLabel(photoBatch.count, t);
  const folderLabel = directory.folderName
    ? `${t('androidDirectory.chipPrefix')}${directory.folderName}`
    : null;
  const notice = attachmentNotice(t, photoBatch, directory);

  if (!photoLabel && !folderLabel && !notice) return null;

  return (
    <div
      className="mb-1.5 flex flex-wrap items-center gap-1.5 px-0.5"
      aria-label={t('androidAttachments.label')}
    >
      {photoLabel && (
        <span className={CHIP}>
          <Images aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 break-all">{photoLabel}</span>
        </span>
      )}
      {folderLabel && (
        <span className={CHIP}>
          <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 break-all">{folderLabel}</span>
        </span>
      )}
      {notice && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
