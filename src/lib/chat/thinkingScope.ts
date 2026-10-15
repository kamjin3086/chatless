/**
 * Where the thinking level in force came from.
 *
 * Three scopes can express an opinion - the model's saved default, this conversation, and
 * this single message - and the whole point of the control is that the user can see which
 * one is answering, because that is what tells them where to go to change it. The priority
 * is message > conversation > model; `auto` and "inherit" both send nothing and differ only
 * in who is staying quiet.
 *
 * Kept as pure functions over plain parameter bags, so the rules are testable instead of
 * being implied by widget state (the mistake #96 already paid for once).
 */
import type { ModelParameters } from '@/types/model-params';
import {
  type ThinkingLevel,
  isVerifiedThinkingModel,
  supportedThinkingLevels,
} from '@/lib/llm/thinkingLevels';

/** Who is expressing the opinion. */
export type ThinkingScope = 'model' | 'conversation' | 'message';

/** What the control should report as the origin of the level in force. */
export type ThinkingSource = ThinkingScope | 'model-default' | 'unverified';

/** One scope's opinion: follow whatever is below, refuse to send anything, or a level. */
export type ThinkingChoice = 'inherit' | 'suppress' | ThinkingLevel;

/** The order the control resolves in: highest first. */
const SCOPE_PRIORITY: Array<{
  scope: ThinkingScope;
  read: (state: ThinkingState) => Partial<ModelParameters> | null | undefined;
}> = [
  { scope: 'message', read: (s) => s.messageParams },
  { scope: 'conversation', read: (s) => s.conversationParams },
  { scope: 'model', read: (s) => s.modelParams },
];

/**
 * Read one scope's tri-state. Absent flags mean "no opinion here", which is what makes the
 * model default reachable from a conversation that never touched the control.
 */
export function readThinkingChoice(
  params: Partial<ModelParameters> | null | undefined,
): ThinkingChoice {
  const p = params || {};
  if (p.enableThinkingLevel === false) return 'suppress';
  if (
    p.enableThinkingLevel === true &&
    p.thinkingLevel &&
    p.thinkingLevel !== 'auto'
  ) {
    return p.thinkingLevel;
  }
  return 'inherit';
}

export interface ThinkingState {
  provider: string;
  modelId: string;
  modelParams?: Partial<ModelParameters> | null;
  conversationParams?: Partial<ModelParameters> | null;
  messageParams?: Partial<ModelParameters> | null;
}

export interface ThinkingView {
  /** What will actually go on the wire; `auto` means nothing is sent. */
  level: ThinkingLevel;
  source: ThinkingSource;
  /** What the control may offer: `auto` first, then the tiers this model has. */
  options: ThinkingLevel[];
  /**
   * A scope chose a level this model does not advertise, so it is not being sent. Reported
   * rather than repaired: swapping a saved choice for a neighbouring tier is a guess, and
   * silently dropping it is the failure this feature exists to avoid.
   */
  stale: boolean;
  /** False when the tiers come from the generic field rather than a verified mapping. */
  verified: boolean;
}

/** Tiers worth choosing, `auto` first. Never empty: an unknown model gets the generic tiers. */
export function thinkingOptionsFor(
  provider: string,
  modelId: string,
): ThinkingLevel[] {
  return ['auto', ...supportedThinkingLevels(provider, modelId)];
}

export function effectiveThinking(state: ThinkingState): ThinkingView {
  const options = thinkingOptionsFor(state.provider, state.modelId);
  const verified = isVerifiedThinkingModel(state.provider, state.modelId);
  const unverified = !verified;

  for (const { scope, read } of SCOPE_PRIORITY) {
    const choice = readThinkingChoice(read(state));
    if (choice === 'inherit') continue;
    if (choice === 'suppress') {
      return { level: 'auto', source: scope, options, stale: false, verified };
    }
    if (!options.includes(choice)) {
      // A tier this pair cannot express (an `xhigh` saved before the table changed, say):
      // the honest answer is that it will not be sent, not a nearby tier.
      return { level: 'auto', source: scope, options, stale: true, verified };
    }
    return { level: choice, source: scope, options, stale: false, verified };
  }

  return {
    level: 'auto',
    source: unverified ? 'unverified' : 'model-default',
    options,
    stale: false,
    verified,
  };
}

/**
 * The next level for the keyboard shortcut.
 *
 * `options` arrives already in the documented order (`thinkingOptionsFor` filters
 * `THINKING_LEVEL_ORDER`), so cycling is positional and cannot invent a tier the model does
 * not advertise, skip one it does, or stop excluding `auto` - `auto` is a rung like any
 * other, because "let the model decide" is a decision the user is allowed to make and
 * revisit.
 */
