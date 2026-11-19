# Final review and adjudication — 2026-10-24

Baseline: `35613a2a242757a2b47f91cb16cbbbbf08efc2ff`. This report supersedes the priorities in the [primary review](primary-review-2026-10-24.md); the [codebase map](codebase-map-2026-10-24.md) remains the navigation index.

This pass challenged the four original findings, followed their downstream effects, and sampled native filesystem authorization, permission synchronization, managed-process ownership and WebDAV conflict recovery. Only audit documents/probes were added or edited. The pre-existing edit to `docs/agents/constraints.md` has unknown authorship and was not touched. No product fix, commit, external comment or live user-data operation was performed.

## Decision and repair order

P1 means prioritize a fix for demonstrated loss of functionality/data under the stated trigger; P2 means a confirmed defect with narrower impact or additional mitigating boundaries. Confidence in a mechanism is separate from its production frequency, which was not measured. There is no substantiated P0 finding.

| Order | ID | Final priority | Decision and evidence |
| --- | --- | --- | --- |
| 1 | R8 | P1 when multi-device sync is used | New: 412 recovery rolls newer remote metadata backward, allowing a subsequent older device push to overwrite newer content. Real SyncManager, simulated transport. |
| 2 | R1 | P1 | Retained and strengthened: Stop during approval persistence leaves the real AgentLoopRunner active and rejects the next send. Native IPC branch simulated; real waiter/store/runner. |
| 3 | R5 + R6 | P2, first permission workstream | New: Rust checks temporary grants without owner identity; partial registration failure leaves installed grants without a revoker. Native state execution plus TypeScript failure injection. Frontend approval remains a mitigating boundary. |
| 4 | R3 | P2 | Retained: MCP `isError:true` is not classified as a failed tool call. Correct protocol field independently checked against the cached Rust SDK. |
| 5 | R4 | P2 | Retained: evidence reads reuse stale index offsets after a batch replacement. Explicit-cursor control rejects the same mismatch. |
| 6 | R7 | P2 | New: failed allowlist synchronization poisons deduplication and suppresses a retry with identical input. Stale backend state requires a failure before in-memory application. |
| Investigate | R2 | P2 hardening candidate; remove original P1 | Classification loss is reproduced, but a completed native mutation followed by an ambiguous transport failure is not. Do not report reproduced data corruption from this probe. |

If sync is not enabled for the affected population, start with R1. R5/R6 should be repaired together because lingering grants amplify the missing ownership check. R7 is a distinct persistent-allowlist synchronization defect. Cosmetic refactors and speculative performance optimization rank below these correctness fixes.

## Challenges to the original findings

### R1: Does cancellation already prevent the claimed problem?

The coordinator check after approval does prevent normal execution of a cancelled call. It does not settle an approval promise registered after the Stop handler's rejection sweep. The new probe uses the real AgentLoopRunner with real `waitForCallApproval` and authorization store; its pipeline seam delegates to that waiter. It delays `agent_request_approval`, calls runner cancellation plus the store rejection, then releases the IPC response.

Observed: `ended=false`; another run in the same conversation rejects with `当前会话已有运行中的任务`. Rejecting the late approval releases the original run. This strengthens the previous inferred runner lockout to executable runner evidence. Provider, stream orchestrator, pipeline wrapper, database/event I/O and native invoke remain fixtures; the full UI Stop handler and desktop IPC are not exercised end to end. The mocked coordinator does not establish an execution bypass, and no such bypass is claimed.

Repair acceptance: cancellation before/during persistence and after registration must settle the waiter, clear pending/durable approval state and permit a new run; a late positive approval must not execute a stopped call. Preserve the post-approval coordinator check.

### R2: Is an ordinary native filesystem error actually an unknown outcome?

