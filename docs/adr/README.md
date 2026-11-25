# Architecture decisions

One file per decision, and the decision is made once. Amendments go in the same file under
a heading that names what changed (see ADR-0003 and ADR-0004), not in a new ADR that
contradicts the old one - an ADR that argues with its predecessor is a note, not a decision.
Date the heading when the change is tied to a moment (a release, a build break); name it when
it is only a narrowing or widening of scope, which is what most of ADR-0003's amendments are.

Numbering is append-only: a new decision takes the next number, and nothing is renumbered
when the order stops mattering.

| ADR | Decides | What it guards when someone wants to "clean up" |
| --- | --- | --- |
| [0001](0001-tool-policy-is-pure-pipeline-owns-side-effects.md) | Tool-policy functions are pure; the pipeline owns every side effect (store write, Tauri call, grant registration). | Moving the approval round-trip back into the policy module makes the rules untestable without a live store, database and waiting user. |
| [0002](0002-always-keeps-two-meanings-promotion-grid-enumerated.md) | `always` stays one word with two meanings (directory-with-everyday-permissions for the filesystem, global shell trust for the shell); the answer × scope grid is enumerated with no default branch. | Renaming the answers, or letting a planner take a default branch, silently drops a cell - the grid is pinned by tests including the delete exception. |
| [0003](0003-one-tool-risk-table-two-predicates.md) | One `server + tool → risk` table (`policy/toolRisk.ts`) answers "may this run while planning" and "would replaying this add a side effect"; membership is not widened casually. | Adding an `fs` tool name to that table is a security-relevant edit, not a cleanup; five amendments record what was widened, what was narrowed back, and why. |
| [0004](0004-rust-allowlist-is-the-filesystem-enforcement-point.md) | The Rust allowlist behind the `filesystem_*` commands is the single enforcement point; plugin-fs stays inside app-owned roots. Includes the 2026-11 amendment that a skill package's own `allowed-tools` grants nothing. | Two directory lists in two languages is what this removed; a new gate that consults a second list re-opens it. |
| [0005](0005-glass-surface-system.md) | The glass theme is one sheet, one blur, three fill levels, and a measured contrast floor (the veil values are what they are because text has to clear WCAG over a pure-white and a pure-black photograph). | "Improve" passes that add a second blur, a nested rounded surface, or a fill-level bypass break the floor the numbers pin. |

Before working in an area, read the ADRs that touch it (see
[`docs/agents/domain.md`](../agents/domain.md)); contradicting one means surfacing the
conflict, not quietly overriding it.
