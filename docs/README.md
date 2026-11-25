# Documentation index

Every markdown file under `docs/`, with what it owes you. Three states, and the state decides
who keeps it true:

- **live** - describes today's code. `pnpm check:docs-symbols` fails if it names a path or a
  member the tree no longer has; its *claims* are kept true by whoever changes the code.
- **frozen** - a dated snapshot (filename date, or under `docs/architecture/`,
  `docs/acceptance/`, `docs/history/`). Excluded from that gate on purpose: a snapshot is not
  corrected when the tree moves, it is superseded by a newer one.
- **user-facing** - shipped to users, written twice (Chinese and English), neither version
  replaces the other. See `docs/agents/language.md`.

## Live - agent-facing

| Document | What it is |
|---|---|
| [`agents/constraints.md`](agents/constraints.md) | Product identity, feature admission, capability layers, quality budgets. The one place to change when the direction changes. |
| [`agents/maintenance.md`](agents/maintenance.md) | The bar for work an agent files here: verification matrix, CI reality, formatting policy, how to reply to a reporter. |
| [`agents/subsystems.md`](agents/subsystems.md) | The seams - where two subsystems have to agree (tool calls, parameters and the wire, output budget and compaction, window, interface language). Read before grepping. |
| [`agents/language.md`](agents/language.md) | Which surface is English, which stays Chinese, and the two hard rules (answer a thread in its own language; disclose agent-authored text). |
| [`agents/issue-tracker.md`](agents/issue-tracker.md) | `gh` recipes for this tracker, including sub-issues and native blocking. |
| [`agents/triage-labels.md`](agents/triage-labels.md) | The five triage labels and what each means here. |
| [`agents/domain.md`](agents/domain.md) | How the skills consume `GLOSSARY.md` and `docs/adr/`. This repo is single-context. |
| [`prompt-language.md`](prompt-language.md) | Every model-facing prompt is English; the answer language follows the user. CI re-runs the audit that reads this file. |
| [`default-permissions.md`](default-permissions.md) | The filesystem / shell / HTTP / opener scope a user actually grants, and where enforcement lives. |
| [`knowledge-rag.md`](knowledge-rag.md) | Knowledge/RAG design invariants: document as the only source of truth, retrieval finds evidence, the model reads evidence and may not invent it. |
| [`skills-architecture.md`](skills-architecture.md) | Skills today: a set of `SKILL.md` assets and one seam (the index). Includes what the old blueprint claimed that never existed. |
| [`sync-architecture.md`](sync-architecture.md) | WebDAV sync invariants: forced ETag compare-and-swap, deterministic conflicts, tombstones, and which prompt-sync file is dead. |
| [`llm-troubleshooting.md`](llm-troubleshooting.md) | When a reply answers the wrong question: what the database and log levels show, on all three platforms. |
| [`tauri-window-pitfalls.md`](tauri-window-pitfalls.md) | Window/chrome bugs that pass every build: event-loop re-entry, resize feedback, restored-hidden state - and the script that catches them. |

## Live - platform and packaging

| Document | What it is |
|---|---|
| [`macos-signing.md`](macos-signing.md) | Ad-hoc signing, the ONNX dylib/library-validation trap, and what the release workflow actually verifies. |
| [`windows-portable.md`](windows-portable.md) | The no-install ZIP: what it includes, what it does not change about data and updates. |
| [`faq.md`](faq.md) / [`faq-en.md`](faq-en.md) | User-facing troubleshooting (user-facing). |
| [`../README.md`](../README.md), [`../INSTALLATION_INSTRUCTIONS.md`](../INSTALLATION_INSTRUCTIONS.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | User entry points (user-facing, each with an English twin). |

## Decisions

[`adr/README.md`](adr/README.md) indexes the five ADRs and states how amendments work. Read the
ones that touch the area you are in; contradicting one means surfacing it, not overriding it.

## Frozen snapshots

- [`architecture/`](architecture/) - the 2026-10-24 map and two review passes. Start at
  `final-review-2026-10-24.md`, whose **Status re-check — 2026-11-25** section says which
  findings are fixed, which are open, and which probes have drifted from the code. The nine
  `.probe.ts` / `.config.ts` files beside them are re-runnable (the commands are in that
  section) but are not collected by `pnpm test` and are not type-checked by anything.
- [`acceptance/`](acceptance/) - real-run evidence: the knowledge/semantic report and runbook,
  plus the audit tests and fixtures `pnpm test` collects (`*.audit.test.ts`,
  `retrieval-eval.sqlite`). Evidence, not specification.
- [`history/`](history/) - superseded records: one-off acceptance runs, one triage pass,
  finished plans, and the semantics that now live in `agents/subsystems.md`. Each opens with an
  archive banner. Useful as precedent, never as current status.

## Adding a document

Pick a state first. If it describes the code, it is **live**: it must survive
`pnpm check:docs-symbols`, and the next person who edits that code owns correcting it. If it
records one round of work, it is **history**: put it in `docs/history/` (that directory is what
freezes it - a date in the filename also works) and say at the top what it was measuring. Then
add it to this index; a document nobody can reach from here is a document nobody finds.
