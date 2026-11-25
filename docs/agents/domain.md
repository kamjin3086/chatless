# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This repo is **single-context**: one `GLOSSARY.md` at the root, one `docs/adr/`.
There is no `GLOSSARY-MAP.md` and no `src/<context>/docs/adr/`, and no plan to add
them - the multi-context layout the `/domain-modeling` skill supports does not
apply here, so do not go looking for it.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read the ADRs that touch the area you are about to work in.

If either is missing, proceed silently - do not flag the absence and do not create
one preemptively. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily, when a term or a decision
actually gets resolved.

## Use the glossary's vocabulary

When output names a domain concept (an issue title, a refactor proposal, a hypothesis,
a test name), use the term as defined in `GLOSSARY.md`. Do not drift to a synonym the
glossary explicitly avoids.

If the concept you need is not in the glossary, that is a signal: either the output is
inventing language the project does not use (reconsider), or there is a real gap (note
it for `/domain-modeling`). Chinese UI words in the glossary - 「记住目录」「全局免问」 -
are the domain terms themselves; keep them, and write the English definition around them.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently
overriding:

> _Contradicts ADR-0004 (the Rust allowlist is the enforcement point), but worth
> reopening because…_
