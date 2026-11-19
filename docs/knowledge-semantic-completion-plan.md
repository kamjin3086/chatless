# Real-model knowledge completion plan

## Contract

Complete the existing optional Knowledge/RAG capability, not a replacement agent
framework. The selected real embedding model must govern document vectors and
query vectors. A real chat model must answer using retrieved source evidence.
FTS-only operation is an explicit fallback, not evidence that semantic retrieval
passed. No mock vectors, dependency additions, default-permission expansion or
host networking changes are part of this plan.

Baseline requirements: `architecture/evidence-rag-v2.md`, the knowledge-specific
findings and gates in `agent-knowledge-final-audit-2026-09-21.md`, and the evidence
limitations in `agent-knowledge-completion-2026-09-21.md` and
`knowledge-chat-repair.md`. Existing unrelated architecture drafts are preserved.

## Ordered work and gates

- [x] **1. Selected real model and runtime lifecycle.** Initialize the shared RAG
  runtime from persisted embedding settings. Serialize configuration replacement,
  preserve in-flight model ownership, fix vector fingerprints after changes and
  wake waiting/reindexable semantic work. Isolate temporary ONNX status-check
  sessions from production sessions. Validate saved selection, rapid changes,
  delayed initialization, failed loading/retry and independent cleanup.
- [x] **2. Real-tokenizer input bounds.** Measure the complete search text against
  the selected model's limit; split oversized source ranges without truncating
  facts. A bad input must not unload a healthy model. Keep source offsets and
  citation locations traceable. Validate long English/Chinese text and limits
  including title/section prefixes against a real tokenizer.
- [x] **3. Durable indexing and model identity.** Publish lexical metadata and
  semantic task creation atomically. Bind semantic tasks to document version,
  active batch and immutable model fingerprint/generation. Validate cancellation,
  late results, switching models, crash windows and startup compensation. Never
  publish vectors under another model's identity.
- [x] **4. Durable evidence and reading.** Persist evidence identity and delivered
  ranges through continuation/restart, revalidate current access/version on source
  reads, preserve immutable historical quotes, and complete source-view/open
  affordances. Fix inline-code citation normalization. Validate exact reads,
  cursor expiry, reindex/delete and resumed citation reads.
- [x] **5. Real corpus and real models.** Import actual TXT/Markdown/PDF/DOCX
  fixtures through production extraction/indexing. Generate and store real vectors,
  then generate real query vectors and exercise the production authorized
  Dense/FTS/RRF path. Assert actual dense contributions, not just `mode: hybrid`.
  Exercise a real chat model, citations, no-answer/conflict questions, reload,
  cancellation and model changes. Persist reproducible reports without secrets.
- [ ] **6. Quality, performance and final audit.** Retain Recall@8 >=90%, 50K lexical
  P95 <=500ms and Dense+fusion P95 <=2s (the original metric excludes query
  embedding); measure actual embedding/IPC end-to-end time separately. Record
  model files/identity, dimensions, corpus, machine, command and raw results.
  Separate deterministic-vector scan cost from real semantic quality. Run all
  relevant gates, audit the requirement list and state platform/installation
  limitations explicitly. Do not replace live-model evidence with unit tests.

## Evidence policy

Each completed box needs current implementation plus runnable evidence. Historical
ONNX and Qwen reports demonstrate narrower paths; they are not completion proof
for this plan. Keep task-local probes/reports outside the repository unless they
are durable regression tests or deliberately committed acceptance fixtures.

## Progress

- Steps 1–5 are implemented and verified by regression tests and retained live
  ONNX/Qwen desktop evidence. The final release audit in step 6 remains open:
  root typecheck/native-suite failures, unavailable live Ollama and untested
  platforms are not relabelled as green. See
  `acceptance/knowledge-semantic-final-report.md` for the current evidence matrix.
- Earlier keyword/chat repairs and the scoped-link/exact-range follow-up remain in
  the working tree; those are not relabelled as real semantic completion.
- Baseline application typechecking is affected by three errors in other-session
  `docs/architecture/*probe.ts` drafts. Verify executable changes separately without
  modifying those drafts or weakening a gate.

### Current verified evidence

The retained desktop profile and raw reports are under
`~/.local/share/chatless-acceptance/knowledge-semantic/`. These are test materials;
no corpus reset or production credential copy is part of the run.

- Actual TXT, MD, PDF and DOCX files were uploaded using the resource file input,
  then added to a knowledge base through the application UI. BGE produced 23
  active 512-dimensional vectors. The file/tokenizer SHA256 values in the vector
  fingerprint match the real loaded artifacts.
- Real token counts for the complete BGE search texts, including prefixes, were
  at most 497 against a 512-token limit (`token-budget.json`).
- A real Qwen knowledge run recorded 23 Dense candidates and 21 FTS candidates,
  called search/read, answered the three fixture facts correctly, and persisted
  exact citation ranges (`qwen-first-run.json`). This is not a `mode`-only claim.
- Restart reopened the final-chunk citation exactly. Changing to MiniLM and
  reloading exposed and then verified a cold-start reconciliation fix: all four
  documents moved to 384-dimensional vectors, the long TXT changed from 19 to
  36 chunks, and every active chunk had a matching vector
  (`mini-cold-start.json`). Switching back to BGE also completed.
- The stale old citation retained its historical quote and rejected an exact
  current-source read; the explicit current-version action then read the new
  version (`stale-citation-current-version.json`).
