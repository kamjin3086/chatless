# Maintenance by an agent

Agents triage issues, write PRs and close out reports in this repo. That is
accepted, on one condition: **the work has to move time off the owner, not onto
them.** The owner reviews evidence, not process.

## The one test

Before filing or opening anything: if the owner spends zero extra minutes on
this, does the repo get better? If it only works after the owner asks a
clarifying question, rebases, re-runs CI, or reads a diff of reformatting, it is
a cost, not a contribution.

## What costs the owner time - don't

| Cost | Do instead |
|------|-----------|
| Red CI on an open PR | `pnpm verify` locally before pushing; all three checks are local |
| Diff noise: reformatting, import churn, renames unrelated to the change | One logical change per PR; `git diff --stat` before opening |
| Comments that add nothing (`+1`, "I can help", status pings, "any update?") | A comment carries a fact, a reproduction, or a decision - or it is not posted |
| Duplicate issue / PR | Search first: `gh issue list --state all --search "<keywords>"`; close with `Duplicate of #<n>` |
| Body that says "see commits" or restates the diff | The Evidence block below: what ran, what it printed, before vs after |
| Guessing a fix for a report with no reproduction | Ask for the reproduction, `gh issue edit <n> --add-label needs-info`, leave it open |
| Loosening a gate to get green (`continue-on-error`, skipping a test, raising `--max-warnings`) | Fix the failure, or write the reason up in the PR and let the owner decide |
| Dependency bumps to `latest`, lockfile churn | Only when the issue asks for it, and pin what ships (see `docs/agents/constraints.md` § 质量预算) |
| Reopening a settled decision | Add the new evidence in a comment; the owner reopens. ADR / triage records win until they do |
| Force-push, tagging, releasing, changing default permissions, signing config | Never in an agent PR without an explicit ask |
| Translating existing Chinese docs / re-styling README | New docs follow `docs/agents/language.md`; existing content is not rewritten |

## Agent-authored issues

- Title: `type: English summary` shape is not required, but the title must name
  the symptom, not the guess ("macOS ARM build reported as damaged", not
  "signing bug").
- Body: symptom → reproduction → expected/actual → environment → proposed
  direction. If a Chinese report is being converted, follow the intake recipe in
  `docs/agents/language.md` (English record, original text quoted verbatim).
