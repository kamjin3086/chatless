# Knowledge-to-chat repair acceptance

Verified on Fedora/Linux with the native Tauri WebKit WebDriver and a real
`Qwen3.8-Flash-Next` model. This is runtime evidence, not a mocked model task.

## Repairs

- Knowledge service entry points await database initialization. Directly opening
  the knowledge page or a document-management deep link no longer depends on
  first mounting the chat composer.
- The composer restores the conversation's persisted knowledge mount, changes it
  on conversation switches, ignores outdated asynchronous lookups, and clears
  the mount immediately on explicit removal. Sending/retrying without an explicit
  picker value retains the conversation mount rather than silently clearing it.
- Source citations use the ordinary lazy Markdown renderer. A remark transform
  resolves both raw agent-segment `[[E1]]` markers and persisted `[1]` markers to
  source popovers. Markdown formatting, code examples and ordinary links remain
  intact; unregistered evidence markers cannot invent source buttons.
- Evidence reads validate document, batch and available content-hash identity
  before applying either citation offsets or a supplied cursor. Reindexing or
  supplying another document cannot silently reinterpret an old citation.
- Adding documents uses real stored IDs, including durable chat attachments,
  rather than synthetic message-reference IDs followed by a skip. Existing
  library mappings, not a file's single primary-library field, decide whether
  a document is already attached. Legacy message references without retained
  original file bytes are not offered as importable files; re-upload their source.
- Native read-then-write transactions for index publication, event sequencing,
  checkpoints and approval decisions acquire the writer with `BEGIN IMMEDIATE`.
  This prevents the observed SQLite `517` snapshot-upgrade failure during chat
  tool-call persistence while other app writes run.

No dependency or default-permission changes were made.

## Reproduction and regression evidence

