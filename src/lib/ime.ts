import { useEffect, type RefObject } from 'react';

/**
 * Telling a keystroke the user pressed from one an input method pressed for them.
 *
 * `KeyboardEvent.isComposing` is the documented answer and it is not enough on its own.
 * Engines disagree about the order of `compositionend` and the `keydown` that commits a
 * composition: Chromium fires that keydown *after* `compositionend`, so the Enter that only
 * accepted a candidate arrives with `isComposing === false` and looks like an ordinary
 * keystroke. In a chat composer that means the half-converted text is sent and the rest of
 * the word is never typed.
 *
 * So the state is tracked per element - the one being typed in - and read together with the
 * event's own signals: `isComposing`, and `keyCode === 229`, the legacy "under composition"
 * code Firefox and WebKitGTK still send when the flag is not set. Three failure modes are
 * designed out, because each of them is worse than the bug this file exists for: a composition
 * whose `compositionend` never arrives must not claim every later key (it would swallow every
 * Enter), the short window after `compositionend` must cover only the key that closed it, and
 * one input's composition must not describe another's.
 */

/** How long after a composition ends the next keystroke still counts as the one that closed it. */
export const COMPOSITION_END_GRACE_MS = 50;

/** The legacy key code for a key that the input method consumed. */
export const IME_DEAD_KEY_CODE = 229;

/**
 * How long a composition with no `compositionend` at all is still believed. A killed input
 * method or a tab hidden mid-preedit never reports the end, and an open composition swallows
 * every key, so the belief needs a fuse - one long enough that no real preedit lasts it.
 */
export const MAX_OPEN_COMPOSITION_MS = 30_000;

/** Marks "a composition is open, on an element we do not know", so any target matches it. */
const UNKNOWN_TARGET = Symbol('unknown composition target');

type CompositionFlags =
  | { isComposing?: boolean; keyCode?: number }
  | null
  | undefined;
type MaybeWrapped =
  | CompositionFlags
  | { nativeEvent?: CompositionFlags; target?: unknown }
  | null
  | undefined;

/** React hands handlers a synthetic event; `addEventListener` hands them the native one. */
const flagsOf = (event: MaybeWrapped): CompositionFlags =>
  ((event as { nativeEvent?: CompositionFlags } | null)?.nativeEvent ??
    event) as CompositionFlags;

const targetOf = (event: MaybeWrapped): unknown =>
  (event as { target?: unknown } | null | undefined)?.target;

let clock: () => number = () => Date.now();

/** The element with an open composition, or `UNKNOWN_TARGET`. */
let composingTarget: unknown = null;
let compositionStartedAt = 0;
/** The element whose composition just ended, while the grace window is still armed. */
let endedTarget: unknown = null;
let compositionEndedAt = Number.NEGATIVE_INFINITY;
/** The key already attributed to that composition, so every handler sees the same answer. */
let attributedKey: unknown = null;

/** True when this tracked element is the one the event came from - unknown matches anything. */
const isTrackedTarget = (tracked: unknown, target: unknown): boolean =>
  tracked === UNKNOWN_TARGET || !target || tracked === target;

export function markCompositionStart(target?: unknown): void {
  composingTarget = target ?? UNKNOWN_TARGET;
  compositionStartedAt = clock();
  endedTarget = null;
  attributedKey = null;
}

export function markCompositionEnd(): void {
  if (composingTarget === null) return;
  endedTarget = composingTarget;
  compositionEndedAt = clock();
  composingTarget = null;
  attributedKey = null;
}

/**
 * Drop an open composition without arming the grace window: the element lost focus or went
 * hidden, so no keystroke of the user's belongs to that composition any more. Only the
 * element passed owns it, so one input going away cannot silence another's.
 */
export function abandonComposition(target?: unknown): void {
  if (composingTarget === null) return;
  if (target === undefined || isTrackedTarget(composingTarget, target)) {
    composingTarget = null;
  }
  if (
    endedTarget !== null &&
    (target === undefined || isTrackedTarget(endedTarget, target))
  ) {
    endedTarget = null;
    attributedKey = null;
  }
}

/**
 * True when a keydown belongs to an input method - either a composition that is still open on
 * that element, or the single key that just closed one.
 */
export function isImeComposition(event?: MaybeWrapped): boolean {
  // An event that says it is part of a composition is taken at its word, whatever the tracked
  // state looks like: that is the engine that reports composition events late, not a stuck one.
  const flags = flagsOf(event ?? null);
  if (
    !!flags &&
    (flags.isComposing === true || flags.keyCode === IME_DEAD_KEY_CODE)
  ) {
    return true;
  }

  const target = targetOf(event ?? null);
  if (composingTarget !== null && isTrackedTarget(composingTarget, target)) {
    if (clock() - compositionStartedAt <= MAX_OPEN_COMPOSITION_MS) return true;
    // The fuse: an end event that never came would otherwise claim every Enter from here on.
    composingTarget = null;
  }
  if (
    endedTarget !== null &&
    isTrackedTarget(endedTarget, target) &&
    clock() - compositionEndedAt < COMPOSITION_END_GRACE_MS
  ) {
    // Only the key that closed the composition. A second deliberate key inside the window is
    // the user's - commit a candidate with space, then send fast, and that send must go through.
    // The answer is recorded against the event, because the composer and an open mention panel
    // both inspect one keydown and have to agree about whose it was.
    if (attributedKey === null || attributedKey === event) {
      attributedKey = event ?? UNKNOWN_TARGET;
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Track the composition of the element that receives input-method text (the composer's
 * textarea). The state is module-level so every handler that needs it - the composer's own
 * Enter, the panels' Enter and arrows - asks the same question instead of each re-deriving it
 * from the one signal that is not enough, but it belongs to the element passed here.
 */
export function useImeCompositionTarget(
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => markCompositionStart(el);
    const end = () => markCompositionEnd();
    const abandon = () => abandonComposition(el);
    const onVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      )
        abandon();
    };
    el.addEventListener('compositionstart', start);
    el.addEventListener('compositionend', end);
    // Focus leaving a half-composed word is the common way an end event goes missing.
    el.addEventListener('blur', abandon);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      el.removeEventListener('compositionstart', start);
      el.removeEventListener('compositionend', end);
      el.removeEventListener('blur', abandon);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      abandon();
    };
  }, [ref]);
}

/** Test seam: the grace window is a wall-clock window, and tests should not sleep for it. */
export function setImeClockForTests(next?: () => number): void {
  clock = next ?? (() => Date.now());
}

/** Test seam: the module state is shared, so each case starts from a known one. */
export function resetImeCompositionForTests(): void {
  composingTarget = null;
  endedTarget = null;
  attributedKey = null;
  compositionStartedAt = 0;
  compositionEndedAt = Number.NEGATIVE_INFINITY;
  clock = () => Date.now();
}
