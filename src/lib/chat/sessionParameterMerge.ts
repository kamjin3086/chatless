import type { ModelParameters } from '@/types/model-params';
import {
  type ThinkingChoice,
  readThinkingChoice,
} from '@/lib/chat/thinkingScope';

/**
 * What a conversation says about the thinking level: follow the model default, refuse
 * to send one at all, or pick one for this conversation only. Kept as pure functions so
 * the tri-state is testable instead of being implied by widget state.
 *
 * The tri-state itself lives in `thinkingScope`, because #100 added two more scopes that
 * read it the same way; a second copy here would be the duplicate-list mistake again.
 */
export type SessionThinkingChoice = ThinkingChoice;
export { readThinkingChoice as readSessionThinkingChoice };

export function withSessionThinkingChoice(
  sessionParameters: Partial<ModelParameters>,
  choice: SessionThinkingChoice,
): Partial<ModelParameters> {
  const next: Partial<ModelParameters> = { ...sessionParameters };
  if (choice === 'inherit') {
    delete next.enableThinkingLevel;
  } else if (choice === 'suppress') {
    next.enableThinkingLevel = false;
  } else {
    next.enableThinkingLevel = true;
    next.thinkingLevel = choice;
  }
  return next;
}

/**
 * A conversation can explicitly switch a parameter off, and that must remove whatever
 * the model-level default would have contributed. Both places that needed this kept
 * their own copy of the flag list and they had already drifted: the send path forgot
 * thinking, streaming, format and the thinking level, so a conversation could not turn
 * off what the model had turned on. One table, two callers.
 */
const INHERITED_KEY_BY_FLAG: Array<[keyof ModelParameters, string]> = [
  ['enableTemperature', 'temperature'],
  ['enableMaxTokens', 'maxTokens'],
  ['enableTopP', 'topP'],
  ['enableTopK', 'topK'],
  ['enableMinP', 'minP'],
  ['enableFrequencyPenalty', 'frequencyPenalty'],
  ['enablePresencePenalty', 'presencePenalty'],
  ['enableStopSequences', 'stop'],
  ['enableThinking', 'thinking'],
  ['enableThinkingLevel', 'thinkingLevel'],
  ['enableStreaming', 'streaming'],
  ['enableFormat', 'format'],
];

/**
 * Drop inherited options the session explicitly disabled (`enableX === false`). An
 * absent flag means "no opinion here" and inherits, which is why only `false` removes.
 */
export function dropInheritedThatSessionDisabled(
  inherited: Record<string, unknown>,
  sessionParameters: Partial<ModelParameters> | null | undefined,
): Record<string, unknown> {
  if (!sessionParameters) return inherited;
  const next: Record<string, unknown> = { ...inherited };
  for (const [flag, key] of INHERITED_KEY_BY_FLAG) {
    if (sessionParameters[flag] === false && key in next) delete next[key];
  }
  return next;
}
