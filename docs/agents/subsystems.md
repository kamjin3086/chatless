# Where the subsystems meet

A map for the seams that cost exploration to find. Not a tour of `src` - one line per
place where two subsystems have to agree, because that is where a change starts.

Paths here exist on the branch this file landed on, and each symbol is named with the file
that defines it. Work that is in flight is named by issue/PR instead of by path, so the map
stays true until it lands and gets its row.

## Tool calls (native track and prompt track)

The chain, in order, for a single turn:

| Step | Where |
|---|---|
| Which track this run is on | `src/lib/mcp/agentLoop/resolveAgentToolCapability.ts`, over the capability table in `src/lib/llm/config/tool-call-config.ts` |
| What the model is told | `src/lib/mcp/injection/promptBuilder.ts` - the agent contract on both tracks, plus one tool-channel block when the run is on the prompt track |
| What the request carries | `src/lib/mcp/agentLoop/AgentLoopRunner.ts` - `tools` for the native track, none for the prompt track |
| Turning answer text back into calls | `src/lib/chat/stream/promptTrack.ts`, over `src/lib/llm/adapters/ToolChannelParser.ts`; the text that survives reaches the UI through `src/lib/chat/stream/handlers/ContentEventHandler.ts` |
| The formats it reads | `src/lib/mcp/toolInstruction/formats/pipeline.ts` and `handlers/` - a format is a handler, not a branch |
| What the UI gets | `src/lib/chat/stream/handlers/ToolCallEventHandler.ts` → `src/lib/chat/segments.ts` → `src/components/chat/ToolCallCard.tsx`; the wording is `presentToolCard` in `src/components/chat/toolCardPresentation.ts` |

A card state is a value in `segments.ts`'s `ToolCallStatus`; wording lives beside the card, not
in the stream layer.

## Parameters and the wire

- The stored bag: `src/types/model-params.ts` (`ModelParameters`, twelve `enable*` flags).
- Send-time assembly: `src/lib/model-parameters.ts` (`shouldSet`), then
  `src/lib/chat/sendParameterMerge.ts` / `sessionParameterMerge.ts`, then the loop.
- Which provider takes which field, and what it is called: `src/lib/llm/provider-field-support.ts`
  (`PROVIDER_CONFIGS`, `mapProviderFields`) is the one table, read by the dialogs **and** by every
  provider under `src/lib/llm/providers/` - #142 closed that gap through #184 and #187. What must
  never reach the wire is a narrower, separate rule: `src/lib/llm/wireOptions.ts`.

## Output budget and history compaction

Two parameter-looking things are not both request knobs, and that split is the part worth
remembering:

- **Output length belongs to the provider and the model.** In automatic mode `max_tokens` is
  **not sent at all** - `ModelParametersService.applyOutputBudget` in
  `src/lib/model-parameters.ts` is the single decision point, and a user-set value is
  clamped to the effective window by `resolveOutputBudget` in
  `src/lib/llm/outputBudget.ts`. The one protocol that requires the field is Anthropic:
  `AnthropicProvider` fills its own floor (window/8, clamped to 1024-8192, otherwise the
  manual default) and does not pretend that was a user setting.
- **`contextWindowTokens` only decides whether history gets compacted.** An unknown window
  means no compaction and no blocked send - `ContextWindowManager` returns the history
  as-is - and the server decides whether the request fits. The window comes from the
  provider's reported value or the user's manual entry, whichever is smaller.

Compaction itself, in order: `AgentRunControlPlane.assembleRoundMessages` estimates before
each model round and compacts only when the window is known, the estimate passes 80 % of the
budget, and a `user` boundary exists. The summary is a separate low-priority LLM call, written
to a run checkpoint (`kind: context_summary`, `src/lib/mcp/agentLoop/AgentRunEventStore.ts`)
and reused - within a round when the prefix fingerprint matches, across rounds from a
per-conversation in-process cache that summarizes only the new stretch. Any failure keeps the
original history and fails the round; a lost constraint is never quietly accepted.
`src/components/chat/ContextCompactionNotice.tsx` marks the rounds that used a summary
(`chatUi.compaction.summary`); that notice is in-process state and is not persisted.

## Window and chrome

- The preset UI is `src/components/settings/PersonalizationSettings.tsx`. The work-area clamp
  landed in #171: `src/lib/window/windowFit.ts` on the web side, `window_fit.rs` in `src-tauri/src/`
  on the native side, with `src/lib/window/windowState.ts` and `windowControls.ts` beside them.
- Known traps: `docs/tauri-window-pitfalls.md`; screenshotting is `scripts/shot/`.

## Interface language (zh-CN / en-US)

The UI is bilingual, and the seam is that three things have to agree: the dictionaries,
the store that holds the choice, and the components that render it.

| Step | Where |
|---|---|
| The copy | `src/i18n/locales/zh-CN.ts` and `en-US.ts`; the shared key set is `src/i18n/types.ts` (`TranslationKey`) |
| The contract between them | `src/i18n/__tests__/index.test.ts` - same keys both sides, same `{placeholders}` per key |
| The choice and its persistence | `src/store/localeStore.ts` (`locale`, `t`, `initialized`); `<html lang>` is set from it via `getHtmlLang` |
| Reading it in a component | `useTranslation()` in `src/i18n/useTranslation.ts`; outside React, `useLocaleStore.getState().t` |
| Applying it without a reload | components must read `t` at render time - a label built once at module scope keeps the language it was built in |

Three consequences that are easy to miss from inside a component:

- **A new key is three edits**: both dictionaries and `types.ts`. The dictionary files
  are append-only for formatting reasons - a reflow of one is a 2,000-line diff.
- **Anything persisted as text is frozen in the language it was written in**. Stopped-run
  markers, send-failure reasons and seeded knowledge data are stored strings, so they
  render as stored; translating them at render time needs the event, not the sentence.
- **Model-facing text is not UI text.** Prompts stay English regardless of the interface
  language (`docs/prompt-language.md`), and `src/lib/prompts/__tests__/prompt-language.test.ts`
  also checks the one prompt assembled in the send path.
- **Provider and catalogue labels travel with the language too**: `src/lib/models.json`
  carries `descriptionEn` beside the Chinese description, and the model managers pick
  per locale. A model *name* is an identifier and is never translated.

Verification, in order: `npx vitest run src/i18n src/lib/prompts`, then
`node scripts/e2e/i18n-locale-acceptance.mjs` against a built binary (`CHATLESS_E2E_APP`)
with a WebDriver on `127.0.0.1:4444` - it switches language in the real window, walks every
route and settings tab, and fails on Chinese interface copy left behind.

## Where the rules live

- Agent behaviour and the PR bar: `docs/agents/maintenance.md`.
- Product identity and what may enter the core: `docs/agents/constraints.md`.
- Model-facing prompt language: `docs/prompt-language.md`.
