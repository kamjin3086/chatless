import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  acquireAndroidPhoto,
  type AndroidPhoto,
  type AndroidPhotoSource,
} from '@/lib/android/androidPhoto';
import {
  type AndroidPhotoDraftHandoff,
  submitAndroidPhotoDraft,
} from '@/lib/android/androidPhotoDraftHandoff';
import {
  type AndroidPhotoDraftSnapshot,
  type AndroidPhotoRecipient,
  type AndroidPhotoSendOptions,
  type AndroidPhotoSendCallbacks,
  resolveAndroidPhotoRoute,
  shouldClearPhotoDraft,
} from '@/lib/android/androidPhotoSend';

export type AndroidPhotoFeedback =
  | 'checking'
  | 'supported'
  | 'unsupported'
  | 'busy'
  | 'other_attachment'
  | 'acquiring'
  | 'unavailable'
  | 'unreadable'
  | 'too_large'
  | 'recipient_changed'
  | 'not_accepted';

const noHandoff = () => () => {};
const noHandoffSnapshot = () => null;

export function useAndroidPhotoDraft(
  conversationId: string | null,
  text: string,
  providerName: string | undefined,
  modelId: string | undefined,
  handoff: AndroidPhotoDraftHandoff | undefined,
  restoreText: (text: string) => void,
  clearText: (id: string) => void,
) {
  const [draft, setDraft] = useState<{
    conversationId: string | null;
    photo: AndroidPhoto;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    conversationId: string | null;
    message: AndroidPhotoFeedback;
  } | null>(null);
  const [support, setSupport] = useState<{
    providerName: string;
    modelId: string;
    recipient: AndroidPhotoRecipient | null;
  } | null>(null);
  const [acquiring, setAcquiring] = useState(false);
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const readHandoff = useCallback(
    () => handoff?.read(conversationId) ?? null,
    [handoff, conversationId],
  );
  const incoming = useSyncExternalStore(
    handoff?.subscribe ?? noHandoff,
    readHandoff,
    noHandoffSnapshot,
  );
  const photo =
    draft?.conversationId === conversationId
      ? draft.photo
      : (incoming?.photo ?? null);
  const textRevision = useMemo(() => ({}), [conversationId, text]);
  const snapshot = photo ? { photo, textRevision } : null;
  const checked =
    support?.providerName === providerName && support?.modelId === modelId
      ? support
      : null;
  const recipient = photo ? (checked?.recipient ?? null) : null;
  const current = useRef({ conversationId, snapshot, recipient, text });
  const initialRevision = useRef(textRevision);
  useLayoutEffect(() => {
    if (current.current.conversationId !== conversationId) {
      initialRevision.current = textRevision;
    }
    current.current = { conversationId, snapshot, recipient, text };
  });

  const adopted = useRef<{
    submission: object;
    revision: object | null;
    restoring: boolean;
  } | null>(null);
  useEffect(() => {
    if (!handoff || !incoming || photo !== incoming.photo) {
      adopted.current = null;
      return;
    }
    if (adopted.current?.submission !== incoming.submission) {
      // The newly mounted composer may already have been edited by the time creation resolves.
      const untouched =
        handoff.claim(incoming) &&
        !text &&
        initialRevision.current === textRevision;
      const restoring =
        untouched && Boolean(incoming.text) && !incoming.accepted;
      adopted.current = {
        submission: incoming.submission,
        revision: untouched && !restoring ? textRevision : null,
        restoring,
      };
      if (restoring) restoreText(incoming.text);
    } else if (adopted.current.restoring && text) {
      adopted.current.restoring = false;
      if (text === incoming.text) adopted.current.revision = textRevision;
    }
    if (incoming.accepted && adopted.current.revision === textRevision) {
      handoff.remove(incoming);
      clearText(incoming.conversationId);
    }
  }, [clearText, handoff, incoming, photo, restoreText, text, textRevision]);

  useEffect(() => {
    if (!photo || !providerName || !modelId) return;
    let cancelled = false;
    void resolveAndroidPhotoRoute(providerName, modelId).then((route) => {
      if (!cancelled) {
        setSupport({
          providerName,
          modelId,
          recipient: route ? { providerName, modelId, route } : null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [photo, providerName, modelId]);

  async function acquire(source: AndroidPhotoSource) {
    if (pending.current) return;
    pending.current = true;
    setAcquiring(true);
    setFeedback(null);
    try {
      const result = await acquireAndroidPhoto(source);
      if (current.current.conversationId !== conversationId) return;
      if (result.status === 'selected') {
        if (incoming) handoff?.remove(incoming);
        setDraft({ conversationId, photo: result.photo });
      } else if (result.status !== 'cancelled') {
        setFeedback({ conversationId, message: result.status });
      }
    } finally {
      pending.current = false;
      setAcquiring(false);
    }
  }

  async function submit(
    submitted: AndroidPhotoDraftSnapshot,
    content: string,
    send: (
      content: string,
      options: AndroidPhotoSendOptions & AndroidPhotoSendCallbacks,
    ) => void | Promise<void>,
  ) {
    if (
      pending.current ||
      incoming?.sending ||
      !recipient ||
      current.current.recipient !== recipient ||
      !shouldClearPhotoDraft(current.current.snapshot, submitted)
    )
      return;
    pending.current = true;
    setSending(true);
    setFeedback(null);
    try {
      const rejection = await submitAndroidPhotoDraft({
        submitted,
        recipient,
        content,
        send,
        readCurrent: () => current.current,
        handoff: conversationId === null ? handoff : undefined,
        acknowledge: (id) => {
          if (incoming) handoff?.remove(incoming);
          setDraft(null);
          clearText(id);
        },
      });
      if (rejection && current.current.snapshot?.photo === submitted.photo) {
        setFeedback({ conversationId, message: rejection });
      }
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  return {
    snapshot,
    recipient,
    acquiring,
    sending: sending || Boolean(incoming?.sending),
    acquire,
    submit,
    remove: () => {
      if (incoming) handoff?.remove(incoming);
      setDraft(null);
      setFeedback(null);
    },
    feedback:
      feedback?.conversationId === conversationId
        ? feedback.message
        : (incoming?.feedback ?? null),
    support: checked?.recipient
      ? 'supported'
      : checked || !modelId || !providerName
        ? 'unsupported'
        : 'checking',
  } as const;
}
