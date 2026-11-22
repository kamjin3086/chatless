import { Camera, FileText, FolderOpen, Image, Images, X } from 'lucide-react';
import { ActionPanelItem } from '@/components/ui/action-panel';
import { cn } from '@/lib/utils';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import {
  photoBatchCountLabel,
  type AndroidAttachmentSelections,
} from './androidAttachmentSelection';

/** 48px: these rows are the sheet's only actions on a phone. */
const ROW = 'min-h-12 rounded-none';
/** One line between rows: the sheet is a list of choices, not a run of text. */
const ROW_GROUP = 'divide-y divide-slate-100 dark:divide-slate-700/50';

/** The document picker, when this build has one, as the sheet's last picker row. */
export interface AndroidDocumentRow {
  label: string;
  description?: string;
  attached: boolean;
  onPick: () => void;
}

/**
 * The ways to attach Android material to a chat, plus the forget actions for what is
 * already picked. Every entry here works on the phone; the desktop-only entries (skills,
 * prompts, workspace mentions, knowledge bases) are not part of this sheet at all.
 */
export function AndroidAttachmentActions({
  selections,
  document,
  photoActionsDisabled,
  onCapturePhoto,
  onPickPhoto,
  onAction,
}: {
  selections: AndroidAttachmentSelections;
  document?: AndroidDocumentRow;
  photoActionsDisabled?: boolean;
  onCapturePhoto?: () => void;
  onPickPhoto: () => void;
  onAction: (action: () => void) => void;
}) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const { photoBatch, directory } = selections;
  const photoCount = photoBatch.count;
  const folderName = directory.folderName;
  // A revoked grant has no name left but can still be forgotten, exactly like the old row.
  const folderHasSelection = folderName !== null || directory.revoked;
  const photoBusy = Boolean(photoActionsDisabled || photoBatch.working);

  return (
    <>
      <div className={ROW_GROUP}>
        {onCapturePhoto && (
          <ActionPanelItem
            className={ROW}
            icon={<Camera className="size-4 text-pink-500" />}
            title={t('androidPhoto.capture')}
            disabled={photoBusy}
            onClick={() => onAction(onCapturePhoto)}
          />
        )}
        <ActionPanelItem
          className={ROW}
          icon={<Image className="size-4 text-pink-500" />}
          title={t('androidPhoto.pick')}
          disabled={photoBusy}
          onClick={() => onAction(onPickPhoto)}
        />
        <ActionPanelItem
          className={ROW}
          icon={<Images className="size-4 text-pink-500" />}
          title={t('androidPhotos.batchPick')}
          description={
            photoCount === null
              ? undefined
              : photoBatchCountLabel(photoCount, t)
          }
          selected={photoCount !== null}
          disabled={photoBusy}
          onClick={() => onAction(selections.pickPhotoBatch)}
        />
        <ActionPanelItem
          className={ROW}
          icon={<FolderOpen className="size-4 text-amber-500" />}
          title={t('androidDirectory.choose')}
          description={
            folderName ??
            (directory.revoked ? t('androidDirectory.revoked') : undefined)
          }
          selected={folderName !== null}
          disabled={directory.working}
          onClick={() => onAction(selections.pickDirectory)}
        />
        {document && (
          <ActionPanelItem
            className={ROW}
            icon={
              <FileText
                className={cn(
                  'size-4',
                  document.attached ? 'text-amber-500' : 'text-amber-400',
                )}
              />
            }
            title={document.label}
            description={document.description}
            selected={document.attached}
            disabled={document.attached}
            onClick={() => onAction(document.onPick)}
          />
        )}
      </div>
      {(photoCount !== null || folderHasSelection) && (
        <div
          className={cn(
            'mt-2 border-t border-slate-100 pt-1 dark:border-slate-700/50',
            ROW_GROUP,
          )}
        >
          {photoCount !== null && (
            <ActionPanelItem
              className={ROW}
              icon={<X className="size-4 text-slate-500 dark:text-slate-400" />}
              title={t('androidPhotos.forget')}
              disabled={photoBatch.working}
              onClick={() => onAction(selections.forgetPhotoBatch)}
            />
          )}
          {folderHasSelection && (
            <ActionPanelItem
              className={ROW}
              icon={<X className="size-4 text-slate-500 dark:text-slate-400" />}
              title={t('androidDirectory.forget')}
              disabled={directory.working}
              onClick={() => onAction(selections.forgetDirectory)}
            />
          )}
        </div>
      )}
    </>
  );
}

/** Shown in the sheet only: nothing here is permanent body text in the chat. */
export function AndroidAttachmentDisclosures() {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <div className="mt-2 border-t border-slate-100 px-2 pt-2 text-[11px] leading-snug text-muted-foreground dark:border-slate-700/50">
      <p>{t('androidPhotos.disclosure')}</p>
      <p className="mt-1">{t('androidDirectory.disclosure')}</p>
    </div>
  );
}
