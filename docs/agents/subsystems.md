# Where the subsystems meet

A map for the seams that cost exploration to find. Not a tour of `src` - one line per
place where two subsystems have to agree, because that is where a change starts.

## Tool calls (native track and prompt track)

The chain, in order, for a single turn:

| Step | Where |
|---|---|
| Which track this run is on | `src/lib/llm/types/tool-capability.ts` (`resolveToolTrack`), read by `src/lib/mcp/agentLoop/resolveAgentToolCapability.ts` |
| What the model is told | `src/lib/mcp/injection/promptBuilder.ts` - the native contract, or `buildToolChannelBlock` once, for the prompt track |
| What the request carries | `src/lib/mcp/agentLoop/AgentLoopRunner.ts` - `tools` for the native track, none for the prompt track |
| Turning answer text back into calls | `src/lib/chat/stream/promptTrack.ts` over `src/lib/llm/adapters/ToolChannelParser.ts`, prompt track only, one pass per turn |
| The formats it reads | `src/lib/mcp/toolInstruction/formats/pipeline.ts` and `handlers/` - a format is a handler, not a branch |
| What the UI gets | `src/lib/chat/stream/handlers/ToolCallEventHandler.ts` → `src/lib/chat/segments.ts` → `src/components/chat/ToolCallCard.tsx` (`presentToolCard` owns the wording) |

A card state is a value in `segments.ts`'s `ToolCallStatus`; wording lives beside the card, not
in the stream layer.

## Parameters and the wire

- The stored bag: `src/types/model-params.ts` (`ModelParameters`, twelve `enable*` flags).
- Send-time assembly: `src/lib/model-parameters.ts` (`shouldSet`), then
  `src/lib/chat/sendParameterMerge.ts` / `sessionParameterMerge.ts`, then the loop.
- Which provider takes which field, and what it is called: `src/lib/llm/provider-field-support.ts`
  is the table the dialogs read; the request path still renames per provider in
  `src/lib/llm/providers/`. Two answers today - #142 is the ticket that merges them.

## Window and chrome

- Size/restore and the work-area clamp: `src-tauri/src/window_fit.rs`, applied in
  `src-tauri/src/lib.rs`'s setup; the preset UI is
  `src/components/settings/PersonalizationSettings.tsx` over `src/lib/window/windowFit.ts`.
- Known traps: `docs/tauri-window-pitfalls.md`; screenshotting is `scripts/shot/`.

## Where the rules live

- Agent behaviour and the PR bar: `docs/agents/maintenance.md`.
- Product identity and what may enter the core: `docs/agents/constraints.md`.
- Model-facing prompt language: `docs/prompt-language.md`.