export function cycleThinkingLevel(args: {
  options: ThinkingLevel[];
  current: ThinkingLevel;
  shift?: number;
}): ThinkingLevel {
  const { options, current, shift = 1 } = args;
  if (options.length === 0) return 'auto';
  const index = options.indexOf(current);
  if (index === -1) {
    // The saved level is not on this model's list: begin where choosing begins, which is
    // the first real tier, so one press produces a level rather than a shrug.
    return options[Math.min(1, options.length - 1)];
  }
  const length = options.length;
  return options[(((index + shift) % length) + length) % length];
}

/** The two keys that carry a scope's opinion; clearing means removing both. */
const CHOICE_KEYS = ['enableThinkingLevel', 'thinkingLevel'] as const;

function withoutChoice(
  params: Partial<ModelParameters> | null | undefined,
): Partial<ModelParameters> {
  const next: Record<string, unknown> = { ...(params || {}) };
  for (const key of CHOICE_KEYS) delete next[key];
  return next as Partial<ModelParameters>;
}

function withChoice(
  params: Partial<ModelParameters> | null | undefined,
  level: ThinkingLevel | 'suppress',
): Partial<ModelParameters> {
  const next = withoutChoice(params);
  if (level === 'suppress') {
    // An explicit "this scope sends no thinking level", which outranks a lower scope that
    // does set one - the way to get "no level for this one message" past a session level.
    next.enableThinkingLevel = false;
    return next;
  }
  if (level !== 'auto') {
    next.enableThinkingLevel = true;
    next.thinkingLevel = level;
  }
  return next;
}

export interface ThinkingScopes {
  modelParams?: Partial<ModelParameters> | null;
  conversationParams?: Partial<ModelParameters> | null;
  messageParams?: Partial<ModelParameters> | null;
}

export interface ThinkingChoiceResult {
  modelParams: Partial<ModelParameters>;
  conversationParams: Partial<ModelParameters>;
  /** `null` means nothing is pending for the next message. */
  messageParams: Partial<ModelParameters> | null;
  clearedMessageOverride: boolean;
}

/**
 * Write a choice into one scope and return what all three should now hold.
 *
 * Two rules keep the control from lying after a write:
 *
 * - Choosing `auto` removes that scope's opinion instead of storing the word, so a later
 *   read cannot mistake "no opinion" for "an opinion called auto".
 * - Writing a lasting scope retires a pending single-message override, because that
 *   override outranks what was just written and would be consumed by the next send: the
 *   user's change would look like it did nothing, with the control still reporting the old
 *   source. A conversation override is *not* cleared when the model default changes - that
 *   is a standing choice, and the honest readout after such a write is "conversation".
 */
export function applyThinkingChoice(
  args: ThinkingScopes & {
    scope: ThinkingScope;
    level: ThinkingChoice;
  },
): ThinkingChoiceResult {
  const { scope } = args;
  // Choosing `auto` at a scope is the same write as clearing it: this scope stops having
  // an opinion and whatever is below it answers.
  const level: ThinkingLevel | 'suppress' =
    args.level === 'inherit' ? 'auto' : args.level;
  const pendingOpinion = readThinkingChoice(args.messageParams) !== 'inherit';
  const clearMessage = scope !== 'message' && pendingOpinion;

  const messageOnly = (
    params: Partial<ModelParameters> | null,
  ): Partial<ModelParameters> | null =>
    readThinkingChoice(params) === 'inherit' ? null : params;

  if (scope === 'message') {
    return {
      modelParams: { ...(args.modelParams || {}) },
      conversationParams: { ...(args.conversationParams || {}) },
      messageParams: messageOnly(withChoice(args.messageParams, level)),
      clearedMessageOverride: false,
    };
  }

  return {
    modelParams:
      scope === 'model'
        ? withChoice(args.modelParams, level)
        : { ...(args.modelParams || {}) },
    conversationParams:
      scope === 'conversation'
        ? withChoice(args.conversationParams, level)
        : { ...(args.conversationParams || {}) },
    messageParams: clearMessage
      ? null
      : messageOnly({ ...(args.messageParams || {}) }),
    clearedMessageOverride: clearMessage,
  };
}

/**
 * The parameter keys that carry a thinking opinion, newest form first and the retired
 * boolean with it: a persisted boolean still has to be able to say "off" (#100 migrates
 * what it can and honours the rest), so folding scopes together has to move it too.
 */
export const THINKING_PARAM_KEYS = [
  'enableThinkingLevel',
  'thinkingLevel',
  'enableThinking',
  'thinking',
] as const;

