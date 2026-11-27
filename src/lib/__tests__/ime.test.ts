import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPOSITION_END_GRACE_MS,
  imeTargetHandlers,
  IME_DEAD_KEY_CODE,
  isImeComposition,
  markCompositionEnd,
  markCompositionStart,
  abandonComposition,
  renewComposition,
  resetImeCompositionForTests,
  setImeClockForTests,
  MAX_OPEN_COMPOSITION_MS,
} from '../ime';

/**
 * A stand-in for a DOM node. The guard only ever compares a target by identity, so an object
 * that is not really an element is enough - and says so more honestly than a stub with methods.
 */
const node = (name: string) => ({ name }) as unknown as HTMLElement;

/** The ref shape the hook takes. */
const refTo = (el: HTMLElement | null) => ({ current: el });

afterEach(() => resetImeCompositionForTests());

describe('isImeComposition', () => {
  it('treats a plain keystroke as the user pressing the key', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('reads the composing flag on the native event behind a React synthetic event', () => {
    expect(isImeComposition({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposition({ nativeEvent: { isComposing: false } })).toBe(
      false,
    );
  });

  it('reads keyCode 229, the signal Firefox and WebKitGTK send when the flag is missing', () => {
    expect(isImeComposition({ keyCode: IME_DEAD_KEY_CODE })).toBe(true);
  });

  it('claims every key while a composition is open and the caller names no element', () => {
    markCompositionStart();
    // The candidate list is open: this Enter belongs to the input method, whatever the
    // event itself claims. No element was named, so no element is excluded either.
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(true);
  });

  it('still counts the key that committed the composition, then stops', () => {
    // Chromium ends the composition before it dispatches the Enter that accepted a
    // candidate, so that keydown arrives with isComposing already false. Without the window
    // after compositionend, the half-converted text is sent and the word is never finished.
    let now = 1_000;
    setImeClockForTests(() => now);
    markCompositionStart();
    markCompositionEnd();

    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(true);

    now += COMPOSITION_END_GRACE_MS;
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('does not leave every later key marked when a composition is abandoned', () => {
    markCompositionStart();
    resetImeCompositionForTests();
    expect(isImeComposition({})).toBe(false);
  });

  it('belongs to the element that is being composed in, not to every input', () => {
    const composer = node('composer');
    const other = node('other field');
    markCompositionStart(composer);
    markCompositionEnd();

    // The Enter Chromium dispatched after compositionend, on the composer.
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(true);
    // An unrelated field the user is typing in has nothing to do with that composition.
    markCompositionStart(composer);
    markCompositionEnd();
    expect(isImeComposition({ target: other, keyCode: 13 })).toBe(false);
  });

  it('covers only the key that closed the composition, not the next deliberate one', () => {
    // With an input method that commits on space, the Enter that sends the message can follow
    // the commit by less than the grace window; taking every key in that window swallows it.
    let now = 1_000;
    setImeClockForTests(() => now);
    markCompositionStart();
    markCompositionEnd();

    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(true);
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it('gives every handler that inspects one key the same answer', () => {
    // The composer's own Enter and an open mention panel both look at the same keydown, and an
    // argument between them about whose key it was ends with the panel accepting a selection
    // the input method had already used.
    let now = 1_000;
    setImeClockForTests(() => now);
    const composer = node('composer');
    markCompositionStart(composer);
    markCompositionEnd();

    const commitEnter = { target: composer, keyCode: 13 };
    expect(isImeComposition(commitEnter)).toBe(true);
    expect(isImeComposition(commitEnter)).toBe(true);
    // Same content in a different event object: a second deliberate key inside the window.
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(false);
  });

  it('agrees between the composer and an open panel over one key', () => {
    // The composer is handed React's synthetic event and the mention panels the native one from
    // their `window` listener, so the two readers hold different objects for one keydown. If the
    // answer is recorded against the wrong one, the composer swallows the commit-Enter and the
    // open panel takes it as the user accepting a highlighted mention.
    let now = 1_000;
    setImeClockForTests(() => now);
    const textarea = node('textarea');
    markCompositionStart(textarea);
    markCompositionEnd();

    const native = { target: textarea, keyCode: 13, isComposing: false };
    const synthetic = { nativeEvent: native, target: textarea };
    expect(isImeComposition(synthetic)).toBe(true);
    expect(isImeComposition(native)).toBe(true);
  });

  it('keeps a long preedit protected while it is still running', () => {
    // The fuse exists for a composition whose end event never arrived; an engine that reports no
    // composing flag must not lose the guard just because the user thought for half a minute.
    let now = 1_000;
    setImeClockForTests(() => now);
    markCompositionStart();

    now += MAX_OPEN_COMPOSITION_MS - 1_000;
    renewComposition();
    now += MAX_OPEN_COMPOSITION_MS - 1_000;
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(true);
  });

  it('lets go of a composition whose end event never arrived', () => {
    // A killed input method, a tab hidden mid-preedit: no compositionend. Claiming every key
    // from then on swallows every Enter forever, which is worse than the bug being fixed.
    let now = 1_000;
    setImeClockForTests(() => now);
    markCompositionStart();

    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(true);

    now += MAX_OPEN_COMPOSITION_MS + 1;
    expect(isImeComposition({ isComposing: false, keyCode: 13 })).toBe(false);
    // An event that still says it is composing is taken at its word, however old it is.
    expect(
      isImeComposition({ isComposing: true, keyCode: IME_DEAD_KEY_CODE }),
    ).toBe(true);
  });

  it('ends an open composition when the element loses focus', () => {
    const composer = node('composer');
    markCompositionStart(composer);
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(true);

    abandonComposition(composer);
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(false);
  });

  it('does not let one element blur end another element composition', () => {
    const composer = node('composer');
    const panel = node('panel');
    markCompositionStart(composer);

    abandonComposition(panel);
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(true);
  });
});

describe('imeTargetHandlers', () => {
  it('starts and ends the composition only for the element the ref points at', () => {
    const textarea = node('textarea');
    const elsewhere = node('search box');
    const h = imeTargetHandlers(refTo(textarea));

    h.compositionStart({ target: elsewhere });
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(false);

    h.compositionStart({ target: textarea });
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(true);

    h.compositionEnd({ target: textarea });
    h.compositionStart({ target: textarea });
    h.compositionEnd({ target: elsewhere });
    // An end event addressed elsewhere did not close ours, so the next key is still the IME's.
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(true);
  });

  it('reads the ref when the event arrives, not when the listeners were installed', () => {
    // The textarea is not mounted yet when the effect runs on some paths, and a ref bound once
    // silently left the whole guard off for the element that replaced it.
    const ref = refTo(null);
    const h = imeTargetHandlers(ref);
    const textarea = node('textarea');

    h.compositionStart({ target: textarea });
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(false);

    ref.current = textarea;
    h.compositionStart({ target: textarea });
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(true);
  });

  it('ends an open composition on focus loss, from the element or from the window', () => {
    const textarea = node('textarea');
    const ref = refTo(textarea);
    const h = imeTargetHandlers(ref);

    h.compositionStart({ target: textarea });
    h.focusLost({ target: textarea });
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(false);

    h.compositionStart({ target: textarea });
    h.windowBlur();
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(false);
  });

  it('ignores a focusout addressed to another element', () => {
    const textarea = node('textarea');
    const other = node('search box');
    const h = imeTargetHandlers(refTo(textarea));

    h.compositionStart({ target: textarea });
    h.focusLost({ target: other });
    expect(isImeComposition({ target: textarea, keyCode: 13 })).toBe(true);
  });
});
