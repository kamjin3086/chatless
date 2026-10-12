# Chatless

Tauri + Next.js desktop AI chat application: local-first, multi-provider, with an agent
runtime for files, knowledge and light coding tasks.

## Before changing anything

Product identity, feature admission, capability layers, harness evolution, Coding Pack
boundaries and quality budgets: `docs/agents/constraints.md`. A change that cannot be
placed in one of the capability layers is not approved yet.

## Working here

```bash
pnpm test         # unit + the gates that used to be a human habit
pnpm typecheck
pnpm verify       # lint:ci + typecheck + build, run this before pushing
pnpm check:pr-title "<title>"
```

Issues and pull requests may be authored by an agent, provided the work costs the
owner nothing extra - no red CI, no diff noise, no evidence-free bodies. The full
bar, the gh operations and the verification matrix: `docs/agents/maintenance.md`.

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
