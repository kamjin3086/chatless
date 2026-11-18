# Codebase map and source index — 2026-10-24

## Baseline and evidence limits

- Repository: `kamjin3086/chatless`; version in package.json: `0.7.4`.
- Inspected HEAD: `35613a2a242757a2b47f91cb16cbbbbf08efc2ff`.
- Existing worktree modification: `docs/agents/constraints.md`; pre-existing, author not established. This map uses its working-tree content, not only HEAD. No existing file was edited for this inventory.
- Purpose: navigation, architecture, constraint and verification map. This is not a whole-repository correctness audit or a ranked defect report.
- Method: repository instructions and architecture records; source entry points/imports/call sites; root and acceptance test configs; CI configuration; recent subsystem Git history; live read-only GitHub open-issue inventory (22 issues).
- Deepest source tracing: chat entry → runtime/control plane → tools/approval/persistence, plus knowledge indexing/retrieval. Other modules have entry-point coverage only.
- Inventory (includes tests): `src` has 898 TS/TSX files / 162,853 lines; `src-tauri/src` has 33 Rust files / 12,257 lines. File size does not imply a defect.

## Product constraints to apply before proposing changes

Authoritative policy: [constraints](../agents/constraints.md), [AGENTS](../../AGENTS.md), [default permissions](../default-permissions.md), [maintenance](../agents/maintenance.md).

- Local-first, no mandatory cloud account, multi-provider and compatible local endpoints; practical desktop automation with lightweight core.
- Core: provider compatibility, SQLite conversations/messages, streaming/thinking, prompts/attachments, cancellation and approval runtime.
- Official optional capabilities: knowledge/local embedding, MCP, Skills, WebDAV, controlled Coding Pack and advanced automation. Disabled capabilities should approach zero startup/memory/package cost.
- Ecosystem: browser/computer automation and external services should prefer MCP/Skill/adapters. No IDE replacement, default cloud sandbox, automatic PR system or core swarm platform.
- New features must identify users, measurable success, capability layer, disabled cost and maintenance responsibility. Experiments start disabled and need evidence across release cycles.
- Quality budgets: roughly 10–15% Core package growth allowance; cold-start P95 regression below 10%; optional services must not block first paint; preserve compatible endpoints and prompt tool fallback.
- Tool side effects are enforced at runtime. Rust filesystem allowlist is the final file-access boundary; plugin-fs is for app-owned roots. Shell uses current-user privileges and is not an OS sandbox. Shell trust is independent of file trust.
- Default HTTP remains broad for model compatibility; do not interpret the aspiration to narrow defaults as an already implemented restriction.
- The working constraint document still describes Chat/Agent dual-mode preservation and several harness steps as future work. Current source and the September path record describe a unified entry. This tension needs policy clarification before changing behavior; it is not proof of a runtime bug.
- The new Steam Deck/context-handoff direction in the working constraint file is a Labs proposal, not evidence that a capture/overlay subsystem exists.

## Module responsibilities and source index

Links use repository-relative paths and verified source line anchors for the baseline. Line anchors will move after edits; search the named class/function when updating this map.