- Labels, on the tracker today: `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `wontfix`, plus `bug` / `enhancement` / `duplicate` /
  `invalid` / `question`. An issue an agent is about to implement gets
  `ready-for-agent` only when it is fully specified: a reader with no context
  could finish it without asking anything.
- Write it as a ticket, not a diary: no running commentary, no "I will now...".
- **Language and disclosure**: an issue thread is answered in the thread's own language, and
  every issue, PR and comment an agent writes opens with `> AI生成，人工审核。`
  (`> AI-generated, human-reviewed.` in an English thread). Both are required, not preference
  (`docs/agents/language.md`).

## Replying to a reporter

The account that posts is the owner's, so a reply reads as the maintainer's own. These are the
owner's rules; they are not style suggestions and they do not have an "unless the issue is
interesting" exception.

### Voice

- **The maintainer, not a supplicant.** No apology, no self-deprecation, no "you don't have to do
  anything". A bug report is normal business; the owner owes a correct answer, not contrition.
- **Thank where thanks are due, in the first sentence.** When the reporter did work that moved the
  issue - logs or a reproduction detailed enough to save a round of questions, the version and
  environment given unprompted, a suggestion that changes the fix - open with one short,
  specific thank-you: `日志挺全的，省了我们一轮排查。` It names what it is for. Generic gratitude
  (`感谢反馈`) is padding and reads as a template. One sentence, no exclamation marks, no
  "非常/十分", no emoji: warm is not enthusiastic. And **no thank-you when the reporter only
  restated the bug** - a report is normal business, and thanking every one of them devalues the
  one that earned it.
- **Warm, not servile.** A reply is one person talking to another. `修好了`、`这个场景确实容易踩`、
  `你贴的那行日志里…`、`我们之前漏了这条` are warmth: they show attention to the reporter's own
  details and give a straight answer. `确认是产品问题。临时办法：……` is a system notice - correct
  and too cold. `抱歉给你添麻烦了` is too soft. Neither is the voice.
- **Plain, spoken sentences.** Short connected sentences rather than a fragment list; the reader
  should hear a person, not a template. One or two human touches is the budget - no jokes, no
  emoji, no cheerleading.
- **Say the state, not the absolution.** "我们漏了这条" is a fact about the code; dwell on it no
  further, and never apologise for it.
- **Three short paragraphs at most**: what is confirmed (in the reporter's terms), the workaround
  if one exists, what happens next. One specific ask, never a list of questions.
- **The reporter's own language**, opening with the disclosure blockquote.

### What may be posted without asking the owner

Only these four classes:

1. A one-line status after the fix is merged: what changed, in which version, what to try.
2. A duplicate pointer **and close** - only when the symptom and the cause are both the same as
   the older issue. Similar-but-unconfirmed gets the link and stays open.
3. A needs-info ask: one specific thing, one time.
4. A declared "not planned" **whose policy the owner has already stated** (in this file, an ADR,
   an issue, a reply). Example: #72's "桌面优先，移动端没有排期". A *new* policy position is not
   an agent's call.

Everything else - a cause explanation, a workaround, "this is expected behaviour / you are using
it wrong", a promise, anything about priority - is drafted first and posted after the owner
confirms. Drafts are the final text plus a one-line class label, at most three per turn.

### Cadence

- No acknowledgement-only replies. If there is no progress to report, say nothing at all: a
  "已记录，暂时没有结论" line reads as odd when it carries nothing, and the owner would rather the
  thread stay quiet until there is an answer.
- At most three replies per issue over its life: the first disposition, the fix, the close. When
  the fix and the close coincide, they are one reply.
- Needs-info: ask once (one thing). Fourteen days without an answer gets one more comment, with
  "若两周内没有补充我先关掉，随时可重开"; fourteen more closes with the reopen condition stated.

### Facts

Every claim in a reply is something that was run or read in this repo at the version being
discussed, or a commit to point at. Unverified inference is not written as a conclusion; the
reply says what is unknown instead. An "expected behaviour" reply is a conclusion and follows the
draft-first rule above.

### Closing

- The agent may close: duplicates (per above), needs-info that ran out (per above), and issues
  the owner has already decided are not planned.
- A fix stays open until the reporter confirms it or the owner closes it. One exception: fix on
  main, verified locally, thirty days without any response from the reporter - then one comment
  ("已在 `<version>` 修复，先关闭；复现请直接重开") and a close.
- Never close for staleness in any other case, and never close an issue the owner is discussing.

### Before posting a draft

`pnpm check:reply <draft.md>` (or pipe it on stdin) checks the mechanical half of the rules above:
the disclosure blockquote first, three paragraphs at most, no apology or gratitude padding, no
exclamation marks, no fenced blocks or backticked paths/functions, and no sentence that hands the
reporter a decision. It cannot judge whether the reply is in the right class, whether the thank-you
was earned, or whether a fact was actually verified - that is the owner's read.

### Ask first

Explaining a cause, offering a workaround, making a promise, saying anything about priority, or
taking a new policy position is not the agent's call: the draft goes in front of the owner and is
posted after they confirm. "Fixed in `<sha>`, thanks for the report" needs no review.

## Agent-authored PRs

Required in the body (the template enforces the shape):

1. **Summary** - what changed, in three lines or fewer.
2. **Evidence** - before / after, the exact commands run and their real output
   (`pnpm test` -> `Test Files N passed (N), Tests N passed (N)`). Numbers, not
   "tests pass". If something was not verified, say so in the same block.
3. **Merge danger** - `Door:` one-way (hard to undo: data format, permission
   default, public behaviour) or two-way (revert is enough); `Blast Radius:`
   which subsystems can feel this.
4. **Agent-authored** - tick the checkbox, and open the body with the disclosure line
   (`> AI-generated, human-reviewed.`). The owner treats an
   unclaimed agent PR as untrusted and re-derives everything; a claimed one gets its evidence
   checked instead of the whole diff re-read. That is the difference between "no burden"
   and "twice the work".

Scope rules: no unrelated cleanup, no drive-by formatting, generated files
regenerated rather than hand-edited (`pnpm icons:index`,
`pnpm generate:settings-index`), and the PR may not touch files its own body does
not mention.

## Verification matrix

`pnpm install` wires a pre-commit hook (`core.hooksPath=.githooks`, stored in the
clone's own `.git/config`): conflict markers, `biome format` on the staged files
only, and `pnpm typecheck` - about 7 seconds. The format check exempts a file that was already unformatted at HEAD, so `--no-verify` is not the answer to someone else's dirt. It is a seatbelt, not the bar:
`pnpm verify` before pushing is still what keeps CI green, and
`git commit --no-verify` exists for the rare commit where the hook is the wrong
one to run.

| Change | Run |
|--------|-----|
| Any TypeScript | `pnpm test` and `pnpm typecheck` |
| TypeScript that only tests use | `pnpm typecheck:tests` - the root `typecheck` excludes every test file |
| Before pushing any code | `pnpm verify:fast` (lint:ci + typecheck + typecheck:tests + test) - seconds to a couple of minutes |
| Before pushing a build-affecting change, or when CI is the only gate | `pnpm verify` (= `verify:fast` + `next build`); the build takes ~18 minutes here and refuses to start while a dev server holds `dist` |
| PR title | `pnpm check:pr-title "<title>"` - `pnpm repo:state` now flags an open PR whose title the gate would reject, so this is caught before the push; the title workflow has no `edited` trigger, so a retitle alone does not clear the red check |
| What a PR's CI actually runs | the five commands across the two jobs in `.github/workflows/ci.yml`: `frontend-checks` runs `lint:ci`, `typecheck`, `typecheck:tests`, `test`; `backend-check` runs `cargo check`. The `test-tauri-*` jobs are `if: false`, so **no build runs on a PR**: `next build` (below) is a local-only gate and a claim that "CI covers the build" is false |
| Rust / Tauri | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust unit tests | `cargo check --tests` proves they compile, never that they pass. Running them costs a full codegen + link (minutes, ~1-2 GB here); decide up front whether the evidence is worth it, or prove the arithmetic another way and say so |
| Model-facing prompt text | `pnpm test src/lib/prompts/__tests__/prompt-language.test.ts` (see `docs/prompt-language.md`) |
| Start-up, window, tray, macOS visuals | `scripts/verify-app-startup.sh src-tauri/target/release/chatless` - macOS only (hard-coded log path), needs a release build |
| Search / knowledge / budget work | the wired audits in `pnpm test`, plus `pnpm test:acceptance` - see the note below |
| "What is the actual state here" | `pnpm repo:state` |
| New worktree for a task | `pnpm wt:add ../wt-<topic> -b <branch>` |

Evidence comes from the runner and the pointer, not from a summary line:
`pnpm ci:log <pr|--job <id>>` is a *view* over `gh run view --log` with the gh prefixes
and ANSI removed, keeping the classes listed in `KEEP_RULES` in `scripts/ci-log.mjs`
(test counts, the PR-title check with its indented reason, TS/Rust/biome/next/coverage
failures); that is how `final-plan.audit.test.ts` was proven to run. A filter can
always be missing a class, so an empty or suspicious view is not evidence of absence -
`--grep <text>` widens it and `--all` is the raw log. `pnpm repo:state` shows the PR list and
main's sha, and names which source it used - `gh api
repos/<owner>/<repo>/git/ref/heads/main` is where main actually is.

Pick the check that would have caught the bug. "The process is alive" passed on
0.7.0 while the app was pegging a core and never finished initialising; that is
why `verify-app-startup.sh` asserts that start-up *finishes* and that a resize
still works (`docs/tauri-window-pitfalls.md`).

## Repo reality an agent needs to know
- **A comment that names a symbol promises that symbol exists.** `pnpm check:comments`
  (`scripts/comment-symbols.mjs`) pulls the backticked lowerCamelCase names out of comments in
  code files (10+ characters, two inner capitals) and fails on one that no non-test code in
  `src`/`scripts` defines; the hook runs it over staged files and lets exit 2 - the check
  itself broken - through as a warning. Two review rounds caught these by hand (#138 left a
  type's doc saying "call `normalizeModelParameters` when a complete bag is needed" for a
  function that PR deleted), which makes it mechanical, not judgement. Resolution means
  *definition-adjacent*, not mention: the first version grepped the bare name across docs too,
  and then the doc that recounted the stale-pointer story was what certified the pointer alive.
  Reproduce the shape with a file whose only content is a comment naming a function that does
  not exist: `node scripts/comment-symbols.mjs <that file>` exits 1.
- **Formatting is judged per file, and only where HEAD already conformed.** main is largely
  unformatted: `for f in $(git ls-files 'src/**/*.ts' 'src/**/*.tsx'); do npx biome format
  "$f" >/dev/null 2>&1 || echo "$f"; done` fails **759 of 856** tracked files under src. A
  hook that demanded format anyway had exactly two outcomes - whole-file reflows that bury
  the change (one commit produced 2,191 lines of it) or `git commit --no-verify` - and both
  were happening. So `scripts/format-policy.mjs`, which is what the hook now calls, holds a
  file to biome only if the version being committed already satisfied it: today that is the
  ~97 conforming files, and nothing else. `pnpm fmt <files>` is the daily command; it
  refuses a directory, refuses to reflow pre-existing dirt unless `--allow-reflow`, and
  treats a biome that could not run as an error rather than as a pass. The refusal is now
  two-way: a file HEAD left unformatted that your staged version has fully formatted is a
  **reflow** (20+ differing lines) and is refused. Three PRs this week arrived that way
  (#138, #141, #143); check one: `git show --stat 71e7f1b | grep provider-field-support` prints
  234 changed lines for a six-line fix. Each was caused by calling `npx biome check --write`
  directly instead of `pnpm fmt`, which had already refused. Two consequences to
  keep in sight: the format gate stays narrow until the standing dirt is cleared, and clearing
  it is a formatting-only commit of ~759 files - the owner's call, not something to slip into
  a change PR. Judge cleanliness on file bytes: `biome format --stdin-file-path` has reported
  unformatted files as clean, and one whole-tree reflow got justified that way.
- **`gh`'s GraphQL path fails at random and the REST path is the way through.** `gh pr
  create` / `gh issue create` ride GraphQL and die with
  `Post "https://api.github.com/graphql": EOF` on a flaky link, while `api.github.com` over
  REST keeps working. The fallbacks are all used here and all work:
  `gh api -X POST repos/<owner>/<repo>/pulls --input file.json`,
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f title=... -f body=...`,
  `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge -f merge_method=squash -f sha=<head-sha>`,
  `gh api -X POST repos/<owner>/<repo>/issues/<n>/comments -f body=...`,
  `gh api -X POST repos/<owner>/<repo>/issues -f title=... -F body=@file.md`.
  Add the issue body with `-F body=@file`, not `-f body=`, or a multi-line body arrives truncated.
  **A retry loop must de-duplicate before it repeats**: an issue POST that dies on the way back
  may still have created the issue. This week's #140 and #142 were each retried in a 20× loop,
  which is 20 tickets one flaky response away from happening. Check first:
  `gh api "repos/<owner>/<repo>/issues?state=all&per_page=50" --jq '.[].title' | grep -F "<title>"`.
