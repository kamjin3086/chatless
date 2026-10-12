<!-- PR 标题与正文用英文：`type(scope): description`，ASCII。CI 会检查标题。
     Full bar for agent-authored PRs: docs/agents/maintenance.md -->

## 📝 Summary

What changed, in three lines or fewer. Motivation and any dependency it resolves.

Fixes #(issue)

## 🔄 Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (fix or feature that would change existing behaviour)
- [ ] Documentation update

## 🔬 Evidence

Before / after, the commands actually run, and their real output. Numbers, not
"tests pass". State explicitly what was **not** verified.

```text
pnpm test  ->  Test Files X passed, Tests Y passed
```

| | Before | After |
|---|---|---|
| | | |

## 🚪 Merge danger

- **Door:** one-way (data format, permission default, public behaviour) / two-way (a revert is enough)
- **Blast radius:** which subsystems or users can feel this

## 🤖 Authored by

- [ ] Written by an AI agent (or heavily agent-assisted)
- [ ] The PR title and body are in English, title is `type(scope): description`

## ✅ Checklist

- [ ] `pnpm verify` passes locally (lint:ci + typecheck + build)
- [ ] New/changed behaviour is covered by a test that would have failed before
- [ ] No unrelated cleanup, no drive-by formatting
- [ ] Generated files regenerated, not hand-edited
- [ ] Docs updated where the behaviour is user-visible
