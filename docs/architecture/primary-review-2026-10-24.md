# Primary review and verification — 2026-10-24

Final adjudication: [final review](final-review-2026-10-24.md) supersedes priorities below, strengthens R1, downgrades R2, and adds permission/synchronization findings. The original evidence is preserved here.

## Scope and baseline

Baseline: `35613a2a242757a2b47f91cb16cbbbbf08efc2ff`, unchanged during this pass. Navigation: [codebase map](codebase-map-2026-10-24.md).

Existing `docs/agents/constraints.md` edits remain untouched (authorship unknown). The codebase map is from this chat's earlier pass. This pass adds only this evidence report and three explicit-run probe files. No runtime implementation was modified; no GitHub issue/comment was posted.

Reviewed chains: send/stop → AgentLoopRunner → stream callbacks/model-step persistence → ordered tool pipeline; approval registration/decision; file adapter and unknown-result classification; MCP result propagation; evidence read/index-batch identity. Also traced request cancellation/scheduling and native/prompt tool track boundaries against existing regression tests. This is a bounded primary review, not whole-repository certification.

The four entries below have executable reproductions at the actual TypeScript seams. Fixtures replace database/IPC/server I/O; no live model, native desktop interaction or Rust command was executed. Priority is proposed, not an observed incident frequency.

## Findings

### R1 — P1: Stop can miss an approval that is still being persisted

**Trigger:** A tool requires approval; its pending database insert/native command is in flight. The user presses Stop before `addPendingAuthorization` runs.

**Call chain and cause:**

