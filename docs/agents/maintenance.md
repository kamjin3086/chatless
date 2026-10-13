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

`pnpm install` wires a pre-commit hook (`core.hooksPath=.githooks`, stored in the
clone's own `.git/config`): conflict markers, `biome format` on the staged files
only, and `pnpm typecheck` - about 7 seconds. It is a seatbelt, not the bar:
`pnpm verify` before pushing is still what keeps CI green, and
`git commit --no-verify` exists for the rare commit where the hook is the wrong
one to run.

| Change | Run |
|--------|-----|
| Any TypeScript | `pnpm test` and `pnpm typecheck` |
| Before pushing any code | `pnpm verify` (lint:ci + typecheck + build) |
| PR title | `pnpm check:pr-title "<title>"` |
| Rust / Tauri | `cargo check --manifest-path src-tauri/Cargo.toml` |
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
```

- **Commit only on a branch you created this session.** If HEAD sits on someone
  else's branch, do not switch branches to escape - that moves the tree out from
  under the live session and your edits land in their next commit. Take your own
  tree: `pnpm wt:add ../wt-<topic> -b <branch>` (it links `node_modules` with an
  absolute path, which the hand-written `ln -s ../repo/node_modules` is not).
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
