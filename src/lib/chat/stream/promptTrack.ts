/**
 * The prompt tool track's stream rewrite.
 *
 * A run that cannot use native tools has `tools` removed from its request, so the
 * model writes its call as text — `<use_mcp_tool>…`, `<tool_call>…`, the
 * GPT-OSS channel form — and, without this, that text is simply displayed as the
 * answer. The composer (#163) tells such a run which tools it may call; this
 * turns the answer back into the `tool_call` events the rest of the agent loop
 * already consumes, so the existing card, approval and stop paths are the ones
 * that run.
 *
 * Native runs must never parse text: a model that supports tools can also echo a
 * call in prose, and executing that echo would run one tool twice for one
 * question. So the decision is the run's track, resolved once, not a heuristic.
 */

import { ToolChannelParser } from '@/lib/llm/adapters/ToolChannelParser';
import type { StreamEvent } from '@/lib/llm/types/stream-events';
import { createStreamEvent } from '@/lib/llm/types/stream-events';
import type { ToolTrack } from '@/lib/llm/types/tool-capability';

export interface PromptToolTrack {
  /** Feed every provider event through here; what survives is handed to `dispatch`. */
  onEvent(event: StreamEvent): Promise<void>;
  /**
   * End of the turn. Providers do not all emit `stream_complete` — completion is
   * the callback — so the buffered text is parsed here, once, before the answer
   * is finalised.
   */
  flush(): Promise<void>;
}

export function createPromptToolTrack(input: {
  /** `native` and `disabled` runs are pass-throughs. */
  track: ToolTrack;
  /**
   * False for a regeneration: that run is not allowed to call tools, so text must
   * not become a call there either. Native runs have no equivalent text to parse,
   * which is why the two tracks behave the same without it.
   */
  allowTextCalls?: boolean;
  /** Where surviving events go: the orchestrator's event path, in order. */
  dispatch: (event: StreamEvent) => Promise<void> | void;
}): PromptToolTrack {
  const parseText = input.track === 'prompt' && input.allowTextCalls !== false;

  if (!parseText) {
    return {
      onEvent: async (event) => {
        await input.dispatch(event);
      },
      flush: async () => {},
    };
  }

  const parser = new ToolChannelParser();

  const forward = async (events: StreamEvent[], toolCallsOnly: boolean) => {
    for (const event of events) {
      if (toolCallsOnly && event.type !== 'tool_call') continue;
      await input.dispatch(event);
    }
  };

  return {
    async onEvent(event) {
      // The parser buffers content and suppresses it from the first look-alike
      // marker on, so the markup never reaches the visible answer. Any
      // `stream_complete` it sees flushes the buffer itself and resets.
      await forward(parser.rewriteEvents([event]), false);
    },
    async flush() {
      // Only the synthesised calls; the synthetic completion is not a provider
      // event and must not reach the handlers.
      await forward(
        parser.rewriteEvents([createStreamEvent.streamComplete()]),
        true,
      );
    },
  };
}