| Check | Observed result |
| --- | --- |
| Cold service entry points, before the fix | 4 failed tests: listing, deep link, creation and initialization-error propagation |
| Citation identity, before the fix | 3 failed / 1 passed: stale evidence, another mounted document and a cursor override all returned replacement text |
| Citation rendering, before the fix | Server-rendered HTML contained literal Markdown and `[[E1]]`; inline code could become a source button |
| Durable attachment import, before the UI fix | Selecting `chat-knowledge-acceptance.txt` produced the unsupported warning; its library-mapping count remained 0 |
| Native concurrent event commits, before the lock fix | The 32-writer WAL test failed with SQLite codes `517` and `5` |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_runtime::tests -- --nocapture` | `6 passed; 0 failed` |
| Repeated 32-writer concurrency regression | 10 consecutive runs passed, each retaining all 32 ordered events |
| `pnpm test` in the working tree | `Test Files 151 passed \| 3 skipped (154)`; `Tests 1066 passed \| 3 skipped (1069)` |
| Retrieval evaluation on generated real SQLite | `Recall@8=100.0% allExpected=100.0% noAnswerClean=4/4` |
| `pnpm lint:ci` and `pnpm typecheck:tests` in the working tree | Both exited 0 |
| `pnpm verify` in the tracked-HEAD snapshot plus this patch | Lint, application types, test types, tests and static production build exited 0; `150 passed \| 4 skipped` files, `1065 passed \| 4 skipped` tests (generated retrieval SQLite was absent in that snapshot) |
| Default-identifier native debug build | `cargo build --manifest-path src-tauri/Cargo.toml` exited 0; production frontend assets were copied from the verified build |

The generated retrieval database can be recreated with
`python3 docs/acceptance/build-eval-db.py`. The evaluation command was
`pnpm exec vitest run --config docs/acceptance/vitest.config.ts docs/acceptance/retrieval-eval.audit.test.ts`.

### Full-gate caveats

The working tree already contained other-session architecture audit drafts.
`pnpm verify` in that tree stops at three TypeScript errors in
`docs/architecture/final-review-sync-2026-10-24.probe.ts` and
`docs/architecture/review-pipeline-2026-10-24.probe.ts`. They were left untouched.
The passing verification snapshot was made with `git archive HEAD`, this patch,
and the installed dependencies; executable patch files were compared byte for
byte with the working tree. No gate was weakened or skipped to claim that result.

The complete Rust library run returned `64 passed; 1 failed; 4 ignored`.
The failure is `mcp::repair::tests::classify_npx_cmd_path` (a Windows `.cmd` path is
classified `Direct` rather than `Npx` on Linux). Its source is unchanged, confirmed
by `git diff --exit-code HEAD -- src-tauri/src/mcp/repair.rs`. The relevant runtime
transaction tests above all passed; this record does not claim the full Rust
suite is green.

## Real desktop flow

The final native run passed all nine checks in
`scripts/e2e/knowledge-chat-e2e.mjs`:

1. A cold knowledge route lists the persisted library.
2. The stored chat document has an indexed library mapping.
3. The library has two indexed documents and 13 active keyword chunks.
4. Opening a conversation without a `knowledgeBase` URL restores its mount.
5. The real model invokes `knowledge.search` (observed mode: `lexical`) and
   `knowledge.read`, and persists an answer with a supporting citation.
6. Clicking the answer's citation opens the source quote.
7. Reloading retains both the mount and clickable citations.
8. Switching to a new chat does not inherit the mount; returning restores it.
9. Removing the mount persists across reload; explicit selection remounts it.

The source attachment contains a deliberately unique maintenance fact: device
`ORION-KB-4826`, interval **37 days**, owner **林工**, and acceptance phrase
**紫杉星河4826**. It was first attached to one conversation, then imported into the
library through the real dialog. The final question was sent in a new conversation
with **zero direct attachments** and no prior messages. The persisted answer
returned all three facts and a matching source quote. Thus the answer did not
come from that conversation's attachment scope or prior history.

The final report is `/tmp/chatless-knowledge-chat-final-report.json`
(`passed: true`); the final run's assistant message is
`f970fb1e-d7e6-4965-9025-1426a9b707c3`. Test data was retained.

### Rerunning against a live WebDriver session

Supply `CHATLESS_KB_SESSION_ID`, `CHATLESS_KB_ID`,
`CHATLESS_KB_CONVERSATION_ID`, and optionally `CHATLESS_KB_DRIVER_URL` to
`node scripts/e2e/knowledge-chat-e2e.mjs`. The chosen conversation must already
have the library mounted and a chat model configured. Optional inputs:

- `CHATLESS_KB_IMPORT_NAME`: import an already stored upload/chat document by name.
- `CHATLESS_KB_QUERY` / `CHATLESS_KB_EXPECT`: question and expected source fact.
- `CHATLESS_KB_REPORT`: report destination.

The harness preserves data and settings. It approves only pending **knowledge**
reads in the requested flow, without changing trust preferences. Keep the app
visible or use a dedicated Xvfb display: an occluded WebKit window in the original
desktop session suspended animation frames and therefore list measurements.
The harness now rejects suspended frames before sending rather than misdiagnosing
that environment as a product rendering failure. The trial list-bootstrap change
was reverted and is not part of this patch.

Desktop acceptance here covers Linux and the keyword retrieval baseline. It does
not claim Windows/macOS desktop verification, dense-model quality/performance,
or an upgrade/release-package installation test.

## Review follow-up: scoped deep links and exact evidence ranges

A subsequent review exposed two boundaries not covered by the nine-check desktop
run above. That earlier run is not proof of these follow-up fixes:

- A retained `knowledgeBase` URL parameter could overwrite another conversation's
  mount when the composer changed conversations. `useKnowledgeBaseSelection` now
  captures a destination-scoped, one-shot intent and consumes the URL parameter.
  It defers binding while conversations load or while an explicit URL destination
  is not yet active. Unsent drafts retain their choice; manual replacement,
  removal and effect cleanup prevent delayed lookups from restoring an old choice.
- `knowledge.read` with `before=0, after=0` previously used only the first offset,
  then read the rest of the document. The regression initially reported three
  failures (substring boundary, non-contiguous ranges and continuation boundary).
  Exact reads now fetch only the recorded chunk IDs, respect every start/end
  offset and preserve the original evidence identity in continuation cursors.
  Expired exact cursors fail rather than falling back to unrestricted sequential
  reading. Ordinary document reads and default neighbouring-context reads retain
  their existing behavior.

Follow-up verification:

- `pnpm exec vitest run src/hooks/__tests__/useKnowledgeBaseSelection.test.ts src/lib/mcp/pipeline/__tests__/knowledgeReadVersion.test.ts`:
  `Test Files 2 passed (2)`, `Tests 19 passed (19)`.
- `pnpm test` in the working tree: `Test Files 152 passed | 3 skipped (155)`,
  `Tests 1081 passed | 3 skipped (1084)`.
- `pnpm lint:ci`, `pnpm typecheck:tests` and `git diff --check`: exit 0.
- `pnpm verify` in a tracked-HEAD snapshot plus the executable patch: exit 0,
  including the production Next build; `151 passed | 4 skipped` files and
  `1080 passed | 4 skipped` tests. The generated retrieval SQLite was absent in
  that snapshot. The working tree's application typecheck still reports only the
  same three other-session audit-draft errors described above.

The hook regressions execute the production hook with a deterministic state/effect
scheduler (including cleanup), not a desktop DOM. The desktop harness now requires
consumption of a real knowledge deep link before its conversation-switch check;
that expanded live-model/desktop run was not repeated during this follow-up.