- [Stop handler](../../src/hooks/useChatActions.ts#L814) cancels the coordinator and runner, then rejects approvals currently in the authorization store.
- [waitForCallApproval](../../src/lib/mcp/pipeline/approvalWait.ts#L17) awaits persistence before [registering its in-memory callback](../../src/lib/mcp/pipeline/approvalWait.ts#L51).
- [Store rejection](../../src/store/authorizationStore.ts#L114) enumerates only existing entries. It has no cancellation tombstone for later registrations.
- The waiter does not observe an AbortSignal or coordinator cancellation. The pipeline only checks cancellation **after** this promise resolves (`ToolExecutionPipeline.requestApproval`, around line 212). Runner awaits the pipeline, so it cannot reach final cleanup while this wait is pending.

**Observed:** Deferred approval persistence → reject by run ID → release persistence → approval registers after Stop and promise remains pending. Explicitly rejecting the new entry is needed to release the probe. The normal already-registered-approval control settles successfully.

**Impact:** A stopped conversation can retain an active loop and stale approval card; the runner's same-conversation guard can prevent another run until the stale approval is answered. This is a cancellation/liveness defect, **not** evidence that a cancelled operation bypasses approval: coordinator checks after resolution prevent that path in the normal Stop flow.

**Minimal direction:** Make the approval wait cancellation-aware across persistence and registration; check cancellation before and after each await, settle the waiter, expire/reject its durable approval and remove its UI entry. Preserve the post-approval cancellation check. A UI-only retry of rejection leaves another race.

**Evidence:** `review-probes-2026-10-24.probe.ts`, test `settles approval when Stop happens during approval persistence`; fails with `still-waiting` and `pending approval: true`. The test reproduces the exact registration gap with the real waiter and store; the resulting full desktop lockout is inferred from the awaited pipeline and active-loop guard, not directly GUI-tested. Both native and browser branches have the same await-before-registration structure; the probe executes the browser SQL branch.

### R2 — P1 conditional: filesystem adapter erases an unknown execution outcome

**Trigger:** A filesystem write/edit/move request has been dispatched, but its awaited command rejects without establishing whether its side effect happened (e.g. transport response failure).

**Call chain and cause:**

- [FilesystemAdapter catch](../../src/lib/mcp/pipeline/adapters/FilesystemAdapter.ts#L226) converts every exception into `{ ok: false, error: message }`.
- [Pipeline](../../src/lib/mcp/pipeline/ToolExecutionPipeline.ts#L410) treats that structured failure as known, and [markKnownFailure](../../src/lib/mcp/pipeline/toolResultDiagnostics.ts#L136) sets `resultStatus: 'failed'`.
- The very same exception thrown directly by an adapter reaches the pipeline catch and becomes `resultStatus: 'unknown'` for a write (line 487).
- [Runner](../../src/lib/mcp/agentLoop/AgentLoopRunner.ts#L586) pauses only on `unknown` (or an escaping execution exception); a normalized ordinary failure allows later calls and model rounds.

**Observed:** Real FilesystemAdapter + real pipeline, with only the command seam rejecting: `failed / TOOL_FAILED`. Control with a throwing write adapter: `unknown / TOOL_RESULT_UNKNOWN`.

**Impact:** The implementation cannot preserve uncertainty for this adapter; subsequent actions may continue without reconciling the file operation. Duplicate actions/data corruption are possible consequences, **not reproduced incidents**. The probe does not prove that a real command completed before a transport failure. This finding is conditional on that failure class; ordinary validation/allowlist failures can correctly remain known failures.

**Minimal direction:** Separate pre-dispatch validation/known backend failures from uncertain dispatch/transport failure. Preserve or propagate uncertainty to the pipeline and runner. Do not blindly mark every filesystem error unknown; that would misclassify normal invalid arguments and permission denial.

**Evidence:** `review-pipeline-2026-10-24.probe.ts`, test `preserves uncertainty when filesystem transport rejects after dispatch`; fails with actual `failed`, expected `unknown`. The direct-throw control passes. This is fault-injection evidence of classification and control flow, not a native transport incident reproduction.

### R3 — P2: MCP tool errors are displayed and recorded as successful calls

**Trigger:** An MCP server successfully returns a tool result with `isError: true` and text content describing the failure.

**Call chain and cause:**

- Rust [mcp_call_tool](../../src-tauri/src/mcp/commands.rs#L660) serializes a successful protocol response without converting tool-level failure to a thrown transport error.
- `McpClient.callTool → ServerManager.callTool → McpAdapter.execute` returns the result unchanged.
- [detectFatalFailure](../../src/lib/mcp/pipeline/toolResultDiagnostics.ts#L76) recognizes `success: false` and `ok: false`, but not `isError: true`.
- Pipeline reaches `markSuccess`; [ToolCardUpdater](../../src/lib/mcp/pipeline/ToolCardUpdater.ts#L22) emits `TOOL_RESULT` with `ok: true`.
- Runner determines `toolFailed` from `error` or `ok === false`, so a plain MCP error result also gets a non-error run event.

**Observed:** Real McpAdapter + pipeline with a connected server fixture returning `{isError:true, content:[{type:'text',text:'Remote tool failed'}]}` returns that raw result, lacking a failure marker. The `ok:false` control is correctly classified failed.

**Impact:** Failed MCP calls receive success presentation/metadata and inaccurate durable error flags. The model can still see `isError`/error text in the raw result; this is not proof that it always misunderstands the failure. A tool-level error is also distinct from unknown transport outcome and does not automatically require pausing.

**Minimal direction:** Normalize MCP tool-level errors at its adapter boundary or extend shared result classification and runner error detection consistently; preserve MCP content/structured details.

**Evidence:** `review-pipeline-2026-10-24.probe.ts`, test `marks a returned MCP isError result as failure`. The connection prerequisite is explicitly stubbed as connected; no failed server initialization is being mistaken for a tool result.

### R4 — P2: evidence reads silently reuse a stale range after re-indexing

**Trigger:** A run obtains a citation/search/read evidence ID; the document's active index batch changes before `knowledge.read(evidenceId)`.

**Call chain and cause:**

- Search/read delivery records immutable `range.documentId`, `range.batchId` and chunk offsets in the run evidence registry.
- [Explicit cursor validation](../../src/lib/mcp/pipeline/adapters/KnowledgeAdapter.ts#L292) rejects a different batch.
- [Evidence read branch](../../src/lib/mcp/pipeline/adapters/KnowledgeAdapter.ts#L297) instead takes the old range's numeric chunk index/offset immediately. The active-batch lookup through `retrievalChunkId` runs only when that index is absent. It never compares `prior.range.batchId` with the active batch.
- `readBounded` then queries the new batch at the old position and creates a fresh evidence item from that content.

**Observed:** Evidence for `old-batch`, chunk 3 → active document `new-batch` → returns `ok:true`, a new E2 and `NEW UNRELATED CONTENT`. The identical batch mismatch supplied as an explicit cursor returns `CURSOR_INVALID`; a current evidence range remains readable.

**Impact:** A request to expand an existing citation can silently read unrelated replacement content. This does not widen mounted-document scope; it breaks source-version identity within an authorized document.

**Minimal direction:** Validate evidence document/batch identity (and hash policy where relevant) before using offsets; return a stale-evidence error requiring a new search. Preserve the current-batch control and add real re-index/read integration coverage.

**Evidence:** `review-probes-2026-10-24.probe.ts`, test `rejects a stale evidence range after document re-indexing`. Real adapter and registry, fixture-backed index rows; no native re-index transaction was run.

## Reproduction and results

Run the explicit audit probes:

```bash
pnpm exec vitest run --config docs/architecture/review-probes-2026-10-24.config.ts
```

Expected on this baseline: **4 failing bug assertions, 5 passing controls, 9 tests total**. Repeated with the same outcome. Exit code 1 is intentional evidence of the four defects, not a healthy regression gate. Files use `.probe.ts` outside `src` and `docs/acceptance`, so root `pnpm test` does not collect them. Promote appropriate probes into regression suites when implementing fixes.

Probes: [approval/evidence](review-probes-2026-10-24.probe.ts), [pipeline outcomes](review-pipeline-2026-10-24.probe.ts), [runner config](review-probes-2026-10-24.config.ts).

Existing targeted regressions:

```bash
pnpm exec vitest run src/lib/mcp/agentLoop/__tests__ src/lib/mcp/pipeline/__tests__ src/lib/mcp/pipeline/policy/__tests__ src/lib/llm/__tests__/interpreterCancellation.test.ts src/lib/llm/__tests__/ModelRequestScheduler.test.ts src/lib/chat/stream/__tests__/promptTrack.test.ts docs/acceptance/final-plan.audit.test.ts
```

**18 files / 110 tests passed** (1.20 s). These protect complete-before-execute ordering, persistence failures, unknown outcomes, plan/approval policy, aliases, request cancellation/queueing, prompt-track dispatch and bounded evidence reading. Passing mocks do not prove native integration.

Full normal suite re-run: **146 files passed, 4 skipped; 1048 tests passed, 4 skipped**, exit 0. No existing test was changed to manufacture a failure.

Temporary execution logs: `/tmp/chatless-review-probes.log`, `/tmp/chatless-review-probes-repeat.log`, `/tmp/chatless-review-regression.log`, `/tmp/chatless-review-full.log`. The saved source probes are the reproducible evidence; temporary logs may disappear.

## Counterevidence and candidates not promoted

- Cancellation *after* an approval resolves is checked in the pipeline; not reported as an approval bypass.
- Runner persists completed requests before tool execution and stops dispatch on result persistence failure; existing failure-injection tests pass. Mere absence of a single global transaction is not reported as a new bug.
- Unknown exceptions escaping an adapter already pause writes; R2 concerns the filesystem-specific loss of that distinction.
- The September claim that runtime events only use frontend SQL is obsolete for Tauri: native event/approval/checkpoint commands are wired.
- Current KnowledgeAdapter passes the resolved mounted document set to retrieval, including model narrowing. The mounted-library/attachment SQLite control passes; no scope widening finding was established.
- Native text echoes do not run prompt parsing; prompt-track synthesis and native/disabled pass-through regression tests pass. No duplicate-tool finding was established.
- Full parameter migration remains an owner decision in issue #172. It is not treated as an automatically authorized rewrite or a newly reproduced bug.

## Remaining coverage / handoff

Astra/independent follow-up should first try to refute R1 and R2 at the native boundaries and verify their proposed priorities. For R1, exercise Stop during delayed native approval insertion, then attempt another send in the same conversation. For R2, distinguish deterministic backend errors from post-dispatch uncertainty and assert that no later write is dispatched. For R3, use an actual MCP server returning tool-level `isError`; verify card and persisted `isError`, not only the adapter return. For R4, search → real batch replacement → read old evidence ID, including continuation/restored citations.

Not completed here: desktop end-to-end reproduction; Rust tests and crash injection; live-provider protocol matrix; parameter migration/precedence full audit; WebDAV conflict/lifecycle audit; MCP reconnect/Skills full lifecycle; performance measurements, release/update verification. These are unverified areas, not evidence of defects. Prioritize targeted native confirmation of the four findings before expanding the audit or changing implementation.
