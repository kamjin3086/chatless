import { useCallback, useEffect, useRef, useState } from 'react';
import {
  forgetAndroidPhotoBatch,
  getAndroidPhotoBatchSelection,
  pickAndroidPhotoBatch,
  type AndroidPhotoBatchSelection,
} from '@/lib/android/androidPhotoBatch';
import {
  forgetAndroidDirectory,
  getAndroidDirectorySelection,
  pickAndroidDirectory,
  type AndroidDirectorySelection,
} from '@/lib/documents/android/androidDirectorySelection';
import type { TranslationKey } from '@/i18n/types';

export type AndroidPhotoBatchState = {
  /** Selected photo count; null when this chat holds no batch. */
  count: number | null;
  working: boolean;
  /** The last pick or forget failed. */
  failed: boolean;
};

export type AndroidDirectoryState = {
  folderName: string | null;
  working: boolean;
  failed: boolean;
  /** The stored grant is gone, so the folder has to be picked again. */
  revoked: boolean;
};

export type AndroidAttachmentSelections = {
  photoBatch: AndroidPhotoBatchState;
  directory: AndroidDirectoryState;
  pickPhotoBatch: () => void;
  forgetPhotoBatch: () => void;
  pickDirectory: () => void;
  forgetDirectory: () => void;
};

const NO_PHOTO_BATCH: AndroidPhotoBatchState = {
  count: null,
  working: false,
  failed: false,
};

const NO_DIRECTORY: AndroidDirectoryState = {
  folderName: null,
  working: false,
  failed: false,
  revoked: false,
};

/** What the chips and the sheet read from a native batch reply. */
export function photoBatchState(
  next: AndroidPhotoBatchSelection,
): AndroidPhotoBatchState {
  return {
    count: next.status === 'ready' ? next.count : null,
    working: false,
    failed: next.status === 'unavailable',
  };
}

/** What the chips and the sheet read from a native folder reply. */
export function directoryState(
  next: AndroidDirectorySelection,
): AndroidDirectoryState {
  return {
    folderName: next.status === 'ready' ? next.folder.name : null,
    working: false,
    failed: next.status === 'unavailable',
    revoked: next.status === 'revoked',
  };
}

/** "3 张照片" / "3 photos" - the chip and the sheet state read the same count. */
export function photoBatchCountLabel(
  count: number,
  t: (key: TranslationKey) => string,
): string {
  return `${count} ${t(count === 1 ? 'androidPhotos.countUnitOne' : 'androidPhotos.countUnitMany')}`;
}

/**
 * The Android photo batch and folder selection of one conversation.
 *
 * Both selections live in the native layer, keyed by conversation id: this hook only
 * mirrors them for the composer chips and the attachment sheet, and every action is one
 * native pick or forget. Nothing here uploads or reads the picked material.
 */
export function useAndroidAttachmentSelections(
  conversationId?: string,
): AndroidAttachmentSelections {
  const [photoBatch, setPhotoBatch] =
    useState<AndroidPhotoBatchState>(NO_PHOTO_BATCH);
  const [directory, setDirectory] =
    useState<AndroidDirectoryState>(NO_DIRECTORY);
  const photoPending = useRef(false);
  const directoryPending = useRef(false);
  const directoryRevision = useRef(0);

  useEffect(() => {
    setPhotoBatch(NO_PHOTO_BATCH);
    setDirectory(NO_DIRECTORY);
    if (!conversationId) return;
    let current = true;

    void getAndroidPhotoBatchSelection(conversationId)
      .then((next) => {
        if (current) setPhotoBatch(photoBatchState(next));
      })
      .catch(() => {
        if (current) setPhotoBatch({ ...NO_PHOTO_BATCH, failed: true });
      });

    // A stored folder grant can disappear while the app is in the background, so the
    // folder state is re-read whenever this surface becomes visible again.
    async function refreshDirectory() {
      if (directoryPending.current || document.visibilityState !== 'visible')
        return;
      const request = ++directoryRevision.current;
      const next = await getAndroidDirectorySelection(conversationId!).catch(
        () => ({ status: 'unavailable' as const }),
      );
      if (current && request === directoryRevision.current)
        setDirectory(directoryState(next));
    }
    void refreshDirectory();
    window.addEventListener('focus', refreshDirectory);
    document.addEventListener('visibilitychange', refreshDirectory);
    return () => {
      current = false;
      directoryRevision.current += 1;
      window.removeEventListener('focus', refreshDirectory);
      document.removeEventListener('visibilitychange', refreshDirectory);
    };
  }, [conversationId]);

  const changePhotoBatch = useCallback(
    async (action: 'pick' | 'forget') => {
      if (photoPending.current || !conversationId) return;
      photoPending.current = true;
      setPhotoBatch((previous) => ({
        ...previous,
        working: true,
        failed: false,
      }));
      try {
        const next = await (action === 'pick'
          ? pickAndroidPhotoBatch
          : forgetAndroidPhotoBatch)(conversationId);
        // A cancelled picker or a second request in flight keeps the current batch.
        if (next.status === 'cancelled' || next.status === 'busy') {
          setPhotoBatch((previous) => ({ ...previous, working: false }));
          return;
        }
        setPhotoBatch(photoBatchState(next));
      } catch {
        setPhotoBatch((previous) => ({
          ...previous,
          working: false,
          failed: true,
        }));
      } finally {
        photoPending.current = false;
      }
    },
    [conversationId],
  );

  const changeDirectory = useCallback(
    async (action: 'pick' | 'forget') => {
      if (directoryPending.current || !conversationId) return;
      directoryPending.current = true;
      const request = ++directoryRevision.current;
      setDirectory((previous) => ({
        ...previous,
        working: true,
        failed: false,
      }));
      try {
        const next = await (action === 'pick'
          ? pickAndroidDirectory
          : forgetAndroidDirectory)(conversationId);
        if (
          request === directoryRevision.current &&
          next.status !== 'cancelled'
        )
          setDirectory(directoryState(next));
      } catch {
        if (request === directoryRevision.current)
          setDirectory((previous) => ({
            ...previous,
            working: false,
            failed: true,
          }));
      } finally {
        directoryPending.current = false;
        if (request === directoryRevision.current)
          setDirectory((previous) =>
            previous.working ? { ...previous, working: false } : previous,
          );
      }
    },
    [conversationId],
  );

  const pickPhotoBatch = useCallback(
    () => void changePhotoBatch('pick'),
    [changePhotoBatch],
  );
  const forgetPhotoBatch = useCallback(
    () => void changePhotoBatch('forget'),
    [changePhotoBatch],
  );
  const pickDirectory = useCallback(
    () => void changeDirectory('pick'),
    [changeDirectory],
  );
  const forgetDirectory = useCallback(
    () => void changeDirectory('forget'),
    [changeDirectory],
  );

  return {
    photoBatch,
    directory,
    pickPhotoBatch,
    forgetPhotoBatch,
    pickDirectory,
    forgetDirectory,
  };
}
