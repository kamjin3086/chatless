# Chatless

Tauri + Next.js desktop AI chat application: local-first, multi-provider, with an agent
runtime for files, knowledge and light coding tasks.

## Before changing anything

If `git status` is not clean, say whose work the dirty files are before touching them. Another
session can be mid-edit in the same tree, and `pnpm repo:state` reports branches and worktrees,
not the tree's own dirt. (Two sessions have already edited the glass files minutes apart.)

Adding or narrowing a feature, touching default permissions, the agent harness, or a
dependency: read `docs/agents/constraints.md` first (product identity, feature
admission, capability layers, harness evolution, Coding Pack boundaries, quality
budgets). A change that cannot be placed in one of the capability layers is not
approved yet.

## Working here

```bash
pnpm test         # unit + the gates that used to be a human habit
pnpm typecheck
pnpm typecheck:tests   # the root typecheck excludes every test file
pnpm verify       # lint:ci + typecheck + test types + build, run this before pushing
pnpm fmt <file…>   # format only the files you named (it refuses a directory)
pnpm repo:state   # main sha, worktrees, whose branch this tree is, open PRs
pnpm ci:log 94    # what CI actually printed: test counts, checks (build output when printed)
```

Starting a separate tree for a task: `pnpm wt:add ../wt-<topic> -b <branch>`.

A pre-commit hook runs typecheck and formatting on staged files. It is a seatbelt,
not the bar: `pnpm verify` before pushing is still on you, and
`docs/agents/maintenance.md` has the PR bar and the git-safety probes.

Issues and pull requests may be authored by an agent, provided the work costs the
owner nothing extra - no red CI, no diff noise, no evidence-free bodies. The full
bar, the gh operations and the verification matrix: `docs/agents/maintenance.md`.
Reviewing a diff instead of writing one: `CODING_STANDARDS.md` - which also says what
a review agent has to be able to *run*, because a read-only reviewer guesses.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on `kamjin3086/chatless`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## Language

Commits, code comments, branch names, pull requests and the maintainer-side issue record
are written in English; reporters may file in Chinese and the record is normalized at
intake. `docs/agents/language.md`.

This is a reading preference of the humans who read those surfaces, not a correctness
bar: mixed-language content does not make agent maintenance harder. Follow it because it
costs nothing, and never spend work enforcing it - existing content is not translated and
no contribution is rejected over prose language.

Two things here are **required**, not preference:

- **An issue thread is answered in the thread's own language.** A Chinese report gets a
  Chinese reply, including the comment that reports the fix or closes the issue; the
  reporter is the reader of that thread.
- **Every issue, pull request and comment an agent writes opens with the disclosure line**,
  in the thread's language, as a blockquote on its own line:

  ```
  > AI生成，人工审核。

  正文从这里开始。
  ```

  The translation for an English thread is `> AI-generated, human-reviewed.`
- **A reply is written as the owner's own reply.** It posts under the owner's name, so it reads
  as the maintainer speaking to a user: first person, plain language, thanks, what is known,
  what to do meanwhile, what happens next. Never the internal analysis, never a request for the
  reporter to make a decision, never a worklog. `docs/agents/maintenance.md` - "Replying to a
  reporter" - carries the forbidden list; #156 is the example of how not to do it.

## Subsystem notes

- `docs/prompt-language.md` - every model-facing prompt is English; the answer language follows the user
- `docs/default-permissions.md` - default filesystem / HTTP / opener scope
- `docs/skills-architecture.md`, `docs/sync-architecture.md`, `docs/tauri-window-pitfalls.md`,
  `docs/llm-troubleshooting.md` - per-subsystem state and known traps
