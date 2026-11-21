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

  it('returns from chat to the conversation list when no panel consumes Back', () => {
    expect(pressBack({ surface: 'chat' })).toMatchObject({
      handled: true,
      next: { surface: 'conversations' },
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

  it('leaves Back to Android when already at the conversation list', () => {
    expect(pressBack({ surface: 'conversations' })).toMatchObject({
      handled: false,
      next: { surface: 'conversations' },
    });
  });
});
