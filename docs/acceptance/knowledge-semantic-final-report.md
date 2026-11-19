# Knowledge semantic completion: Linux acceptance record

Date: 2026-11-17. This is an uncommitted implementation/acceptance record, not a
release, installation, cross-platform or independent-review sign-off.

## What is verified

The existing Knowledge capability now uses the persisted real model for both
stored and query vectors, keeps lexical availability independent of embeddings,
and preserves delivered source identities/ranges through chat lifecycle changes.
No new dependency, default permission, vector service or agent framework was added.

The retained profile is `~/.local/share/chatless-acceptance/knowledge-semantic/`.
It contains the original four-format corpus, conversations, model artifacts and
raw failures as well as successful reports. No database reset was used.

| Check | Actual evidence |
| --- | --- |
| Real TXT/MD/PDF/DOCX import and indexing | Production resource upload, extraction and knowledge-base selection; complete selected-fingerprint vector coverage |
| Real chat grounding | Qwen3.8-Flash-Next made actual search/read calls and answered the opaque ORION facts, with persisted citation identities and ranges |
| Full desktop replay | `desktop-semantic-marker-final-report.json`: 13 checks passed, including actual Dense contributions, original-source reading, reload, conversation switching and removal/remount |
| Independent stored-vector proof | Stored 512D DOCX vector versus fresh real ONNX inference: cosine 0.9999999999999991 |
| Model adaptation | `model-switch-adaptation-final.json`: stress document 310 → 619 chunks on MiniLM; complete 384D coverage, then complete 512D coverage after restoring BGE |
| Cancellation/retry/rebuild | `cancel-retry-real-model.json`: real rebuild changed the active batch; cancel after 112 vectors, count remained 112 for eight one-second observations; explicit UI Retry completed 310/310 vectors without replacing that lexical batch |
| Cancellation limitation | The live test observed a running job after real partial writes, not an individual native call in flight; deterministic native tests additionally reject cancelled/obsolete writers |
| Conflict | `qwen-conflict.json`: separate sources say 13 and 29 days; real Qwen cited both and refused to invent precedence without dates/priority |
| Missing model/no answer | `qwen-no-embedding-no-answer.json`: real lexical-only answer to the PDF budget question, zero Dense and explicit `EMBEDDING_UNAVAILABLE`; restoring the artifact recovered indexing |
| Stop/restart/Continue | Eight acknowledged uncited receipts survived; continuation used `read(E1)` without a new search and retained exact receipt JSON |
| Regeneration | `qwen-final-regeneration.json`: zero new tool calls, correct ORION facts, original source ranges and normalized display references |
| Historical sources | Old quote snapshots survive reindex; stale exact reads fail explicitly and Current version is a separate action |
| Settings probes | `settings-probe-final.json`: saved BGE, real 512D inference, Refresh and Test succeeded without adding semantic tasks; status inspection no longer overwrites settings with invented paths |

An earlier regeneration returned no provider text and remains recorded as failed.
A later real model used `[E9]` instead of `[[E9]]`; registered E-prefixed aliases
are now normalized without guessing bare numeric references, rewriting code, or
inventing mappings for unknown labels. Versioned messages now receive their own
citation snapshots; a red rendering regression caught the previously omitted prop.
Citation persistence failure now fails the run instead of publishing completion
before the source write. A repeated-question run later reused historical bare
`[1]`/`[2]` numbers despite fresh search/read; it remains a failed acceptance
record in `desktop-semantic-immutable-final-report.json`. Tool results now return
a directly copyable current `citationMarker` plus explicit formatting guidance;
the subsequent same-conversation replay passed all 13 checks. Numeric references
are still never guessed into evidence identities. A red/green queue regression also caught self-cancellation
before tokenizer adaptation; publication now validates the live parent and
supersedes it atomically.

## Quality and performance: distinct scopes

Frozen 16-query, four-document evaluation uses real query inference and the
production Dense/FTS/RRF facade through transparent desktop IPC. It is a smoke
corpus, not a representative broad-language or 50K real-file quality benchmark.