| Area | Source anchor | Responsibility |
|---|---|---|
| Boot and app shell | [src/components/TauriApp.tsx:24](../../src/components/TauriApp.tsx#L24) | Database initialization, conversation loading, deferred MCP startup, cleanup and update checks. |
| Root layout | [src/app/layout.tsx:31](../../src/app/layout.tsx#L31) | Theme/locale, title bar, tray navigation and dynamic Tauri shell. |
| Chat route | [src/app/chat/page.tsx:1](../../src/app/chat/page.tsx#L1) | Route composition; follow components and hooks rather than treating this as the runtime. |
| Conversation actions | [src/hooks/useChatActions.ts:35](../../src/hooks/useChatActions.ts#L35) | Send, regenerate, steering and cancellation; composes history and request options. |
| Conversation state | [src/store/chatStore.ts:67](../../src/store/chatStore.ts#L67) | Lazy message loading, memory streaming updates, persisted messages and run activity. |
| Message state machine | [src/lib/chat/messageFsm.ts:1](../../src/lib/chat/messageFsm.ts#L1) | Message transitions consumed by the chat store. |
| History | [src/lib/chat/HistoryBuilder.ts:1](../../src/lib/chat/HistoryBuilder.ts#L1) | Builds model history from conversation messages. |
| Option composition | [src/lib/chat/OptionComposer.ts:1](../../src/lib/chat/OptionComposer.ts#L1) | Composes request options; parameter layers live alongside it in chat/. |
| Parameter semantics | [src/lib/model-parameters.ts:1](../../src/lib/model-parameters.ts#L1) | Stored bag normalization and per-field application rules. |
| Wire field support | [src/lib/llm/provider-field-support.ts:1](../../src/lib/llm/provider-field-support.ts#L1) | Provider field support and wire names; inspect wireOptions.ts for serialization. |
| Thinking | [src/lib/llm/thinkingLevels.ts:1](../../src/lib/llm/thinkingLevels.ts#L1) | Model/provider thinking levels; chat/thinkingScope.ts resolves user scope. |
| Agent runtime | [src/lib/mcp/agentLoop/AgentLoopRunner.ts:85](../../src/lib/mcp/agentLoop/AgentLoopRunner.ts#L85) | Runs model steps and ordered tools, owns active runs, cancellation and steering. |
| Tool track selection | [src/lib/mcp/agentLoop/resolveAgentToolCapability.ts:1](../../src/lib/mcp/agentLoop/resolveAgentToolCapability.ts#L1) | Resolves native versus prompt tool capability. |
| Control plane | [src/lib/mcp/agentLoop/AgentRunControlPlane.ts:23](../../src/lib/mcp/agentLoop/AgentRunControlPlane.ts#L23) | Ordered events, history projection, context compaction and checkpoint reuse. |
| Run persistence bridge | [src/lib/mcp/agentLoop/AgentRunEventStore.ts:8](../../src/lib/mcp/agentLoop/AgentRunEventStore.ts#L8) | Native desktop commands with SQL fallback; run lineage, events, statuses, approvals and checkpoints. |
| Native durable operations | [src-tauri/src/lib/agent_runtime.rs:258](../../src-tauri/src/lib/agent_runtime.rs#L258) | Rust run/event/approval commands; also document batch publication and dense retrieval. |
| Prompt construction | [src/lib/mcp/agentLoop/buildAgentPromptEnvelope.ts:1](../../src/lib/mcp/agentLoop/buildAgentPromptEnvelope.ts#L1) | Runtime prompt envelope; mcp/prompt/composition.ts composes system content. |
| Context budget | [src/lib/mcp/pipeline/context/ContextWindowManager.ts:1](../../src/lib/mcp/pipeline/context/ContextWindowManager.ts#L1) | Token budget, compaction and summary checkpoints. |
| Event projection | [src/lib/mcp/pipeline/context/ConversationEventLog.ts:1](../../src/lib/mcp/pipeline/context/ConversationEventLog.ts#L1) | Conversation events rendered into model messages. |
| Model dispatcher | [src/lib/llm/interpreter.ts:23](../../src/lib/llm/interpreter.ts#L23) | Provider dispatch and request-scoped cancellation bookkeeping. |
| Endpoint scheduling | [src/lib/llm/ModelRequestScheduler.ts:1](../../src/lib/llm/ModelRequestScheduler.ts#L1) | Queues requests at endpoint/model boundary. |
| Provider construction | [src/lib/llm/strategy-factory.ts:19](../../src/lib/llm/strategy-factory.ts#L19) | Constructs native/provider strategies, including per-model protocol delegation. |
| Provider catalog | [src/lib/provider/catalog.ts:1](../../src/lib/provider/catalog.ts#L1) | Shipped provider definitions; provider/services owns initialization and model discovery. |
| Stream projection | [src/lib/chat/stream/StreamOrchestrator.ts:1](../../src/lib/chat/stream/StreamOrchestrator.ts#L1) | Stream handlers update content, thinking and collected tool calls. |
| Prompt tool parsing | [src/lib/chat/stream/promptTrack.ts:1](../../src/lib/chat/stream/promptTrack.ts#L1) | Prompt-track tool extraction; mcp/toolInstruction handles supported syntaxes. |
| Tool execution | [src/lib/mcp/pipeline/ToolExecutionPipeline.ts:50](../../src/lib/mcp/pipeline/ToolExecutionPipeline.ts#L50) | Deduplication, cancellation, plan gate, approval, grants, adapter dispatch and reporting. |
| Pure policy | [src/lib/mcp/pipeline/policy/policy.ts:1](../../src/lib/mcp/pipeline/policy/policy.ts#L1) | Filesystem/server decisions and scope-specific approval promotion plans. |
| Risk table | [src/lib/mcp/pipeline/policy/toolRisk.ts:1](../../src/lib/mcp/pipeline/policy/toolRisk.ts#L1) | Tool risk classification; plan permission and safe replay are distinct predicates. |
| Call coordination | [src/lib/mcp/ToolCallCoordinator.ts:1](../../src/lib/mcp/ToolCallCoordinator.ts#L1) | Call locks, cancellation and activity coordination. |
| Approval state | [src/store/authorizationStore.ts:1](../../src/store/authorizationStore.ts#L1) | Pending approvals and decision state; pipeline/approvalWait.ts consumes it. |
| Filesystem grants | [src/lib/filesystemAllowlist/backendSync.ts:1](../../src/lib/filesystemAllowlist/backendSync.ts#L1) | Mirrors allowlist and registers/revokes call-scoped grants. |
| Filesystem enforcement | [src-tauri/src/filesystem/state.rs:1](../../src-tauri/src/filesystem/state.rs#L1) | Backend allowlist state; commands.rs applies it to file operations. |
| Session workspaces | [src/lib/agentWorkspace/workspaceService.ts:44](../../src/lib/agentWorkspace/workspaceService.ts#L44) | Resolves/materializes workspace through Rust workspace commands. |
| Shell adapter | [src/lib/mcp/pipeline/adapters/ShellExecutorAdapter.ts:1](../../src/lib/mcp/pipeline/adapters/ShellExecutorAdapter.ts#L1) | Tool pipeline to shell execution; shell/commandPlan.ts selects interpreter. |
| Native process execution | [src-tauri/src/sandbox/commands.rs:1](../../src-tauri/src/sandbox/commands.rs#L1) | Shell execution, managed processes and lifecycle operations. |
| MCP lifecycle | [src/lib/mcp/ServerManager.ts:1](../../src/lib/mcp/ServerManager.ts#L1) | Frontend server management; McpClient and executor/ConnectionManager bridge to Rust mcp/. |
| Skills | [src/lib/skills/SkillManager.ts:1](../../src/lib/skills/SkillManager.ts#L1) | Skill discovery and assets; SkillMdParser parses SKILL.md; SkillOrchestrator routes actions. |
| Database service | [src/lib/database/services/DatabaseService.ts:18](../../src/lib/database/services/DatabaseService.ts#L18) | Singleton initialization, repositories and indexing queue resumption. |
| SQLite boundary | [src/lib/database/core/DatabaseManager.ts:34](../../src/lib/database/core/DatabaseManager.ts#L34) | Tauri SQL connection, configuration, migration and transactions. |
| Schema registry | [src/lib/migrations/registry.ts:1](../../src/lib/migrations/registry.ts#L1) | Migrations 001–018: conversations/messages, RAG batches, events, approvals, lineage. |
| Knowledge orchestration | [src/lib/knowledgeService.ts:1](../../src/lib/knowledgeService.ts#L1) | Knowledge-base membership and document indexing orchestration. |
| Document indexing | [src/lib/indexing/DocumentIndexer.ts:17](../../src/lib/indexing/DocumentIndexer.ts#L17) | Extracts structured blocks, creates chunks, publishes lexical index then queues dense enhancement. |
| Index/evidence storage | [src/lib/rag/evidenceStore.ts:1](../../src/lib/rag/evidenceStore.ts#L1) | Document batch publication, evidence reads and retrieval persistence boundary. |
| Dense task queue | [src/lib/indexing/SemanticIndexQueue.ts:1](../../src/lib/indexing/SemanticIndexQueue.ts#L1) | Resumable semantic indexing work; EmbeddingService selects embedding strategy. |
| Evidence retrieval | [src/lib/rag/retrieveEvidence.ts:44](../../src/lib/rag/retrieveEvidence.ts#L44) | Checks active index, uses lexical baseline and optional dense retrieval. |
| Search fusion | [src/lib/retrieval/RetrievalService.ts:1](../../src/lib/retrieval/RetrievalService.ts#L1) | Vector/lexical retrieval and RRF; native dense scan lives in agent_runtime.rs. |
| Knowledge tools | [src/lib/mcp/nativeTools/knowledge.ts:1](../../src/lib/mcp/nativeTools/knowledge.ts#L1) | Knowledge tool surface; pipeline/adapters/KnowledgeAdapter.ts executes it. |
| Message rendering | [src/components/chat/ChatMessageList.tsx:1](../../src/components/chat/ChatMessageList.tsx#L1) | Message-list surface; ChatMessage, AIMessageBlock and ToolCallCard render content/activity. |
| Markdown boundary | [src/components/chat/LazyStreamingMarkdown.tsx:1](../../src/components/chat/LazyStreamingMarkdown.tsx#L1) | Lazy import boundary around StreamingMarkdown and its heavy dependencies. |
| Sync | [src/lib/sync/core/SyncManager.ts:37](../../src/lib/sync/core/SyncManager.ts#L37) | Coordinates adapters, conflict resolution and transport; WebDAVTransport is under sync/transports/. |
| Native registration | [src-tauri/src/lib.rs:120](../../src-tauri/src/lib.rs#L120) | Tauri plugins, managed state and command registration. |
| Locale | [src/i18n/index.ts:1](../../src/i18n/index.ts#L1) | Locale entry; localeStore persists user choice; extraction work remains in issue tracker. |

## Core execution chains

### Startup and persistence

`app/layout.tsx → TauriApp → initDatabaseService → DatabaseService → DatabaseManager → migrations → repositories → chatStore.loadConversations`.

TauriApp defers environment checks/sample initialization and starts MCP in the background. DatabaseService resumes semantic-index tasks after initialization. Native plugin/state/command registration starts in `src-tauri/src/lib.rs`. The frontend is Next static export (`output: export`, `distDir: dist`) inside Tauri, not a deployed Next server.

State has several owners: chatStore holds live UI/message state; SQL repositories store conversations/messages; AgentRunEventStore stores run/event/approval/checkpoint records through native desktop commands; settings use storage/Zustand stores. Do not assume updating a message atomically updates a run event, or that Zustand persistence is the sole database.

### Send, stream, tools and stop

1. Chat UI calls `useChatActions`; normal send and regeneration invoke `AgentLoopRunner.run` (baseline lines 663 and 1156).
2. `HistoryBuilder`, send parameter merge and `OptionComposer` prepare history/options. Provider fields, thinking scope and wire serialization have separate modules.
3. Runner starts a control plane, resolves tool track and builds a prompt envelope. Control plane assembles model history with event projection and context budgeting.
4. Interpreter/provider strategy streams the request; endpoint scheduler and request IDs isolate request dispatch/cancellation. Provider implementations normalize protocol events; StreamOrchestrator projects content, thinking and tool calls into the UI/store.
5. Runner collects the completed model step, persists model/tool-request events, then executes tool calls in order through ToolExecutionPipeline. Results feed the next model step.
6. Pipeline resolves adapter, lock and cancellation; checks plan mode and policy; waits for approvals when required; registers call-scoped grants; executes/reports and revokes temporary grants.
7. Stop calls runner cancellation; steering queues input to a safe boundary. UI run state, stream request state, approval wait and native process state are separate boundaries to exercise in the later audit.

Native and prompt tracks share the runner and tool pipeline. Prompt parsing enters via `chat/stream/promptTrack.ts` and `mcp/toolInstruction`; native events enter provider adapters. Unsupported textual calls have a not-executed presentation path following commit `35613a2`.

### File access, workspaces and shell

`attachment/workspace state → workspaceService → Rust workspace commands` resolves `@WorkDir`; the default session directory is materialized on first actual use. User attachment directories and per-call grants have different lifetimes.

`tool invocation → pipeline policy/resolveCall → approvalWait → backendSync grants → filesystemCommands → Rust filesystem commands/state` is the enforced file path. Historical server names may still parse without being routable. Policy functions are pure; the pipeline owns store writes, approval waits and grant side effects (ADRs 0001–0004).

`shell adapter → nativeTools/shellExecutor + shell/commandPlan → Rust sandbox commands` is the command path. Audit current execution semantics rather than inferring sandbox guarantees from directory names. Workspace cwd is not containment.

### Knowledge indexing and retrieval

`KnowledgeService / document service → DocumentIndexer → DocumentExtractionService / structured blocks → chunks → EvidenceStore.replaceDocumentIndex → native document-batch publication` publishes source/lexical content first. SemanticIndexQueue then enhances it with EmbeddingService and native embedding storage.

`knowledge tool → KnowledgeAdapter → retrieveEvidence → active document index → lexical search + optional dense search → RetrievalService/RRFFusion → evidence/citations/read tools` is the lookup path. The current implementation explicitly supports lexical retrieval without a usable embedding model; never equate absent embeddings with wholly unavailable knowledge search.

Document identity, active index batch/version, knowledge-base membership, attachment scope and embedding fingerprint are distinct concepts. Their intersections are a later correctness-review target, not an established defect here.

### Optional integrations

MCP: ServerManager/McpClient/ConnectionManager bridge discovery and calls to Rust MCP state/commands. Skills: manager/parser/loaders own assets; unified skill tools and SkillOrchestrator route actions; execution modules delegate controlled processes. WebDAV: SyncManager coordinates data adapters, ConflictResolver and transport. These were navigated at entry-point level; their full error/revocation/retry behavior was not audited.

## Test and verification map

| Gate | Actual scope | Limit |
|---|---|---|
| `pnpm test` | Root Vitest config: src `__tests__/*.test.ts`, all acceptance audits, scripts `.test.mjs` | Node/mocks do not prove desktop or real-provider behavior; env/fixture suites can skip |
| `pnpm typecheck` | Root production TypeScript config | Excludes test files |
| `pnpm typecheck:tests` | Production + src test TS + acceptance TS | Does not replace runtime collection; scripts JS tests are separately collected |
| `pnpm verify:fast` | lint:ci + both typechecks + pnpm test | No production build |
| `pnpm verify` | verify:fast + production build | Run before pushing; prebuild can update generated files |
| `pnpm test:acceptance` | Separate acceptance config | Live model tests require env opt-in; retrieval eval needs generated fixtures |
| `cargo check` | Rust compilation, active basic CI job | Does not execute Rust tests |
| `cargo test` | Embedded Rust tests, including filesystem/process modules | Not executed in this map pass; platform/native prerequisites apply |
| Desktop harness | `scripts/e2e/desktop-e2e.mjs`, startup scripts and documented manual probes | Not executed; cannot infer coverage from file existence |

Source/test filename inventory: 132 source-tree tests, 9 script tests, 9 acceptance audits. Rust tests are embedded in `.rs` modules (77 test attributes found); zero `*.test.*` Rust files is not zero Rust coverage.

Useful deterministic suites:

- Runtime: `mcp/agentLoop/__tests__/{AgentLoopRunner,AgentRunControlPlane,capabilityTrack,resolveAgentToolCapability}.test.ts`.
- Context/history: `pipeline/context/__tests__/{ContextWindowManager,ConversationEventLog}.test.ts`.
- Permissions: `pipeline/policy/__tests__/{policy,toolRisk,resolveCall}.test.ts`; pipeline approval/promotion/fs-gate/alias tests.
- Protocol: `llm/providers/__tests__/{nativeToolStreams,messageMapping,requestBodyExcludesAppOptions}.test.ts`; interpreter cancellation and scheduler tests.
- Streaming: `chat/stream/__tests__`; store streamingFlush; lazy-markdown gate/fallback tests.
- Parameters: send/session parameter merge, thinking scope, wireOptions/provider-field tests.
- Knowledge: `rag`, `retrieval`, `embedding`, `chunking` test directories; fixture/live audits in docs/acceptance.
- Repo guardrails: script Vitest inventory, formatting, comment symbol, reply and Git/worktree tests.

Observed run on 2026-10-24: **146 test files passed, 4 skipped (150); 1048 tests passed, 4 skipped (1052); exit 0; Vitest duration 2.85 s**. Log: `/tmp/chatless-map-tests-20261024.log` (temporary, not a durable fixture).

Skipped audits are not acceptance evidence. No typecheck, lint, production build, Rust execution, GUI, live-model evaluation, crash recovery, real WebDAV or cross-platform test was run in this mapping pass.

CI inspection: `.github/workflows/ci.yml` actively runs frontend lint/typechecks/tests and Rust `cargo check` on eligible PRs; its three full platform jobs currently have `if: false`. There is no push trigger in that workflow. Other release/build workflows exist and were inventoried, not validated. Do not describe basic CI as a full desktop release build.

Operational trap: dev and build share `dist`; stop dev before production build. The historical ~17–18 minute build is a recorded observation, not a timing measured in this pass. Do not load sibling models on the shared inference endpoint merely to probe compatibility.

## Historical evidence and current issue pointers

Historical records are hypotheses to re-check at HEAD. They often describe a specific September commit and include subsequently fixed gaps.

| Theme | Evidence | Interpretation for the next review |
|---|---|---|
| Runtime durability and unknown side effects | `docs/agent-chat-path-comparison.md` (2026-09-16); `docs/agent-knowledge-final-audit-2026-09-21.md`; commits `6f3299e`, `7f07ed5`, `b8822ad` | Native run/event/approval methods and checkpoints now exist and are wired; exact crash recovery and safe continuation still require execution evidence |
| Knowledge calls on compatible endpoints | [#156](https://github.com/kamjin3086/chatless/issues/156), technical [#160](https://github.com/kamjin3086/chatless/issues/160); HEAD fix `35613a2` / PR #167 | Both issues remain open; implementation changed. Read latest reporter evidence and reproduce before reporting the original cause as current |
| Parameter representation | [#140](https://github.com/kamjin3086/chatless/issues/140), decision [#172](https://github.com/kamjin3086/chatless/issues/172), work #173–175 | Stored inherit/override/do-not-send semantics have an explicit owner decision dependency; latest wire fixes do not imply migration design is settled |
| Provider field table | [#142](https://github.com/kamjin3086/chatless/issues/142); commits `2620875`, `e83e776` | Request path now reads the field table; open issue state alone is stale implementation evidence |
| Reachable model probe | Commit `65c6055` / #189 | Truncated probe answer is treated as reachable; preserve connection-check versus generation-success distinction |
| Error recovery UI | [#135](https://github.com/kamjin3086/chatless/issues/135) | Existing scoped recovery proposal based on a reported client exception; current runtime behavior not reproduced here |
| Window sizing | [#169](https://github.com/kamjin3086/chatless/issues/169) | Reported logical/physical-pixel mismatch; needs native work-area/DPI validation |
| Startup instrumentation | [#170](https://github.com/kamjin3086/chatless/issues/170); `19c6b00` dev:warm | Warm-up is implemented; historical probes do not establish present instrumentation coverage |
| Markdown package cost | [#168](https://github.com/kamjin3086/chatless/issues/168), measurement task [#183](https://github.com/kamjin3086/chatless/issues/183); lazy gate test commit `262ab72` | Lazy boundary is guarded; attribution and user value require bundle measurement |
| Localization | [#14](https://github.com/kamjin3086/chatless/issues/14), #179–182 | Key scheme/ratchet and settings/knowledge/resource extraction backlog; compare against current locale implementation |
| Thinking capabilities | [#128](https://github.com/kamjin3086/chatless/issues/128) | Per-model carrier proposal; capability table is not universal protocol verification |
| Repo tooling | #159 comment doc-path validation; #157 dev-theme setup; commits `a12900f`, `f882e4e` | Historical Windows script load failures and stale-symbol checks have later fixes; do not copy old maintenance notes as current failures |
| Product boundary | [#72](https://github.com/kamjin3086/chatless/issues/72) mobile request | Open request does not override explicit current non-goal |

Additional reading: `docs/issue-triage-2026-09-30.md`, `docs/llm-troubleshooting.md`, `docs/streaming-render-acceptance-2026-09-24.md`, `docs/workspace-budget-acceptance-2026-09-22.md`, `docs/model-parameters-semantics-2026-09-24.md`, `docs/skills-architecture.md`, `docs/sync-architecture.md`, `docs/tauri-window-pitfalls.md`.

## Coverage ledger and next review order

| Area | Mapping coverage | What remains to establish |
|---|---|---|
| Product constraints/default permission docs | Read; compared against selected current code | Resolve unified-entry/dual-mode wording before behavior proposals |
| Chat/runtime/tools | Key call sites and state/persistence seams traced | Cancellation races, approval revocation, side-effect uncertainty and failure injection |
| Providers/parameters | Dispatch, factory, request bookkeeping and recent fixes inspected | Per-provider real wire behavior, scope precedence and migration compatibility |
| Knowledge | Index publication and retrieval entry branches traced | Scope intersections, stale versions, cancellation, lexical/dense quality and native DB transactions |
| UI/startup | Layout/TauriApp/rendering entry points inspected | Desktop render/recovery, startup timings, long-chat performance, DPI/platform behavior |
| MCP/Skills/WebDAV | Directory and responsibility/entry-point inventory | Full call/error/lifecycle tracing and integration tests |
| Native filesystem/shell | Commands/state/registration and policy boundary mapped | Full implementation audit, symlinks/junctions/process trees and native tests |
| Release/update | Script/workflow inventory only | Signatures, updater metadata and cross-platform packaging |

Suggested next pass: first trace data/side-effect safety and cancellation across native boundaries; then compatible-provider tool tracks and parameter wire semantics; then knowledge scope/index correctness; finally measure startup/streaming/bundle cost. This is a risk-based investigation order, not a finding severity ranking.

For every candidate require: reachable trigger → exact source cause → existing protections considered → user impact → reproduction/test/measurement → counterexample attempt. Keep unverified candidates out of the confirmed-issue list. Reuse this map for navigation but reopen raw source before judging behavior.
