import { createContext, useContext, useEffect, useState } from 'react';

export const ANDROID_BACK_EVENT = 'chatless:android-back';

type ChatSurface = 'conversations' | 'chat';
export type AndroidChatView =
  | { surface: ChatSurface }
  | { surface: 'models'; from: ChatSurface; addProvider: boolean };

function previousView(view: AndroidChatView): AndroidChatView {
  if (view.surface === 'models') return { surface: view.from };
  if (view.surface === 'chat') return { surface: 'conversations' };
  return view;
}

export function handleAndroidBack(
  event: Event,
  dispatchEscape: () => boolean,
  view: AndroidChatView,
) {
  // Radix prevents the Escape default when the active dialog or menu consumes it.
  if (!dispatchEscape()) {
    event.preventDefault();
    return view;
  }
  const previous = previousView(view);
  if (previous !== view) event.preventDefault();
  return previous;
}

interface AndroidChatNavigation {
  showConversations: () => void;
  openModelSettings: (addProvider?: boolean) => void;
}

export const AndroidChatNavigationContext =
  createContext<AndroidChatNavigation | null>(null);

export function useAndroidChatNavigation() {
  return useContext(AndroidChatNavigationContext);
}

export function useAndroidChatSurfaces(android: boolean) {
  const [view, setView] = useState<AndroidChatView>({
    surface: 'conversations',
  });
  const showConversations = () => setView({ surface: 'conversations' });
  const showChat = () => setView({ surface: 'chat' });
  const openModelSettings = (addProvider = false) => {
    setView((previous) =>
      previous.surface === 'models'
        ? previous
        : {
            surface: 'models',
            from: previous.surface,
            addProvider,
          },
    );
  };

  useEffect(() => {
    if (!android) return;
    const onBack = (event: Event) => {
      const next = handleAndroidBack(
        event,
        () =>
          (document.activeElement ?? document).dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            }),
          ),
        view,
      );
      if (next !== view) setView(next);
    };
    document.addEventListener(ANDROID_BACK_EVENT, onBack);
    return () => document.removeEventListener(ANDROID_BACK_EVENT, onBack);
  }, [android, view]);

  return {
    view,
    showConversations,
    showChat,
    openModelSettings,
    closeModelSettings: () => setView(previousView),
  };
}
