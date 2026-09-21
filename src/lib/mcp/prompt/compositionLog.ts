import { changedBlockIds, type PromptBlock } from './composition';

/**
 * Cache diagnostics.
 *
 * The stable fingerprint must stay identical for every turn of a conversation.
 * When it changes, the log names the blocks that moved instead of leaving the
 * developer to diff two large prompts by hand.
 */

interface CompositionSnapshot {
  stableFingerprint: string;
  blocks: PromptBlock[];
}

const snapshots = new Map<string, CompositionSnapshot>();
const MAX_TRACKED_CONVERSATIONS = 50;

export interface CompositionChange {
  conversationId: string;
  changedBlockIds: string[];
  stableFingerprint: string;
}

export function observePromptComposition(
  conversationId: string,
  composed: { blocks?: PromptBlock[]; stableFingerprint?: string },
): CompositionChange | null {
  const id = String(conversationId || '').trim();
  const blocks = composed.blocks || [];
  const fingerprint = String(composed.stableFingerprint || '');
  if (!id || blocks.length === 0) return null;

  const previous = snapshots.get(id);
  if (snapshots.size >= MAX_TRACKED_CONVERSATIONS && !previous) {
    const oldest = snapshots.keys().next().value;
    if (oldest !== undefined) snapshots.delete(oldest);
  }
  snapshots.set(id, { stableFingerprint: fingerprint, blocks });

  if (previous?.stableFingerprint === fingerprint) return null;
  return {
    conversationId: id,
    changedBlockIds: changedBlockIds(previous?.blocks, blocks),
    stableFingerprint: fingerprint,
  };
}

export function logPromptComposition(
  conversationId: string,
  composed: { blocks?: PromptBlock[]; stableFingerprint?: string },
): void {
  const change = observePromptComposition(conversationId, composed);
  if (!change) return;
  // The first turn reports every block as new, which is the expected baseline.
  console.debug(
    `[prompt] prefix ${change.stableFingerprint} for ${change.conversationId}; changed blocks: ${change.changedBlockIds.join(', ') || 'none'}`,
  );
}

export function resetPromptCompositionLog(): void {
  snapshots.clear();
}
