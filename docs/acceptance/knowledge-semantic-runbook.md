# Real-model Knowledge acceptance

## Scope and safety

These checks complement one another; none substitutes for the others:

1. A desktop UI run imports actual files, indexes them, calls a real chat model,
   verifies Dense contributions and persisted citations, and reopens sources.
2. A frozen small-corpus evaluation uses real ONNX query inference and the
   production Dense/FTS/RRF facade through transparent desktop IPC.
3. Separate 50K fixtures measure scan/fusion and lexical costs. Their padding and
   deterministic vectors are explicitly **not** semantic-quality evidence.

Keep fixtures and reports outside the repository. Reuse the profile and corpus;
there is no requirement to reset the database between checks. Do not copy
provider credentials into the repository or disable existing tool approvals.
The desktop harness approves only pending `knowledge` reads for its own run.

The current worktree has three unrelated type errors in other-session
`docs/architecture/*probe.ts` drafts. The recorded executable-patch verification
used a clean HEAD-plus-patch snapshot without those untracked drafts. No compiler
option or CI gate was weakened. A normal clean validation tree runs `pnpm verify`.

## Desktop preparation (Linux)

Use the repository's normal debug Tauri build with `custom-protocol`, a real
installed ONNX model and the existing `tauri-driver` / `WebKitWebDriver` tools.
Do not install a host service or change DNS, firewall, Docker or proxy wiring.
For unattended Linux runs, a dedicated Xvfb display keeps WebKit animation frames
alive without interacting with the user's desktop.

A separate retained XDG profile is optional. The recorded profile is
`~/.local/share/chatless-acceptance/knowledge-semantic/`, with application ID
`com.kamjin.chatless.kbtest`. The model files are real public artifacts, not part
of the default application package. The real chat provider used for this run was
an existing local OpenAI-compatible Qwen endpoint; configure your own provider
normally and never put API keys in shell commands or checked-in files.

Create the corpus once:

```sh
export PROFILE="${PROFILE:-$HOME/.local/share/chatless-acceptance/knowledge-semantic}"
python3 scripts/e2e/fixtures/make-knowledge-corpus.py "$PROFILE/corpus"
```

This generator uses only Python's standard library, preserves an existing complete
corpus, and refuses a partially populated destination. Upload the four files from
Resources using the file input, create a knowledge base, and add the stored
resource documents through the knowledge-base dialog. Do not insert prebuilt
chunks or vectors. Select the real model in Settings and wait for semantic work.

Finish all builds before launching the app, then stage an immutable test runtime.
On Linux, Tauri's build resource copying can overwrite `target/debug/libonnxruntime.so`
in place. Overwriting an already mapped library—even with identical bytes—was
proven to cause an ORT destructor SIGSEGV on later navigation. An environment
`ORT_DYLIB_PATH` does not override the application's explicit resource initialization.
Do not hide this by disabling session cleanup.

```sh
export ACCEPT_BINARY="$PROFILE/runtime/target/debug/chatless"
if pgrep -fx -- "$ACCEPT_BINARY" >/dev/null; then
  echo 'Stop the test-owned application before staging its files.' >&2
  exit 1
fi
mkdir -p "$(dirname "$ACCEPT_BINARY")"
cp --reflink=auto src-tauri/target/debug/chatless "$ACCEPT_BINARY"
cp --reflink=auto src-tauri/libonnxruntime.so "$(dirname "$ACCEPT_BINARY")/libonnxruntime.so"
# Tauri recognizes a Cargo-style resource directory by this marker.
touch "$(dirname "$ACCEPT_BINARY")/.cargo-lock"
sha256sum "$ACCEPT_BINARY" "$(dirname "$ACCEPT_BINARY")/libonnxruntime.so"
```

Start the WebDriver session with `tauri:options.application` set to the absolute
`ACCEPT_BINARY` path and retain its session ID. Never stage over that directory
while it is running. Repository Cargo commands may then rebuild their separate
resources without modifying the live test image. Keep the original XDG test
profile, actual model paths and credentials unchanged.

The chat and knowledge IDs below are real persisted IDs, not fixture IDs. The
driver listens on loopback; stop only the test-owned app/driver after testing.