/**
 * Put a single-message choice on top of the conversation's own parameters.
 *
 * Only the thinking keys move. Everything else about the send - temperature, output budget,
 * response format - belongs to the conversation or the model, and letting a one-message
 * override reach those would be a surprise of the kind this ticket is closing out.
 * This is the whole integration in the send path: after this, the existing merge and
 * "the session refused this key" filtering work unchanged.
 */
export function foldMessageScopeIntoSession(
  sessionParams: Partial<ModelParameters> | null | undefined,
  messageParams: Partial<ModelParameters> | null | undefined,
): Partial<ModelParameters> {
  const merged: Record<string, unknown> = { ...(sessionParams || {}) };
  if (!messageParams) return merged as Partial<ModelParameters>;
  for (const key of THINKING_PARAM_KEYS) {
    if (key in messageParams) {
      merged[key] = (messageParams as Record<string, unknown>)[key];
    }
  }
  // A refusal replaces the whole thought: keeping a tier the conversation left behind
  // would leave a value in the bag that nothing reads but everything could.
  if (
    messageParams.enableThinkingLevel === false &&
    !('thinkingLevel' in messageParams)
  ) {
    delete merged.thinkingLevel;
  }
  return merged as Partial<ModelParameters>;
}

/** What happened to a persisted boolean, so the UI can say it out loud. */
export type ThinkingMigration = 'none' | 'off' | 'kept-on' | 'kept-unsupported';

export interface ThinkingMigrationResult<T> {
  params: T;
  migration: ThinkingMigration;
}

/**
 * The old `thinking` boolean, translated once on read (#100 removes its only entry point).
 *
 * The boolean says whether the model thinks at all; the level says how much. Only one
 * direction is unambiguous: `thinking: false` means "do not think", which is exactly what
 * the `off` level means on every provider that advertises it - so it becomes that level
 * and the boolean goes away, rather than two settings arguing on the wire (Ollama already
 * treats a level as the more specific statement, and a level that outranks the boolean
 * would otherwise make the old value invisible).
 *
 * `thinking: true` is deliberately not mapped. It never named an amount, and inventing one
 * - "medium, probably" - is the kind of guess this feature was built to stop making. Those
 * models keep receiving exactly what they received before, and the control explains why an
 * old setting is still in effect. Where this model has no `off` tier, the false case is
 * kept too: honouring the old value beats dropping it quietly.
 */
export function migrateLegacyThinkingBoolean<
  T extends Partial<ModelParameters>,
>(args: {
  provider: string;
  modelId: string;
  params: T | null | undefined;
}): ThinkingMigrationResult<T> {
  const params = { ...(args.params || {}) } as T;
  const hadBoolean = 'thinking' in params || 'enableThinking' in params;
  if (!hadBoolean) return { params, migration: 'none' };

  const hasBoolean = params.thinking !== undefined;
  const enabled = params.enableThinking !== false;
  // "There is no level here" is not the same statement as "a level was chosen": a bag
  // saved by the dialog carries `enableThinkingLevel: false` for a model whose level was
  // never touched, and reading that as a choice would hide the boolean it should migrate.
  const choice = readThinkingChoice(params);
  const hasLevel = choice !== 'inherit' && choice !== 'suppress';

  // A level already on record is the more specific statement, so a boolean it disagrees
  // with goes rather than riding along underneath (same precedence #99 settled for Ollama).
  if (hasLevel) {
    delete params.enableThinking;
    if (hasBoolean) delete params.thinking;
    return { params, migration: 'none' };
  }

  if (!hasBoolean) {
    // Flag without a value: keep a refusal, drop a pointless enable flag.
    if (enabled) delete params.enableThinking;
    return { params, migration: 'none' };
  }

  // `enableThinking: false` is a scope refusing thinking, and that flag is precisely what
  // the inherited-key table reads. Erasing it would hand back something the model default
  // had switched on - a different kind of silent drop, with the same cause: deleting a
  // setting because it looked redundant.
  if (!enabled) return { params, migration: 'none' };

  // Everything below keeps the boolean pair intact until a level can genuinely replace it.
  // Deleting the enable flag is not cosmetic: `shouldSet` treats an absent flag as "same as
  // the default, so omit it", and the default for `thinking` is true - so a stripped flag
  // made a stored "think" disappear from the wire while the screen claimed it was still on.
  if (params.thinking === true) return { params, migration: 'kept-on' };

  if (!thinkingOptionsFor(args.provider, args.modelId).includes('off')) {
    return { params, migration: 'kept-unsupported' };
  }
  delete params.enableThinking;
  delete params.thinking;
  params.enableThinkingLevel = true;
  params.thinkingLevel = 'off';
  return { params, migration: 'off' };
}
