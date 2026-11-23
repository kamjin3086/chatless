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
| What the model is told | `src/lib/mcp/injection/promptBuilder.ts` - the native contract, or one tool-channel block for the prompt track (#161 / #167) |
| What the request carries | `src/lib/mcp/agentLoop/AgentLoopRunner.ts` - `tools` for the native track, none for the prompt track |
| Turning answer text back into calls | in flight in #161 / #167, in `src/lib/chat/stream/`, over `src/lib/llm/adapters/ToolChannelParser.ts` |
| The formats it reads | `src/lib/mcp/toolInstruction/formats/pipeline.ts` and `handlers/` - a format is a handler, not a branch |
| What the UI gets | `src/lib/chat/stream/handlers/ToolCallEventHandler.ts` → `src/lib/chat/segments.ts` → `src/components/chat/ToolCallCard.tsx`; the wording is `presentToolCard` in `src/components/chat/toolCardPresentation.ts` |

A card state is a value in `segments.ts`'s `ToolCallStatus`; wording lives beside the card, not
in the stream layer.

### Android tools

Four native tools exist only on Android, and the platform gate is the seam that matters:

| Piece | Where |
|---|---|
| The capability table and the per-chat resolver | `src/lib/android/androidCapabilities.ts` - `ANDROID_CAPABILITIES`, `androidCapabilities(conversationId)`, `androidPlatformCapabilities()`, `androidTools`, `androidAllowsCall` |
| What is advertised | `src/lib/mcp/nativeTools/toolRegistry.ts` (`getToolsForGroup`) reads the resolved object; `src/lib/mcp/injection/promptBuilder.ts` and `src/lib/mcp/pipeline/adapters/ToolsRegistryAdapter.ts` are the only callers |
| What is allowed without approval | `src/lib/mcp/pipeline/policy/policy.ts` (`decideServerCall`) reads the same entries through `androidAllowsCall`; `ToolExecutionPipeline.serverGate` passes `androidPlatformCapabilities()` |
| The tools themselves | adapters `AndroidCountdownAdapter`, `AndroidDocumentAdapter`, `AndroidDirectoryAdapter`, `AndroidPhotosAdapter` in `src/lib/mcp/pipeline/adapters/`, each `canHandle` gated on `isAndroidTauri()` (`src/lib/utils/runtimePlatform.ts`) plus its own name rule |

The gate has two levels on purpose. Advertising is per chat: a document attachment, a folder
selection or a photo batch is what turns its tool on, and `androidCapabilities` is the one place
that asks. The approval decision is per platform: a call outside the current chat's scope is
refused by the adapter's executor with a named error (`DOCUMENT_UNAVAILABLE`,
`DIRECTORY_NOT_SELECTED`, `PHOTOS_NOT_SELECTED`, `PHOTOS_UNAVAILABLE`) instead of raising an
approval card the user cannot act on. Adding a capability means adding one entry to
`ANDROID_CAPABILITIES`; the advertised set and the allowed set both iterate it, so they cannot
drift apart. Membership there is security-relevant the same way it is in
`policy/toolRisk.ts` (ADR 0003): an unregistered name is asked about, not allowed.

The phone also loses two desktop servers. `fs` and `shell` are absent from its `core` group,
because `mobile.rs` registers neither the `filesystem_*` commands nor the process ones - and
`src/lib/mcp/nativeTools/mobileUnsupported.ts` is the single list both halves read: the catalog
(no tool to call) and `ToolExecutionPipeline` (a call from an old conversation or a prompt-track
model fails with `ANDROID_TOOL_UNAVAILABLE` and the alternative, before the gate and before any
grant). The platform named in the prompt comes from `getRuntimePlatform()`, which answers `android`
for the phone; its `runtime-environment` block has no `Shell:` line and no command examples, so
the model is never told to reach for `bash` (ADR 0006).

## Parameters and the wire

- The stored bag: `src/types/model-params.ts` (`ModelParameters`, twelve `enable*` flags).
- Send-time assembly: `src/lib/model-parameters.ts` (`shouldSet`), then
  `src/lib/chat/sendParameterMerge.ts` / `sessionParameterMerge.ts`, then the loop.
- Which provider takes which field, and what it is called: `src/lib/llm/provider-field-support.ts`
  is the table the dialogs read; the request path still renames per provider in
  `src/lib/llm/providers/`. Two answers today - #142 is the ticket that merges them.

## Window and chrome

- The preset UI is `src/components/settings/PersonalizationSettings.tsx`; the work-area clamp
  is in flight in #171 (`src-tauri/src/`, `src/lib/window/`).
- Known traps: `docs/tauri-window-pitfalls.md`; screenshotting is `scripts/shot/`.

## Interface language (zh-CN / en-US)

The UI is bilingual, and the seam is that three things have to agree: the dictionaries,
the store that holds the choice, and the components that render it.

| Step | Where |
|---|---|
| The copy | `src/i18n/locales/zh-CN.ts` and `en-US.ts`; the shared key set is `src/i18n/types.ts` (`TranslationKey`) |
| The contract between them | `src/i18n/__tests__/index.test.ts` - same keys both sides, same `{placeholders}` per key |
| The choice and its persistence | `src/store/localeStore.ts` (`locale`, `translate`, `ready`); `<html lang>` is set from it via `getHtmlLang` |
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
