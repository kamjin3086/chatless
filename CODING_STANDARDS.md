# Coding standards

Read at review time, not during implementation. Only rules a reviewer can act on
belong here. Anything deterministic already has a check (last table) and is not
restated as prose.

## Evidence over assertion

A claim in a doc, issue, PR or review comment must be traceable to something a
machine produced.

- **Must:** a sentence asserting an absence or an impossibility - "nothing calls
  it", "this cannot be run", "no test covers X" - names the command that proved
  it. No command, no claim: run it or drop the sentence.
  *Why:* the documentation errors this repo shipped most recently were exactly
  this shape. #87 stated that the unwired acceptance audits "cannot be run by
  path"; `docs/acceptance/vitest.config.ts` had been sitting in the folder the
  whole time, one `ls` away.
- **Must:** "tests pass" is not evidence. Quote the runner's own line
  (`Test Files 81 passed (81)`) and state what was **not** run.
- **Must:** before writing that a file, script or config is missing, list the
  directory it would live in. Absence is an observation, not an assumption.
- **Should:** a negative claim about reachability (a route, a call site, a
  dynamic dispatch) says how it was searched - `grep`, reference search,
  `git log -S` - because the search that did not look for string dispatch proves
  nothing.
- **Must:** an outcome is read from the pointer that moves, never from a readiness
  field. "Merged" means `git/ref/heads/main` moved and the PR's own `state` says
  `MERGED` - `pnpm repo:state` prints main's pointer and the state of the PRs it
  can reach, and prints `unknown` for whatever it cannot reach.
  `mergeable`, `mergeStateStatus` and a green `gh pr checks` say a merge is
  *possible*; reading readiness as the event is how a branch that never merged
  gets reported as merged.

- **Must:** a bounded query proves nothing about what lies outside its bound. A list
  fetched with `-L N`, `limit` or `slice` may not be used to print an absence - it
  prints `>=N` or `unknown`. PR #93's review caught a newest-N window over all PR
  states printing "open PRs: none" after an open PR aged out of it; the finding is in
  that PR's body, reachable with `gh pr view 93 --json body | grep -- '-L 50'`.

## Running a review

These bind whoever dispatches a review as much as whoever performs it.

- **Must:** a review agent is given a way to execute - `bash` in its tool list, or a
  paired evidence agent. Read an agent's own definition instead of trusting its name:

  ```bash
  grep -H '^tools:' ~/.pi/agent/agents/*.md \
    ~/.pi/agent/npm/node_modules/pi-subagents/agents/*.md
  ```

  On this machine that prints `bash` for `diff-reviewer` and for `evidence-runner`
  (prefer the first; use the second for mechanical proof) and no `bash` for the builtin
  `reviewer`, whose list is `read, grep, find, ls, watchdog_diff, contact_supervisor`.
  A read-only reviewer produces two kinds of noise: claims it cannot
  check, and claims that are wrong. One review round asserted that
  `git worktree add <path> origin/main` silently creates a local branch, so a
  detached-HEAD hint must be wrong. Check it the locale-independent way: after that
  command, `git -C <path> rev-parse --abbrev-ref HEAD` prints `HEAD`.
- **Must:** a finding that could have been executed but was not, says so - and the
  agent acting on it runs it first. "Supervisor must run: …" is a handoff, not
  evidence.
- **Should:** hand a reviewer the diff it is meant to read. A working-tree diff
  helper shows only uncommitted changes, so a committed branch looks empty to it and
  it will review files instead of the patch, which is a different and weaker review.

## Merging

- **Must:** when a merge deletes a block of code, the merge commit message names
  the module that owns that behaviour now and the check that proves nothing dangles.
  "Kept main's side" is not a resolution. The reviewer then verifies those two
  claims instead of re-reading a whole diff of two colliding refactors.
  *Why:* the `#86` merge deleted that branch's inline copies of three policy
  helpers, defensible only because main had moved that logic into
  `src/lib/mcp/pipeline/policy/` (`toolRisk.ts`, `policy.ts`). Check it with
  `git show <rev>:src/lib/mcp/pipeline/ToolExecutionPipeline.ts | grep -c 'needsAuthorization\|isPlanOnlyAllowed\|getFilesystemOp'`:
  6 at the merge's first parent `70758ba`, 2 at merge `2ce6d2f` - the import line
  and one call site. Both revs are reachable from `main`, which
  `git merge-base --is-ancestor 2ce6d2f main` confirms (exit 0).
- **Must:** merge a named rev (`git merge --no-edit origin/main`). Without one git
  merges the branch's own upstream and prints "Already up to date", which is
  indistinguishable from success at a glance.

## Shape of a change

- **Must:** one logical change per PR. No drive-by formatting, renames or comment
  rewording outside the stated scope; a PR may not touch files its own body does
  not mention.
- **Must not:** weaken a gate to get green - `continue-on-error`, skipping a test,
  raising `--max-warnings`, deleting a failing assertion. If the gate is wrong,
  the PR changes the gate and argues for it.
  *Why:* `docs/agents/constraints.md` (§ 质量预算) treats a swallowed failure as
  worse than a red build, and `docs/agents/maintenance.md` calls the same thing
  a cost pushed onto the owner.
- **Must:** a fix that came from a wrong assumption adds the check that would have
  caught the assumption, or says in the body why no such check is possible.
- **Should:** a bug fix names the check that would have caught it; when there is
  none, that gap is the second half of the work.

## Language

`docs/agents/language.md` decides this. It is enforced at authoring time and
reviewed as a preference, never as a defect: a reviewer asks for a non-ASCII PR
title to be retitled (the CI gate already fails it) and stops there. Existing
Chinese content is not a finding, and no PR is opened to translate it.

## The deterministic checks, for reference

| Rule | Where it is enforced |
|------|----------------------|
| PR title conventional + ASCII | `pnpm check:pr-title` - CI step + `scripts/__tests__/check-pr-title.test.mjs` |
| Types, formatting, unit tests | `pnpm typecheck`, `pnpm lint:ci`, `pnpm test`; `.githooks/pre-commit` runs the cheap part locally |
| Every `include` entry collects something; audit files cited in docs exist | `scripts/__tests__/vitestInventory.test.mjs` |
| Model-facing prompts stay English | `src/lib/prompts/__tests__/prompt-language.test.ts`, see `docs/prompt-language.md` |
| Start-up actually finishes, window stays responsive | `scripts/verify-app-startup.sh`, see `docs/tauri-window-pitfalls.md` |
| Product scope, capability layers, quality budgets | `docs/agents/constraints.md` - judgement, no check |
| Reviewer can execute; unexecuted checks labelled and run first | no check - whoever dispatches the review chooses the agent |
| Agent maintenance bar, git safety, evidence format | `docs/agents/maintenance.md` |