## Real desktop/chat and independent vector proof

```sh
export CHATLESS_KB_SESSION_ID='<active WebDriver session>'
export CHATLESS_KB_ID='<four-document knowledge base>'
export CHATLESS_KB_CONVERSATION_ID='<test conversation>'
export CHATLESS_KB_EXPECT_SEMANTIC=1
export CHATLESS_KB_EXPECT_DIMENSION=512
export CHATLESS_KB_MODEL_PATH='<actual BGE model_int8.onnx>'
export CHATLESS_KB_TOKENIZER_PATH='<actual BGE tokenizer.json>'
export CHATLESS_KB_QUERY='请检索并读取 ORION-KB-4826 的原文，回答维护周期、负责人和授权口令，只根据来源回答并引用。'
export CHATLESS_KB_EXPECT='紫杉星河4826'
export CHATLESS_KB_REPORT="$PROFILE/desktop-semantic-report.json"
node scripts/e2e/knowledge-chat-e2e.mjs
```

The optional semantic flag adds strict checks to the earlier keyword/chat test:
complete fingerprint/dimension coverage, actual Dense candidates for the same
fingerprint, delivered citation ranges and the original-source sheet. When model
paths are supplied, it independently recomputes a real one-chunk document vector
and compares it with the stored float32 vector. It then verifies that page reload
invalidates the departed page's ONNX handle. Model status labels or `hybrid` alone
are not sufficient. The test leaves documents, conversations and mounts usable.

For MiniLM use its real model/tokenizer paths and dimension 384. Switching models
may require re-chunking; the 256-token MiniLM limit must not silently truncate
search text. Historical quotes remain immutable when the active batch changes.

## Frozen real-embedding retrieval evaluation

The 16 positive questions are frozen in `real-semantic-cases.json`. No retrieval
tuning occurs in this harness. The expected filename and supporting fact must
appear among the first eight actual results. The native IPC adapter is transport
only: it forwards model inference, jieba and SQL calls to the running application.
Neither query vectors nor model responses are mocked.

```sh
export CHATLESS_KB_QUALITY_REPORT="$PROFILE/bge-quality.json"
pnpm exec vitest run docs/acceptance/real-semantic.audit.test.ts
```

Use the same session, knowledge ID and actual model paths as above. All four
persisted document fingerprints must agree with the initialized real model. The
report distinguishes Dense-only and Hybrid recall, model initialization, actual
query inference, retrieval/IPC time, artifact hashes and machine details. This is
a small four-document smoke corpus, not a broad representative quality claim.

## 50K performance checks

Retain a separate FTS performance database. The annotated 26-chunk fixture is
copied verbatim; 49,974 synthetic neutral chunks pad the measurement corpus:

```sh
python3 docs/acceptance/build-lexical-perf-db.py "$PROFILE/lexical-50k.sqlite"
CHATLESS_LEXICAL_PERF_DB="$PROFILE/lexical-50k.sqlite" \
CHATLESS_LEXICAL_PERF_REPORT="$PROFILE/lexical-perf.json" \
pnpm exec vitest run docs/acceptance/retrieval-eval.audit.test.ts
```

`CHATLESS_KB_SESSION_ID` is required for the live native tokenizer. The measurement
includes its desktop IPC plus production lexical query construction, real FTS5
and the Python/SQLite bridge. It includes selective and high-frequency queries.
An existing 50K database is reused, not deleted or rebuilt.

```sh
mkdir -p "$PROFILE/bench-tmp"
TMPDIR="$PROFILE/bench-tmp" CHATLESS_DENSE_DIM=512 \
CHATLESS_DENSE_BENCH_OUT="$PROFILE/dense-bench-current.json" \
cargo test --release --manifest-path src-tauri/Cargo.toml --lib \
  dense_scan_latency_on_50k_vectors -- --ignored --nocapture
CHATLESS_DENSE_BENCH_REPORT="$PROFILE/dense-bench-current.json" \
pnpm exec vitest run docs/acceptance/dense-fusion.audit.test.ts
```

The Dense benchmark uses deterministic float32 vectors to measure a 50K scan and
cancellation. The fusion test combines the current scan report with measured RRF
cost. These numbers exclude query embedding and are not 50K real-file end-to-end
latency or semantic recall. Keep the real-inference measurements separate.