- **Read CI with `pnpm ci:log --checks <pr|sha>`, not with `gh pr checks`.** `gh pr checks`
  rides the same GraphQL path that dies first, and `pnpm ci:log <pr>` answers a different
  question (what a finished run printed). `--checks` reads REST `commits/:sha/check-runs` and
  prints a verdict: `green`, `still running (…)`, `not green (…)`, exit 0 / 3 / 1.
  **An empty board is not "queued" and not "the paths filter skipped it"**: it means Actions
  never took the event, which happened to two PRs while the link was bad, and the fix is to
  push again (any commit, or `--force-with-lease`). On #141 the board stayed empty for two
  hours while `gh api "repos/<owner>/<repo>/actions/runs?per_page=5" --jq '.workflow_runs[].head_branch'`
  showed no run for the branch at all; closing and reopening the PR changed nothing, and the
  force-push started CI within seconds. Exit codes: 0 green, 1 not green, 3 still running, 4
  no run registered.
- **A merge command's failure can be about your worktree, not about the merge.** With `main`
  checked out in another worktree, `gh pr merge --squash --delete-branch` exits non-zero
  (`致命错误：'main' 已经被工作区 … 使用`) *after* the merge succeeded on the server. Ask the
  server (`gh api repos/<owner>/<repo>/pulls/<n> -q .state`) before concluding anything, and
  prefer the REST merge form above when several worktrees are alive.
