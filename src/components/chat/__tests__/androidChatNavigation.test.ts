import { describe, expect, it, vi } from 'vitest';
import {
  ANDROID_BACK_EVENT,
  handleAndroidBack,
  type AndroidChatView,
} from '../androidChatNavigation';

function pressBack(view: AndroidChatView, panelOpen = false) {
  const back = new Event(ANDROID_BACK_EVENT, { cancelable: true });
  const keyTarget = new EventTarget();
  const closePanel = vi.fn((event: Event) => event.preventDefault());
  if (panelOpen) keyTarget.addEventListener('keydown', closePanel);
  const escape = new Event('keydown', { cancelable: true });
  const next = handleAndroidBack(
    back,
    () => keyTarget.dispatchEvent(escape),
    view,
  );
  return { handled: back.defaultPrevented, closePanel, next };
}

describe('Android chat Back after the native IME is dismissed', () => {
  it('dismisses the picker without leaving chat', () => {
    const result = pressBack({ surface: 'chat' }, true);
    expect(result.closePanel).toHaveBeenCalledOnce();
    expect(result.handled).toBe(true);
    expect(result.next).toEqual({ surface: 'chat' });
  });

  it('closes the attachment sheet before any navigation', () => {
    // The sheet is a Radix dialog, so its layer listens on the document in the capture
    // phase and cancels the Escape that Back dispatches. Cancelled means Back is consumed.
    const back = new Event(ANDROID_BACK_EVENT, { cancelable: true });
    const sheetLayer = new EventTarget();
    const closeSheet = vi.fn((event: Event) => event.preventDefault());
    sheetLayer.addEventListener('keydown', closeSheet, { capture: true });
    const next = handleAndroidBack(
      back,
      () =>
        sheetLayer.dispatchEvent(new Event('keydown', { cancelable: true })),
      { surface: 'chat' },
    );
    expect(closeSheet).toHaveBeenCalledOnce();
    expect(back.defaultPrevented).toBe(true);
    expect(next).toEqual({ surface: 'chat' });
  });

  it('leaves Back to Android from the chat, where nothing is open', () => {
    // The list is a drawer, not the page behind the chat: with the drawer closed the chat is the
    // bottom of the stack, and Android keeps the key.
    expect(pressBack({ surface: 'chat' })).toMatchObject({
      handled: false,
      next: { surface: 'chat' },
    });
  });

  it.each(['chat', 'conversations'] as const)(
    'returns from model settings to %s',
    (from) => {
      expect(
        pressBack({ surface: 'models', from, addProvider: false }),
      ).toMatchObject({
        handled: true,
        next: { surface: from },
      });
    },
  );

  it('closes the conversation drawer before Android gets Back', () => {
    expect(pressBack({ surface: 'conversations' })).toMatchObject({
      handled: true,
      next: { surface: 'chat' },
    });
  });
});
