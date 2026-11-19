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

import { ToolChannelParser, indexOfToolCallMarker } from '@/lib/llm/adapters/ToolChannelParser';
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
  /**
   * True when this turn produced something the user can see: surviving text, a
   * read call, or the not-executed card. The agent loop uses it so a card-only
   * turn is not reported as an empty answer.
   */
  producedOutput(): boolean;
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
    let forwardedContent = false;
    return {
      onEvent: async (event) => {
        if (event.type === 'content_token' && event.content) forwardedContent = true;
        await input.dispatch(event);
      },
      flush: async () => {},
      producedOutput: () => forwardedContent,
    };
  }

  const parser = new ToolChannelParser();
  // The whole turn's visible text, for the one case the parser cannot resolve:
  // markup it suppressed but could not read becomes a "not executed" card (#166).
  let turnText = '';
  let dispatchedToolCall = false;
  let dispatchedNotExecuted = false;
  let forwardedContent = false;

  const forward = async (events: StreamEvent[], toolCallsOnly: boolean) => {
    for (const event of events) {
      if (toolCallsOnly && event.type !== 'tool_call') continue;
      if (event.type === 'content_token') forwardedContent = true;
      if (event.type === 'tool_call') {
        if (event.notExecuted) dispatchedNotExecuted = true;
        else dispatchedToolCall = true;
      }
      await input.dispatch(event);
    }
  };

  return {
    async onEvent(event) {
      if (event.type === 'content_token') turnText += event.content || '';
      // The parser buffers content and suppresses it from the first look-alike
      // marker on, so the markup never reaches the visible answer. Any
      // `stream_complete` it sees flushes the buffer itself and resets.
      await forward(parser.rewriteEvents([event]), false);
    },
    async flush() {
      // Only the synthesised calls; the synthetic completion is not a provider
      // event and must not reach the handlers.
      const events = parser.rewriteEvents([createStreamEvent.streamComplete()]);
      await forward(events, true);

      if (dispatchedToolCall) return;
      // A look-alike that nothing could read: say the model tried and the app
      // did not act, instead of leaving the markup to vanish into nothing.
      const marker = indexOfToolCallMarker(turnText);
      if (marker < 0) return;
      const rawText = turnText.slice(marker).trim();
      if (!rawText) return;
      await input.dispatch(createStreamEvent.toolCall(rawText, undefined, undefined, true));
    },
    producedOutput: () => forwardedContent || dispatchedToolCall || dispatchedNotExecuted,
  };
}
