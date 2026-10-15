import { takeMessageScope } from '@/lib/chat/messageThinkingScope';
import {
  foldMessageScopeIntoSession,
  migrateLegacyThinkingBoolean,
} from '@/lib/chat/thinkingScope';
import { sanitizeParameterPatch } from '@/lib/model-parameters';
/**
 * The one place a send's conversation-level parameters get settled.
 *
 * Two send paths used to do this themselves and had already drifted: one honoured a
 * conversation's "switch this off" flags, the regenerate path carried its own shorter list
 * that never learned about thinking, so a conversation could turn thinking off for a normal
 * message and get it back on a regeneration. Whatever the message that triggered a run, the
 * parameters behind it must be the same, so both paths call this.
 */
import type {
  ModelParameterPatch,
  ModelParameters,
} from '@/types/model-params';

/**
 * Typed as a full `ModelParameters` because that is what the call sites hand to
 * `convertToChatOptions`: stored bags are written by the parameters dialog, which saves the
 * whole set. Pending and partial bags are merged into that shape, so the cast is a
 * restatement of what storage already guarantees, not a hole poked through the type.
 */
export async function resolveConversationParameters(args: {
  conversationId: string;
  provider: string;
  modelId: string;
  sessionParams?: Partial<ModelParameters> | null;
  /**
   * False for a regeneration or a continued run: a one-shot belongs to the message the user
   * was about to send, and spending it on a run that revises an older answer would leave the
   * next real message with nothing.
   */
  applyMessageScope?: boolean;
}): Promise<ModelParameterPatch | null> {
  const { conversationId, provider, modelId } = args;
  // Consumed here, so the choice applies to this run and to no later one.
  const messageParams =
    args.applyMessageScope === false ? null : takeMessageScope(conversationId);
  const session = args.sessionParams ?? null;
  if (session === null && !messageParams) return null;
  const migrated =
    session === null
      ? {}
      : migrateLegacyThinkingBoolean({ provider, modelId, params: session })
          .params;
  const settled = messageParams
    ? foldMessageScopeIntoSession(migrated, messageParams)
    : migrated;
  return sanitizeParameterPatch(settled);
}