## Lifecycle cases

Keep raw failures as well as successful reports. Required desktop checks include:

- Stop after a successful search but before read approval; verify acknowledged
  evidence exists even though the message has no final citations. Restart, use
  Continue, and verify `read(E1)` succeeds without another search. The child's
  inherited receipt JSON must equal the parent's exact identity/range mapping.
- Regenerate using recorded facts: zero new tool calls, a supported answer and
  persisted source ranges. Empty provider output must remain a visible failed
  run, not a fabricated success. Citation IDs use `[[E1]]` syntax; search/read
  return a directly copyable `citationMarker` and the application assigns display
  numbers. Repeat a question in the same conversation: historical `[1]`/`[2]`
  labels must not be guessed into current evidence IDs. Retain any format failure.
- Change BGE to MiniLM, reload before indexing completes, and verify startup
  reconciliation, correct dimensions, bounded complete search texts and complete
  active-batch coverage. Switch back without losing historical quotes.
- For a stale citation, exact current-source reading fails explicitly; the
  snapshot remains visible and Current version is an explicit separate action.
- Make only the test profile's selected artifact temporarily unavailable. Verify
  `waiting_model`, actual lexical fallback with no Dense contribution, and a
  source-supported no-answer response. Restore the artifact/metadata in `finally`
  and verify automatic recovery. Never remove the original model cache.
- Cancel pending/running semantic work, including before model claim and during
  tokenizer adaptation. A cancelled parent cannot publish a replacement batch;
  retry is explicit. Work cancelled before it ever acquired a model remains
  cancelled through model startup until Retry is chosen.
- Check conflict handling and scope removal/remount without deleting original
  files or replacing the frozen quality corpus.

### Reproducible conflict and cancellation materials

```sh
python3 scripts/e2e/fixtures/make-knowledge-lifecycle-corpus.py "$PROFILE/lifecycle"
```

This checks/reuses identical existing files and refuses to overwrite changed
materials. Keep these documents in separate test knowledge bases, outside the
four-document frozen quality scope:

1. Upload `conflict-policy-a.txt` and `conflict-policy-b.txt` through Resources and
   add them to a separate library. Ask a real chat model to search
   `HELIOS-CONFLICT-2481`, read both policies, compare inspection intervals and
   cite each. Expect 13 versus 29 days, both delivered document identities/ranges,
   and no invented priority: neither policy provides dates or precedence.
2. Upload `semantic-cancel-stress.txt` and add it to a separate one-document
   library. After its initial real indexing finishes, use **Rebuild index**.
   During semantic processing, after real partial vector writes, use **Cancel
   semantic indexing**. Record the task status, active batch and vector count;
   verify no later count increase. Use **Retry semantic indexing** and require
   semantic readiness and exact active-chunk/vector coverage, with that lexical
   batch unchanged by retry. Do not claim an individual native call was observed
   unless separately instrumented; Tauri's native `invoke` property is read-only.
3. Activate MiniLM in the existing model manager and require actual adaptation
   of the BGE-sized stress chunks, full 384D coverage and real-tokenizer bounds.
   Restore BGE and require full 512D coverage. Do not delete source files or reset
   the DB to make recovery succeed. Exact chunk counts can depend on fixture and
   tokenizer versions; record both counts and immutable fingerprints.
4. In Settings, the status section only inspects the selected model. Refresh and
   Test must use its saved settings and perform real inference without creating
   semantic tasks when artifact identity is unchanged. Model activation belongs
   to the existing model manager, not a second set of invented default paths.

The retained reports verify these cases in addition to the four-format import,
real Qwen search/read, restart citations, cold model switch, missing-model/no-answer
recovery, continuation and regeneration. See
`knowledge-semantic-final-report.md` and the completion plan for exact evidence,
raw-failure retention and open release/audit limitations.

Live Ollama was not available on this host. Digest/context/overflow/dimension and
identity-drift tests are HTTP-protocol regressions, not real Ollama acceptance.
macOS, Windows, release packaging, signing and installation are not covered by
this Linux debug-desktop run.