- Temporarily moving only the profile's BGE artifact made all four documents
  wait for a model. Real Qwen still answered the PDF no-budget question with
  supported evidence, Dense count zero and `EMBEDDING_UNAVAILABLE` fallback.
  The model and metadata were restored, and the next start automatically
  restored semantic readiness (`qwen-no-embedding-no-answer.json`,
  `model-restored-startup.json`). The original model cache was untouched.
- A real user stop after search retained eight acknowledged, uncited evidence
  snapshots. After process restart, continuation called `read(E1)` without a
  new search, copied all eight identities/ranges and answered the DOCX facts
  (`paused-after-search.json`, `qwen-continuation.json`). Explicit user stop is
  recorded as `cancelled`; `paused` is a different runtime state.
- Real regeneration made zero tool calls and retained citations. One attempt
  produced an empty provider response and was correctly marked failed; retry
  succeeded. Mixed numeric/canonical markers in that retry prompted explicit
  marker guidance. Its final real rerun passed with zero tools, correct ORION
  facts, source ranges and normalized display references (`qwen-final-regeneration.json`).
  Earlier failures remain in `qwen-regeneration.json` and `qwen-regeneration-retry.json`.
- Frozen 16-query, four-format live embedding evaluation uses the actual
  `EmbeddingService` and production `RetrievalService` over transparent desktop
  IPC, not vector/response fixtures: MiniLM Dense Recall@8 15/16, Hybrid 16/16;
  BGE Dense and Hybrid 16/16. Small-corpus Hybrid P95 was 136 ms / 145 ms;
  real query embedding P95 was 75 ms / 68 ms respectively. See
  `docs/acceptance/real-semantic.audit.test.ts` and the retained model reports.
  These samples are a small-corpus check, not broad semantic-quality proof.
- The current release-mode 50K/512D deterministic-vector scan had P95 249.4 ms;
  the separate RRF benchmark added 0.015 ms. This measures scan/fusion cost,
  excludes query embedding and is **not** semantic-quality evidence.
- The retained 50K FTS corpus contains 26 annotated chunks plus 49,974 synthetic
  padding chunks. Production lexical retrieval with real native tokenization
  measured P95 45.3 ms over 192 queries; the existing annotated lexical checks
  retained 100% Recall@8 and 4/4 clean no-answer results. This is explicitly a
  scale/performance fixture, not real file-import or embedding proof.
- Native transaction regressions now include cancellation before model claim
  and cancellation during tokenizer adaptation. Both were first observed red,
  then passed after fixing unclaimed cancellation recovery and binding lexical
  adaptation publication to its semantic parent (15 native runtime tests).
  A later caller regression caught premature parent self-cancellation; removing
  it allowed actual MiniLM adaptation from 310 to 619 stress-document chunks,
  complete 384D coverage, then full 512D coverage after restoring BGE.
- Ollama now checks the real digest around inference and invalidates changed
  identities/dimensions without unloading a healthy model on input overflow.
  These are HTTP-protocol regressions, **not live Ollama acceptance**: no real
  Ollama server is available on this host. Successful selected-model install and
  status probes reconcile the shared runtime without retiring unchanged leases.

### Final lifecycle evidence and release limits

- Final desktop replay passed 13 checks. Independent real inference matched the
  stored 512D vector at cosine 0.9999999999999991. Latest BGE frozen Dense/Hybrid
  Recall@8 was 16/16, query inference P95 64.0 ms, Hybrid P95 139.5 ms and measured
  query-plus-Hybrid P95 199.1 ms (`desktop-semantic-marker-final-report.json`,
  `bge-quality-final.json`). These remain small-corpus measurements. A repeated
  question had reused historical numeric references; that failed replay is kept.
  Search/read now return copyable current citation markers; the final replay
  passed without guessing numeric references into evidence identities.
- Real Qwen cited both conflicting 13/29-day policies and refused to invent
  precedence (`qwen-conflict.json`). The actual rebuild/cancel/retry cycle stopped
  at 112 vectors, remained unchanged for eight seconds, then completed 310/310
  vectors on explicit Retry (`cancel-retry-real-model.json`). A native call in
  flight was not directly observed in that UI test; deterministic native writer
  rejection tests cover that boundary separately.
- Settings Refresh/Test used the saved BGE model and actual 512D inference without
  adding semantic tasks. The status inspector no longer has unsafe controls that
  replace selected models with invented default paths (`settings-probe-final.json`).
- Navigation SIGSEGV was reproduced with an isolated loaded-library overwrite,
  with the exact `0x309bd0` ORT destructor stack. An immutable staged runtime passed
  navigation stress and probing while repository native tests rebuilt separate
  resources. The runbook now requires artifact isolation; cleanup was not disabled.
- Four-format and separate lifecycle fixture generators, frozen evaluation and
  desktop replay instructions are in the repository. The executable snapshot
  passed `pnpm verify`; changed files were compared byte-for-byte. Targeted native
  runtime tests passed 15 and explicit real-ONNX ownership tests passed 2.
- Root typecheck still fails the three preserved audit-draft errors. The latest
  full Rust run had 72 passed, 2 failed, 6 ignored: the unchanged Linux npx-path
  classification failure and an unchanged restore-history test that passed when
  run alone. Neither is hidden or fixed outside this task's scope.
- Independent review was quota-blocked; direct review is not an independent
  sign-off. No live Ollama, macOS/Windows, packaging or installation claim is made.
  No commit or push was made. Step 6 remains an open release/audit gate.