- **`git push` can be dead while the API is fine.** TLS to `github.com:443` failed for every
  push across a whole session while `gh api` answered normally. A commit can be moved without
  git's transport: create a blob per file, `POST /git/trees` with `base_tree`,
  `POST /git/commits` with the current main sha as parent, then `POST /git/refs` (or
  `PATCH /git/refs/heads/<branch>` with `force`). The resulting sha differs from the local
  one - same content, different object - so state it in the PR rather than quoting a local
  sha as if it were the remote head.
- **What a browser can and cannot verify, and how to get past the empty store.** Measured
  on `next dev` with headless Chrome, 2026-10-19:
  - `http://localhost:3000/settings?tab=localModels&provider=DeepSeek&devStore=1` renders the
    settings shell, the provider chips, DeepSeek's card with its `未配置密钥` badge, the API
    key field and its two static models. Same DOM without the flag: the routes already
    rendered, because `ProviderRepository` serves them from the initialization cache.
  - What the flag adds is the store itself: `?devStore=1` (remembered in `sessionStorage` for
    the tab, `?devStore=0` clears it) swaps `StorageUtil`'s Tauri store for an in-memory one
    (`src/lib/dev/devStore.ts`). Without it `StorageUtil.setItem` returns false and a write
    is simply gone; with it, initialization's own writes land (the page logs `Storage: Set
    deepseek_models in provider-models.json`) and are read back. It lives in memory for the
    tab only: a reload starts fresh, like a new install.
  - A production payload does not contain it. The gate is `process.env.NODE_ENV !==
    'production'` at the import site in `StorageUtil.getStore`, which the bundler inlines, so
    the dynamic import is dropped: `pnpm build && grep -rl chatless:dev-store dist/` prints
    nothing. A guard inside the module could not do that - the caller's argument object is
    evaluated before the branch is taken, which is how an earlier version of this stub shipped
    and wrote `chatless:dev-store` to `sessionStorage` before refusing. The Tauri runtime is
    refused at the flag check, where a real store exists.
  - Still Tauri-only: chat and conversations (SQLite), model refresh and connection checks
    (`invoke`), downloads, the tray. Two settings tabs also go round `StorageUtil` and load the
    plugin store directly, so the flag does not cover them: MCP servers
    (`McpServersSettings.tsx`, `ServerManager.ts`) and the knowledge-base config
    (`knowledgeBaseConfig.ts`).
  - What a browser proves: layout, and the render that follows a stored write. It does not
    prove an interactive flow by itself - typing a key into the provider card and watching
    the badge flip was tried and not reproduced (the field commits on blur; the synthetic
    blur wrote nothing), so that claim still needs a component test or a real build.
  - Do not rediscover this by hand: open the URL above before concluding a settings surface
    is unreachable, and say in the claim which of the three you used - browser-with-stub,
    component test, or a real build. `google-chrome --headless=new --dump-dom <url> | ...`
    dumps the hydrated DOM; on a cold dev server give it ~30s, because initialization's
    network probes have to time out first.
  - **The glass theme is reachable in the browser too** (measured 2026-10-20). The store starts
    empty, so `?devStore=1` alone renders the plain theme; enable 玻璃主题 in 设置 → 外观与体验 and
    the theme is on for that tab. It survives client-side navigation, not a reload. A wallpaper
    can be set through the hidden `input[type=file]` in the same card (`agent-browser upload`),
    which in the non-Tauri runtime is stored as a data URL. Theme: `agent-browser set media
    dark|light` changes `prefers-color-scheme`, which the app's own `ThemeInitializer` follows -
    toggling the `dark` class by hand is undone by that listener.
  - **A globals.css edit needs a page reload in that tab.** The injected sheet updates through
    HMR (`GLASS_FROST_CSS` is re-applied by its effect), but a token change in `globals.css` does
    not reach an already-loaded document, and rewriting the file twice in quick succession can
    leave the dev server serving the intermediate value (observed: the veil stayed at 0.75 while
    `surface-fill` from the same edit applied). Reload, and if the value still disagrees with the
    file, restart `pnpm dev`.
  - **Screenshotting the real window (Windows).** `pnpm shot` / `pnpm click` (`scripts/shot/`) do
  the two things that are easy to get wrong: they capture the screen rect rather than calling
  `PrintWindow` (which returns a black content area for a WebView2 window), and they declare DPI
  awareness first (without it, at 125 % every coordinate is 0.8x and the right edge is silently
  lost). Read the `FG=` it prints: an unfocused capture shows whatever was on top.
- **A window preset can be larger than the desktop.** 1024x768 logical is 1280x960 physical at
    125 %, while the logical work area here is 1228x691: the app's right and bottom edges sit
    off-screen, which looks exactly like a layout bug in a screenshot. Resize to the work area
    before judging any layout, and do not report the clipping as a defect.
  - **`next dev` and `next build` share `distDir: dist`.** Running `pnpm build` (or `pnpm verify`)
    while a dev server is up leaves both stuck - the build prints "Creating an optimized
    production build ..." for a quarter of an hour and the dev server then serves 500s because
    the export wrote half a directory over its state. Stop the dev server first; deleting `dist`
    recovers dev. Separately, `next build` on this machine takes ~17 minutes of real compile time
    (recorded in `scripts/perf/build-frontend.log`), so budget for it rather than calling it hung.
  - **The first page load is the slowest thing in a dev session.** `pnpm dev:warm` is `pnpm dev` plus
  a warm-up: it requests `/` then `/chat` as soon as the server answers, so turbopack compiles while
  the cargo build runs instead of while the window sits blank (cold `/` ~11 s, `/chat` longer).
  Opt-in; plain `pnpm dev` is unchanged.
- **Frontend-only iteration does not need `cargo`.** `src-tauri/target/debug/chatless.exe`
    loads `http://localhost:3000` directly; run it next to `pnpm dev` instead of `pnpm tauri dev`
    when only CSS or TSX changed (a Rust rebuild is minutes, a restart is seconds).
  - `pnpm test` reports six `scripts/__tests__/*.mjs` files as load failures on Windows
    (`SyntaxError: Invalid or unexpected token` at the first line). They fail identically on a
    clean tree; the `src` suite is what the gate is.
