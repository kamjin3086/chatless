import type { AndroidPhoto } from '@/lib/android/androidPhoto';
import {
  type AndroidPhotoDraftSnapshot,
  type AndroidPhotoRecipient,
  type AndroidPhotoSendCallbacks,
  type AndroidPhotoSendOptions,
  AndroidPhotoSendRejection,
  sendAndroidPhoto,
  shouldClearPhotoDraft,
} from '@/lib/android/androidPhotoSend';

interface AndroidPhotoHandoffDraft {
  photo: AndroidPhoto;
  text: string;
}

interface AndroidPhotoHandoffEntry extends AndroidPhotoHandoffDraft {
  conversationId: string;
  submission: object;
  accepted: boolean;
  sending: boolean;
  feedback?: AndroidPhotoSendRejection['reason'];
}

// Owned by the chat page, not the composer that unmounts when the first send creates a chat.
export function createAndroidPhotoDraftHandoff() {
  const entries = new Map<string, AndroidPhotoHandoffEntry>();
  const claimed = new WeakSet<object>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const read = (id: string | null) => (id && entries.get(id)) || null;
  const update = (
    entry: AndroidPhotoHandoffEntry,
    values: Partial<
      Pick<AndroidPhotoHandoffEntry, 'accepted' | 'sending' | 'feedback'>
    >,
  ) => {
    const current = read(entry.conversationId);
    if (current?.submission !== entry.submission) return;
    entries.set(entry.conversationId, { ...current, ...values });
    notify();
  };
  return {
    read,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    offer(conversationId: string, draft: AndroidPhotoHandoffDraft) {
      const entry = {
        ...draft,
        conversationId,
        submission: {},
        accepted: false,
        sending: true,
      };
      entries.set(conversationId, entry);
      notify();
      return entry;
    },
    claim(entry: AndroidPhotoHandoffEntry) {
      if (claimed.has(entry.submission)) return false;
      claimed.add(entry.submission);
      return true;
    },
    acknowledge: (entry: AndroidPhotoHandoffEntry) =>
      update(entry, { accepted: true }),
    finish: (
      entry: AndroidPhotoHandoffEntry,
      feedback?: AndroidPhotoSendRejection['reason'],
    ) => update(entry, { sending: false, feedback }),
    remove(entry: AndroidPhotoHandoffEntry) {
      if (read(entry.conversationId)?.submission !== entry.submission) return;
      entries.delete(entry.conversationId);
      notify();
    },
  };
}

export type AndroidPhotoDraftHandoff = ReturnType<
  typeof createAndroidPhotoDraftHandoff
>;

export async function submitAndroidPhotoDraft({
  submitted,
  recipient,
  content,
  readCurrent,
  send,
  acknowledge,
  handoff,
}: {
  submitted: AndroidPhotoDraftSnapshot;
  recipient: AndroidPhotoRecipient;
  content: string;
  readCurrent: () => {
    snapshot: AndroidPhotoDraftSnapshot | null;
    text: string;
  };
  send: (
    message: string,
    options: AndroidPhotoSendOptions & AndroidPhotoSendCallbacks,
  ) => void | Promise<void>;
  acknowledge: (id: string) => void;
  handoff?: AndroidPhotoDraftHandoff;
}): Promise<AndroidPhotoSendRejection['reason'] | undefined> {
  let transferred: AndroidPhotoHandoffEntry | undefined;
  let rejection: AndroidPhotoSendRejection['reason'] | undefined;
  try {
    await sendAndroidPhoto(
      submitted.photo,
      content,
      recipient,
      (message, options) =>
        send(message, {
          ...options,
          onAndroidPhotoConversationCreated(id) {
            if (!handoff) return;
            const current = readCurrent();
            if (current.snapshot?.photo === submitted.photo) {
              transferred = handoff.offer(id, {
                photo: submitted.photo,
                text: current.text,
              });
            }
          },
          onAndroidPhotoAccepted(id) {
            if (!shouldClearPhotoDraft(readCurrent().snapshot, submitted))
              return;
            if (transferred) {
              if (transferred.conversationId === id)
                handoff?.acknowledge(transferred);
            } else {
              acknowledge(id);
            }
          },
        }),
    );
  } catch (error) {
    rejection =
      error instanceof AndroidPhotoSendRejection
        ? error.reason
        : 'not_accepted';
  } finally {
    if (transferred) handoff?.finish(transferred, rejection);
  }
  return rejection;
}
