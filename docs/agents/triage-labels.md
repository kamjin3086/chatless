# Triage labels

The skills speak in terms of five canonical triage roles. This file maps those roles to
the label strings this tracker actually uses - all five exist on
`kamjin3086/chatless` (checked with `gh label list`, 2026-11-25).

| Role in the skills | Label here | Meaning                                  |
| ------------------ | ---------- | ---------------------------------------- |
| `needs-triage`     | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info`       | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent`  | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human`  | `ready-for-human` | Requires human implementation           |
| `wontfix`          | `wontfix`    | Will not be actioned                     |

The tracker also carries `bug`, `enhancement`, `duplicate`, `invalid`, `question`,
`documentation`, `good first issue` and `help wanted`; those are GitHub defaults and are
not part of the triage vocabulary. No `wayfinder:*` label exists (see
`docs/agents/issue-tracker.md`).