- **`pnpm typecheck` never looks at a test file.** That is where a test could pass a field
  production code had deleted. `pnpm typecheck:tests` covers `src` tests plus the
  `docs/acceptance` audits `pnpm test` runs, and is part of `pnpm verify` and CI; the
  pre-commit hook deliberately runs only the production typecheck to stay fast.
- **Two vitest configs, and CI runs only one of them.** `pnpm test` (root
  `vitest.config.ts`) collects every `docs/acceptance/*.audit.test.ts`, so all of them
  are transpiled on every run even when they skip themselves for want of an endpoint or a
  generated corpus. That is deliberate and it is enforced by the inventory test: the Qwen
  harness once sat on `main` in a shape esbuild could not parse (TypeScript accepts the
  trailing comma biome puts in a wrapped `typeof import(...)` type, esbuild does not), and
  nothing noticed, because nothing transpiled it until someone tried to run it. The wider
  set has its own runner:
  `pnpm test:acceptance` (`vitest run --config docs/acceptance/vitest.config.ts`).
  There `docs/acceptance/qwen-acceptance.audit.test.ts` and
  `docs/acceptance/reasoning-stream.audit.test.ts` skip unless their endpoint is
  enabled (`CHATLESS_QWEN=1`, `CHATLESS_QWEN_URL`, ...), and
  `docs/acceptance/retrieval-eval.audit.test.ts` skips, printing
  `run python docs/acceptance/build-eval-db.py first`, until the fixture exists.
  The Qwen harness fails fast rather than measuring nothing: a task filter that matches
  no task is an error, a model the endpoint does not list is named before any task runs,
  and both rules are tested by `docs/acceptance/answerChecks.audit.test.ts`, which needs
  no endpoint.
  Name the run you actually did; a skipped suite is not evidence. The wiring of
  both configs is itself a test - an `include` entry that matches nothing, or a
  doc citing an audit file that is not there, fails
  `scripts/__tests__/vitestInventory.test.mjs`.
