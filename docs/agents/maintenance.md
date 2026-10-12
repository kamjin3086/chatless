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

## Agent-authored PRs

Required in the body (the template enforces the shape):

1. **Summary** - what changed, in three lines or fewer.
2. **Evidence** - before / after, the exact commands run and their real output
   (`pnpm test` -> `Test Files N passed (N), Tests N passed (N)`). Numbers, not
   "tests pass". If something was not verified, say so in the same block.
3. **Merge danger** - `Door:` one-way (hard to undo: data format, permission
   default, public behaviour) or two-way (revert is enough); `Blast Radius:`
   which subsystems can feel this.
4. **Agent-authored** - tick the checkbox. The owner treats an unclaimed agent PR
   as untrusted and re-derives everything; a claimed one gets its evidence checked
   instead of the whole diff re-read. That is the difference between "no burden"
   and "twice the work".

Scope rules: no unrelated cleanup, no drive-by formatting, generated files
regenerated rather than hand-edited (`pnpm icons:index`,
`pnpm generate:settings-index`), and the PR may not touch files its own body does
not mention.

## Verification matrix

| Change | Run |
|--------|-----|
| Any TypeScript | `pnpm test` and `pnpm typecheck` |
| Before pushing any code | `pnpm verify` (lint:ci + typecheck + build) |
| PR title | `pnpm check:pr-title "<title>"` |
| Rust / Tauri | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Model-facing prompt text | `pnpm test src/lib/prompts/__tests__/prompt-language.test.ts` (see `docs/prompt-language.md`) |
| Start-up, window, tray, macOS visuals | `scripts/verify-app-startup.sh src-tauri/target/release/chatless` - macOS only (hard-coded log path), needs a release build |
| Search / knowledge / budget work | the wired audits in `pnpm test`, plus `pnpm exec vitest run --config docs/acceptance/vitest.config.ts` - see the note below |

Pick the check that would have caught the bug. "The process is alive" passed on
0.7.0 while the app was pegging a core and never finished initialising; that is
why `verify-app-startup.sh` asserts that start-up *finishes* and that a resize
still works (`docs/tauri-window-pitfalls.md`).

## Repo reality an agent needs to know

- **Two vitest configs, and CI runs only one of them.** `pnpm test` (root
  `vitest.config.ts`) collects `workspace-budget`, `dense-fusion` and
  `final-plan`. The wider acceptance set has its own runner:
  `pnpm exec vitest run --config docs/acceptance/vitest.config.ts`. There
  `qwen-acceptance` and `reasoning-stream` skip unless their endpoint is enabled
  (`CHATLESS_QWEN=1`, `CHATLESS_QWEN_URL`, ...), and `retrieval-eval` fails with
  `run python docs/acceptance/build-eval-db.py first` until the fixture exists.
  Name the run you actually did; a skipped suite is not evidence.
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