Counterevidence: [atomic writes](../../src-tauri/src/filesystem/commands.rs#L73) write a sibling temporary file and rename it; [write_file_inner](../../src-tauri/src/filesystem/commands.rs#L699) has no later fallible step after successful replacement. Rename similarly returns after the mutation. Permission/argument rejection is a known failure. These facts refute treating every adapter exception as unknown or calling the existing probe an ordinary write-corruption reproduction.

The adapter still erases exception provenance and the pipeline treats its `{ok:false}` as known failure. The original fault-injection comparison remains valid, but priority is downgraded. Investigate concrete transport-loss or partially applied multi-step operations before promoting urgency. Acceptance should distinguish rejected-before-dispatch, known backend failure and genuinely uncertain outcome, rather than pause on all errors.

### R3: Could MCP errors use a different field, or still reach the model?

The cached `rmcp` SDK defines `CallToolResult.is_error` with camelCase serialization; the application's [native MCP command](../../src-tauri/src/mcp/commands.rs#L660) serializes the result. Thus `isError` is the correct field for the actual boundary. [Failure detection](../../src/lib/mcp/pipeline/toolResultDiagnostics.ts#L76) omits it. The raw content/flag still reaches the model: the confirmed defect is success metadata/presentation and run-event classification, not inevitable model misunderstanding.

Acceptance: preserve protocol content, mark tool-level failure consistently in card/pipeline/run event, and keep transport uncertainty distinct from a normal MCP tool error.

### R4: Does current document scoping or the explicit cursor check prevent it?

Mounted-document scoping limits the read to an authorized document. It does not preserve version identity. [KnowledgeAdapter](../../src/lib/mcp/pipeline/adapters/KnowledgeAdapter.ts#L292) validates an explicit cursor's batch but takes prior evidence offsets without the equivalent check. The unchanged-batch control passes; the mismatched explicit cursor fails correctly; old evidence reads replacement content. Retain P2 for citation reliability, not cross-document disclosure.

Acceptance: reject stale evidence before using offsets and require fresh retrieval; test unchanged batches, replaced batches and continuation/restored evidence.

## New findings from omitted high-risk boundaries

### R5 — P2: temporary filesystem grants are not restricted to their owning call

Contract: [default permissions](../default-permissions.md) says the native backend is the final boundary and session grants are per-call. [Native state](../../src-tauri/src/filesystem/state.rs#L308) stores `run_id`/`call_id`, and revocation matches them. However, [assert_allowed](../../src-tauri/src/filesystem/state.rs#L338) accepts only path and operation; its temporary-grant search checks permissions and lexical/real paths, without caller identity. File-operation payloads also lack the grant owner's context.

The native probe imports the unchanged production Rust state module. With an empty persistent allowlist, a fixture file is denied. Registering A's read grant makes an identity-free authorization check succeed. Revoking B has no effect; revoking A restores denial. This is an executed backend isolation failure, not a copied implementation or mocked Rust result.

Boundary: path/permission checks, canonical-path checks, expiry and revocation still apply. Normal model calls separately pass the frontend gate. No frontend approval bypass, remote exploit, arbitrary host access or cross-conversation UI exploit was demonstrated. These mitigations are why this report assigns P2 rather than asserting a P1 exploitable vulnerability.

Repair acceptance: bind authorization of the actual operation to its run/call capability; test A allowed, B/unscoped denied, expiry/revocation, and both pipeline and [UI one-shot grants](../../src/lib/filesystemAllowlist/oneShotGrant.ts). Adding identity only to the registration record cannot fix the check.

### R6 — P2: partial temporary-grant failure loses its cleanup path

[grantCallScopedPaths](../../src/lib/filesystemAllowlist/backendSync.ts#L43) registers grants with `Promise.all`, then returns a revoker. If one registration succeeds and another fails, the function rejects before returning that revoker. [Pipeline](../../src/lib/mcp/pipeline/ToolExecutionPipeline.ts#L169) catches the error as best effort and proceeds; its finally block has no revoker. A requested path plus session working directory can produce multiple grants.

Observed with real registration orchestration and mocked commands: one grant remains installed after rejection; revoke calls = 0. The all-success cleanup control passes. Native commands use a ten-minute TTL, so this is temporary, not permanent, expansion. The failure injection does not establish how often registration fails in production.

Repair acceptance: wait for all registration attempts to settle, clean the entire scope on any failure, and do not execute an operation requiring a grant that could not be established. Immediate cleanup after the first rejection alone can race a later successful registration. Test partial success, late completion, normal finally cleanup and expiry.

### R7 — P2: a failed allowlist sync prevents a same-input retry

[syncFilesystemAllowlistToBackend](../../src/lib/filesystemAllowlist/backendSync.ts#L24) assigns `lastSyncedKey` before awaiting `setAllowlist`. After one rejected command, an identical retry resolves without sending anything. Settings changes and the filesystem gate use this synchronization boundary.

Observed: inject a command-delivery failure, retry identical directories, and native-command call count stays at one. If the backend did not apply the first request, additions remain unavailable or removals remain stale at the backend. Frontend checks still independently apply.

Counterevidence: [set_allowlist](../../src-tauri/src/filesystem/state.rs#L284) updates memory before disk persistence. A disk-write error by itself does not prove stale live backend permission state. The probe deliberately represents non-delivery, not every possible rejection.

Repair acceptance: cache only acknowledged state and handle overlapping updates; failed requests remain retryable. Test failed delivery, success deduplication and concurrent changes. Simply moving the cache assignment does not by itself establish correct ordering of concurrent native requests.

### R8 — P1: sync conflict recovery can cause an older device to overwrite newer content

Chain: `webDavSyncStore → SyncManager → WebDAVTransport → WebDavClient`. [SyncManager's 412 handler](../../src/lib/sync/core/SyncManager.ts#L248) fetches latest metadata but merges `{...latest.data.items, ...remoteMeta.items}`. The older snapshot wins for every overlapping ID, including IDs this device did not modify. It then retries without the newly fetched ETag. [WebDAVTransport](../../src/lib/sync/transports/WebDAVTransport.ts#L84) converts the absent token to null; [WebDavClient](../../src/lib/sync/webdav/WebDavClient.ts#L154) sends `If-Match: *`, which does not enforce the observed version. The client does throw on 412, so this recovery path is reachable through the real transport contract.

The probe runs the real SyncManager against a stateful transport fixture:

1. Device A reads metadata B at version/time 10.
2. Another device updates B's body and metadata to 30; A's original metadata PUT gets 412.
3. A refetches 30, merges its snapshot over it, and successfully stores B's metadata as 10. Its sync reports no errors.
4. A subsequent device state containing B at 20 now wins against metadata 10; SyncManager uploads the older body, replacing version 30 with 20, again reporting no errors.

Both the metadata rollback and subsequent older-body write are observed. A conflict-free empty push preserves existing metadata and performs no item write. This is a controlled multi-device interleaving with simulated transport/storage, not a live WebDAV-server or user-data incident. It applies to enabled sync types (prompts, skills, providers/settings as configured), not conversation-history synchronization.

Repair acceptance: merge only owned changes using the documented timestamp/device conflict rule, preserve newer remote entries/deletions, and retry with the newly observed ETag under a bounded conflict loop. Validate body and metadata consistency, not just metadata merging: item bodies are written before metadata and can race independently. Include conflicts on different IDs, the same ID, deletion tombstones and repeated 412s. Do not claim the entire sync protocol is repaired by reversing the object spreads.

## Coverage and remaining uncertainty

- Managed-process read/stop/list commands explicitly filter by conversation ID; this is counterevidence to generalizing the filesystem ownership defect to shell processes. Process-tree termination on Windows/macOS was not executed here.
- Shell cwd is explicitly not an OS sandbox; broad HTTP permission is documented current policy. Neither was promoted as a new bug merely because it is broad.
- Native atomic write ordering, canonical path checks and grant expiry were inspected. This is not an exhaustive symlink/TOCTOU, Windows junction, filesystem-history or platform audit.
- Sync conflict recovery was executable-tested; live WebDAV servers, network failures, adapter migrations and every synchronization interleaving were not covered.
- No live provider requests, desktop GUI race reproduction, production database migration, native full application build or full Rust suite was run in this pass. Existing green unit tests do not rule out the reproduced races.

## Reproduction ledger

Commands run from the repository root; bug probes intentionally assert the desired behavior and exit nonzero on this baseline. They are outside normal unit collection and should be converted into normal regression tests alongside fixes.

| Command | This pass's outcome |
| --- | --- |
| `pnpm exec vitest run --config docs/architecture/review-probes-2026-10-24.config.ts` | Original findings rechecked: 4 failing tests, 5 passing controls. |
| `pnpm exec vitest run --config docs/architecture/final-review-2026-10-24.config.ts` | 4 failing tests (R1, R6, R7, R8), 2 passing controls. R8 has two failing assertions in one test. |
| `python3 docs/architecture/final-review-native-2026-10-24.py` | R5 assertion fails, exit 101; denial before grant and after revocation controls pass inside the probe. |
| `python3 docs/architecture/final-review-native-2026-10-24.py --controls` | Existing production state-module tests: 2 pass. |

The Rust wrapper compiles the unchanged source module using cached local `.rlib` dependencies and isolated temporary fixture files; it is not a replacement for `cargo test` or a portable clean-checkout runner. TypeScript probes use fixture I/O; their execution does not establish full-project typecheck success.

Earlier primary-pass baseline, not rerun in full here: targeted regression 18 files / 110 tests pass; `pnpm test` 146 files pass / 4 skipped, 1048 tests pass / 4 skipped. No runtime changes occurred between those tests and this report. `pnpm verify` was not run and no push is being made.

Local transient logs: `/tmp/chatless-final-primary-recheck.log`, `/tmp/chatless-final-probes.log`, `/tmp/chatless-final-native.log`, `/tmp/chatless-final-native-controls.log`. Durable reproductions are the adjacent `review-*` and `final-review-*` probe/config files.