- **A shared inference endpoint is the operator's working machine, not a fixture.** Asking
  a router for a model it has not loaded yet evicts or contends with whatever is already
  serving, which costs the owner real work. Do not point an agent or a probe at model
  names beyond the one already agreed for a run, and ask before starting a live run that
  would load something new. The gate is enforced where it can be: an audit that resolves
  sibling model names needs both `CHATLESS_QWEN=1` and `CHATLESS_MODEL_PROBE=1`, so a
  command copied out of a ticket cannot quietly load a second model.
- Prompts are English-only, answers follow the user (`docs/prompt-language.md`);
  the test above is what keeps them that way.
- Default permission scope is a product decision, not a convenience knob
  (`docs/default-permissions.md`). Widening FS/HTTP/opener defaults needs the
  owner, not a PR.
- A triage sweep is written up as `docs/issue-triage-YYYY-MM-DD.md`, English, one
  row per item, each row carrying evidence and a disposition - precedent:
  `docs/issue-triage-2026-09-30.md`.
- GitHub numbers are shared between issues and PRs: `gh pr view <n>` first, fall
  back to `gh issue view <n>`.

## Before touching git

This repo can have several writers at once: a human, another agent session, a
worktree left open from a previous run. One command answers all three probes:

```bash
pnpm repo:state   # main sha, your branch + dirty/ahead, every worktree and how far
                  # behind main it is, whether main is merged into HEAD, open PRs

`behind-main=N` is not trivia. Rewriting history (`git reset --soft origin/main`, a rebase onto
a ref you fetched but did not merge) in a tree that is behind stages the reversal of those N
commits, quietly: this week a soft reset did exactly that, and the only thing that noticed was
a pre-commit typecheck failing on a function the "new" commit had deleted. `repo:state` now
spells it out per worktree.
```

