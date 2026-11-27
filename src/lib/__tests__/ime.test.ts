import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPOSITION_END_GRACE_MS,
  IME_DEAD_KEY_CODE,
  isImeComposition,
  markCompositionEnd,
  markCompositionStart,
  abandonComposition,
  resetImeCompositionForTests,
  setImeClockForTests,
  MAX_OPEN_COMPOSITION_MS,
} from '../ime';

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

  it('follows the composition of the element being typed in', () => {
    markCompositionStart();
    // The candidate list is open: this Enter belongs to the input method, whatever the
    // event itself claims.
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
    const composer = { name: 'composer' };
    const other = { name: 'other field' };
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
    const composer = { name: 'composer' };
    markCompositionStart(composer);
    markCompositionEnd();

    const commitEnter = { target: composer, keyCode: 13 };
    expect(isImeComposition(commitEnter)).toBe(true);
    expect(isImeComposition(commitEnter)).toBe(true);
    // A different key, even inside the window, is the user's.
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(false);
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
    const composer = { name: 'composer' };
    markCompositionStart(composer);
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(true);

    abandonComposition(composer);
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(false);
  });

  it('does not let one element blur end another element composition', () => {
    const composer = { name: 'composer' };
    const panel = { name: 'panel' };
    markCompositionStart(composer);

    abandonComposition(panel);
    expect(isImeComposition({ target: composer, keyCode: 13 })).toBe(true);
  });
});
