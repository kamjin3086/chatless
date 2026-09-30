import type { Message as LlmMessage } from '@/lib/llm/types';

/**
 * Prompt composition.
 *
 * Every request carries exactly one system message.  Its blocks are ordered by
 * how long they can be expected to stay the same, so the byte prefix that
 * providers cache stays stable for as long as possible:
 *
 *   stable       - identical for this app version + interface language
 *   conversation - stable until the user changes mounts, workspace or settings
 *   turn         - may change on every request (time, plan-only mode)
 *
 * Turn blocks come last, so a changing clock no longer invalidates the prefix.
 */

export type PromptLayer = 'stable' | 'conversation' | 'turn';

export interface PromptBlock {
  /** Stable identifier, also used to explain what changed between turns. */
  id: string;
  layer: PromptLayer;
  /** Order inside the layer; lower first. Equal orders keep insertion order. */
  order: number;
  content: string;
}

export interface ComposedPrompt {
  /** The one system message for this request. */
  systemMessage: LlmMessage;
  /** Blocks actually rendered, in order. */
  blocks: PromptBlock[];
  /**
   * Fingerprint of the stable + conversation prefix.  Two requests with the
   * same value share a cacheable prefix; the id list explains any change.
   */
  stableFingerprint: string;
  /** Fingerprint of the whole message, turn blocks included. */
  fullFingerprint: string;
}

export const PROMPT_BLOCK_SEPARATOR = '\n\n';

const LAYER_RANK: Record<PromptLayer, number> = { stable: 0, conversation: 1, turn: 2 };

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}:${value.length}`;
}

export function orderBlocks(blocks: PromptBlock[]): PromptBlock[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const layer = LAYER_RANK[a.block.layer] - LAYER_RANK[b.block.layer];
      if (layer !== 0) return layer;
      if (a.block.order !== b.block.order) return a.block.order - b.block.order;
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}

function render(blocks: PromptBlock[]): string {
  return blocks
    .map((block) => String(block.content || '').trim())
    .filter(Boolean)
    .join(PROMPT_BLOCK_SEPARATOR);
}

export function composeSystemPrompt(blocks: PromptBlock[]): ComposedPrompt {
  const ordered = orderBlocks((blocks || []).filter((block) => String(block?.content || '').trim()));
  const stableBlocks = ordered.filter((block) => block.layer !== 'turn');
  const stablePrefix = render(stableBlocks);
  const full = render(ordered);
  return {
    systemMessage: { role: 'system', content: full },
    blocks: ordered,
    stableFingerprint: fnv1a(stablePrefix),
    fullFingerprint: fnv1a(full),
  };
}

/** Ids of the blocks that differ between two compositions, for diagnostics. */
export function changedBlockIds(previous: PromptBlock[] | undefined, next: PromptBlock[]): string[] {
  const previousById = new Map((previous || []).map((block) => [block.id, String(block.content || '').trim()]));
  const changed: string[] = [];
  for (const block of next) {
    const before = previousById.get(block.id);
    const after = String(block.content || '').trim();
    if (before !== after) changed.push(block.id);
    previousById.delete(block.id);
  }
  return [...changed, ...previousById.keys()];
}