- **Commit only on a branch you created this session.** If HEAD sits on someone
  else's branch, do not switch branches to escape - that moves the tree out from
  under the live session and your edits land in their next commit. Take your own
  tree: `pnpm wt:add ../wt-<topic> -b <branch>` (it links `node_modules` with an
  absolute path, which the hand-written `ln -s ../repo/node_modules` is not).
  Remove it with `pnpm wt:remove <path>`: the link is a junction, and
  `git worktree remove` follows it into the main checkout - one session lost
  `node_modules/.bin` that way and had to reinstall before its tests would run.
- Name the rev you merge: `git merge --no-edit origin/main`. A `git merge` without
  one merges the branch's own upstream and prints "Already up to date", which is
  easy to read as success. `pnpm repo:state`'s `main merged in` line is the check;
  it prints `unknown` rather than guessing, and names the reason it fell back - the
  reasons live in `scripts/repo-state.mjs`, not here, because "gh not installed" and
  "gh is rate limited" are different problems to act on.
- Never `git add -A` in a tree you did not create. Stage your own paths, and revert
  an experiment with `git restore --source=HEAD -- <one file>`, never with a
  whole-file `git checkout` that also eats the real edits sitting next to it.
- A commit message containing backticks or `$()` goes in a file passed with
  `git commit -F <file>`. An unquoted heredoc is a shell: `` `git branch -D main` ``
  in the message body does not document a mistake, it commits the transcript of one.
- Before deleting anything you created, prove it is safely elsewhere, then delete.
  Files: `git hash-object <file>` against `git rev-parse origin/main:<path>`.
  Branches: `git merge-base --is-ancestor <rev> origin/main`, or `git branch --contains
  <rev>` over the refs that should still hold it; tags are `git tag --contains <rev>`,
  and `git worktree list` (or `pnpm repo:state`) says which worktree holds which
  branch. Naming a branch does not make it yours to delete: `git branch -D` on a branch
  no worktree has checked out prints `Deleted branch <name> (was <sha>).` (under
  `LC_ALL=C` - git localises the message) and moves on, and only a checked-out branch
  is refused.
- `gh pr view` with no arguments happily returns *some* other PR when the current
  branch has none; it is not a branch lookup. Compare `headRefName` with the branch.

## Act, or ask

| Just do it | Ask first (issue + owner decision) |
|---|---|
| Tests, docs, type fixes, dead code with provable zero references, reproductions, triage | Behaviour changes, new capability, new dependency, permission defaults, release/signing, anything on `constraints.md`'s "禁止" lists |

Dead code counts as provable only with a reference search that includes dynamic
dispatch, generated indexes and `src-tauri`; "nothing greps it" is not proof.

## Report back

The owner gets: commands run with real numbers, what was **not** verified and
why, residual risk, links to the issues/PRs touched. Not: a plan, a summary of
the diff, or "let me know if you need anything".
