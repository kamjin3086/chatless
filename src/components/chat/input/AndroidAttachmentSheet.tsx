'use client';

import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  AndroidAttachmentActions,
  AndroidAttachmentDisclosures,
  type AndroidDocumentRow,
} from './AndroidAttachmentActions';
import type { AndroidAttachmentSelections } from './androidAttachmentSelection';

/**
 * Android's attachment surface: one bottom-anchored pane instead of the desktop popover.
 *
 * The pane owns its ceiling, its top corners, its header and its single scroll area, so
 * every row and both disclosure sentences scroll together and no text can leave the
 * surface. The pane is a dialog rather than a popover because that is what lets Escape -
 * and therefore the Back key, which dispatches it - dismiss it before the chat's own Back
 * handler navigates.
 *
 * `AndroidAttachmentSheetSurface` is the pane by itself, so its shape can be rendered and
 * asserted outside a dialog; `AndroidAttachmentSheet` puts that pane in Radix's dialog. The
 * heading is a node because the dialog needs its own Title element; outside a dialog the
 * heading is just the text that node renders.
 */
export function AndroidAttachmentSheetSurface({
  heading,
  children,
}: {
  heading: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="android-attachment-sheet"
      className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-slate-200 bg-white shadow-xl glass-overlay dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="shrink-0 border-b border-slate-100 px-4 pt-1.5 pb-2 dark:border-slate-700/50">
        <div
          aria-hidden="true"
          className="mx-auto mb-2 h-1 w-8 rounded-full bg-slate-300 dark:bg-slate-600"
        />
        {heading}
      </div>
      <div
        data-slot="android-attachment-sheet-scroll"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
      >
        {children}
      </div>
    </div>
  );
}

export function AndroidAttachmentSheet({
  open,
  onOpenChange,
  trigger,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9950] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[9950] flex outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <AndroidAttachmentSheetSurface
            heading={
              <DialogPrimitive.Title className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                {title}
              </DialogPrimitive.Title>
            }
          >
            {children}
          </AndroidAttachmentSheetSurface>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** What the pane holds: the Android pick/forget rows, then the disclosures that end it. */
export function AndroidAttachmentSheetContent({
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
  return (
    <>
      <AndroidAttachmentActions
        selections={selections}
        document={document}
        photoActionsDisabled={photoActionsDisabled}
        onCapturePhoto={onCapturePhoto}
        onPickPhoto={onPickPhoto}
        onAction={onAction}
      />
      <AndroidAttachmentDisclosures />
    </>
  );
}