| Measurement | Result |
| --- | --- |
| Latest BGE Dense / Hybrid Recall@8 | 16/16 / 16/16 |
| Latest BGE real query inference P95 | 64.0 ms |
| Latest BGE Hybrid retrieval/IPC P95 | 139.5 ms |
| Latest BGE measured query + Hybrid P95 | 199.1 ms |
| Earlier MiniLM Dense / Hybrid Recall@8 | 15/16 / 16/16 |
| Earlier MiniLM query inference / Hybrid P95 | 75.4 ms / 135.9 ms |
| 50K lexical fixture | 192 queries, P95 45.3 ms; annotated Recall@8 100%, no-answer 4/4 |
| 50K/512D deterministic Dense scan + RRF | P95 249.4 ms + 0.015 ms; excludes query inference |

`bge-quality-final.json` records artifact/fixture hashes, per-query measurements
and machine details: Linux 7.3.3-200.fc44.x86_64, AMD RYZEN AI MAX+ 395, 32 logical
CPUs. BGE model SHA256 is
`b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5`;
tokenizer SHA256 is
`48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26`.
The 50K fixtures contain synthetic padding/deterministic vectors and are solely
performance evidence. They do not replace real inference or real file import.

## Native crash investigation: acceptance-artifact isolation

A settings navigation terminated the test app with SIGSEGV at `0x309bd0`.
This was not dismissed as a WebDriver timeout or attributed to host OOM without
proof. The app had loaded `target/debug/libonnxruntime.so`, which Tauri's Cargo
build resource copying overwrites in place while other Cargo commands run.

A controlled reproduction used a separate test-owned binary/library directory.
Before overwrite, the real settings probe succeeded. Copying identical library
bytes over the **loaded** library then reproduced the same `0x309bd0` fault;
GDB showed `ort::session::SharedSessionInner::drop` reached from navigation cleanup.
With the library left untouched, navigation stress passed. An isolated runtime
also passed 45 navigations and the real settings probe while the repository's
native tests rebuilt its separate resources. No ownership cleanup was disabled
or leaked to hide the crash. Raw GDB/replay logs are retained outside the repo.

Stage immutable runtime resources before launching acceptance; do not build over
mapped libraries. See the runbook. This is not a supported hot-library-update
mechanism. The unrelated host OOM records were observed, but are not the proven
cause of this reproduced fault.

## Verification and remaining release limits

- Clean HEAD-plus-executable-patch snapshot: `pnpm verify` passed, including lint,
  app types, test types, tests and static build. Recorded snapshot run: 159 passed
  test files / 5 skipped; 1129 passed tests / 6 skipped. Some acceptance suites
  require explicit real-service/fixture configuration and run separately above.
- Changed executable/test/replay files matched the validation snapshot byte for
  byte (`validation-snapshot-comparison.json`); no compiler gate was weakened.
- Native runtime transaction tests: 15 passed. Explicit real-ONNX ownership,
  navigation cleanup, retained in-flight owners and late-publication tests: 2 passed.
- `git diff --check` passed. Bounded settings screenshot review passed; the final
  targeted design detector returned `[]`.
- Root typecheck still has the same three errors in preserved other-session
  `docs/architecture/*2026-10-24.probe.ts` drafts. Those drafts and the unrelated
  `docs/agents/constraints.md` edits were not repaired or discarded here.
- Full Rust run: 72 passed, 2 failed, 6 ignored. Unchanged Linux
  `mcp::repair::tests::classify_npx_cmd_path` failed as before; unchanged
  `filesystem::commands::tests::an_overwrite_can_be_restored_from_history` also
  failed in that run but passed alone. Its cause has not been established.
- Live Ollama was unavailable: its digest/context/dimension/overflow coverage is
  protocol regression coverage, not real Ollama acceptance.
- Independent review was previously quota-blocked; review in this record was
  performed directly. macOS/Windows, release packaging, signing and installation
  are unverified. No commit or push was made. Final release audit remains open.
