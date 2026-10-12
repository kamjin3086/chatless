# Chatless

Tauri + Next.js desktop AI chat application: local-first, multi-provider, with an agent
runtime for files, knowledge and light coding tasks.

## Before changing anything

Adding or narrowing a feature, touching default permissions, the agent harness, or a
dependency: read `docs/agents/constraints.md` first (product identity, feature
admission, capability layers, harness evolution, Coding Pack boundaries, quality
budgets). A change that cannot be placed in one of the capability layers is not
approved yet.

## Working here

```bash
pnpm test         # unit + the gates that used to be a human habit
pnpm typecheck
pnpm verify       # lint:ci + typecheck + build, run this before pushing
pnpm check:pr-title "<title>"
pnpm test:acceptance   # wider acceptance set, mostly env-gated
pnpm repo:state   # main sha, worktrees, whose branch this tree is, open PRs
```

Starting a separate tree for a task: `pnpm wt:add ../wt-<topic> -b <branch>`.

A pre-commit hook runs typecheck and formatting on staged files. It is a seatbelt,
not the bar: `pnpm verify` before pushing is still on you, and
`docs/agents/maintenance.md` has the PR bar and the git-safety probes.

Issues and pull requests may be authored by an agent, provided the work costs the
owner nothing extra - no red CI, no diff noise, no evidence-free bodies. The full
bar, the gh operations and the verification matrix: `docs/agents/maintenance.md`.
Reviewing a diff instead of writing one: `CODING_STANDARDS.md`.

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

## Subsystem notes

- `docs/prompt-language.md` - every model-facing prompt is English; the answer language follows the user
- `docs/default-permissions.md` - default filesystem / HTTP / opener scope
- `docs/skills-architecture.md`, `docs/sync-architecture.md`, `docs/tauri-window-pitfalls.md`,
  `docs/llm-troubleshooting.md` - per-subsystem state and known traps
