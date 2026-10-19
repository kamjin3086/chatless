# Collaboration language

Split by **who reads it** and **who pays**. The obligation sits with whoever
writes the tracking record - the maintainer and the agents working for them -
never with a reporter who is trying to help.

## What this rule is - and what it is not

An agent reads a mixed-language repository exactly as well as a single-language
one. A Chinese issue sitting under English commits does not slow an agent down,
does not make the next change harder, and does not raise the chance of a bug.
This rule was shaped back when humans wrote most of that record; with agents doing
the writing, its practical effect on maintenance drops to about nothing.

So it is **not a correctness rule and not a quality bar**. It is a reading
preference of the humans attached to this repo: the commit log they skim, the PR
list they scan, the triage record they reopen months later. English is just the
common denominator among those readers - the owner reads it without friction, and
prospective outside contributors may not read Chinese. That is the entire
justification, and it is enough for a default, not enough for a fight.

Two consequences:

- **Follow it, because it is free.** Branch names, PR titles, commit messages and
  new code comments cost an agent nothing, and they keep those surfaces uniform
  for the human at the top of them.
- **Never spend real work on it.** No translation passes over existing content,
  no language audits, no prose-only cleanup PRs, no rejecting a contribution over
  prose. Whenever the preference collides with something concrete - a reporter's
  precise wording, a verbatim error string, a Chinese domain term in
  `GLOSSARY.md`, a diagnosis that only comes out right in Chinese - the concrete
  thing wins and the preference yields. Tier 3 is that decision already made.

Arguing about prose is always the more expensive option.

## Tier 1 - English at the point of writing, no exceptions (and no migration needed)

Already true in practice (579 commits, zero Chinese subjects):

- Commit messages - Conventional Commits, English description
- Code comments and identifiers, including new `///` doc comments
- Branch names - ASCII kebab-case with a conventional prefix (`fix/streaming-scroll-follow`)
- CI step names, script `--help`, and any string a test asserts on

Quoting a Chinese string that a model, a user, or the UI produced is fine inside
an English message; that is evidence, not drift.

## Tier 2 - English, for the record the maintainer side writes

- **Pull requests**: title, body, review comments, merge summary. PRs here are
  authored by the maintainer or by an agent, so there is no reader being
  imposed on - and this is where the recent drift happened (#83/#84/#85 were
  Chinese-titled PRs sitting on top of English commits).
- **Triage dispositions, acceptance reports, ADRs, post-mortems** - the documents
  someone reads months later to learn *what was decided and why*. Precedent:
  `docs/issue-triage-2026-09-30.md`, `docs/prompt-language.md`, and the English ADRs
  waiting on PR #83.
- **Agent-facing instruction files** - `AGENTS.md`, `docs/agents/*`.
- **New issues created by the maintainer or an agent** (`/to-tickets`, wayfinder
  tickets, triage summaries).

## Tier 3 - Chinese stays

Do not force English onto these; the cost is real and the benefit is zero.

- **Issue bodies written by reporters.** 27 of the 28 issues opened by
  non-maintainers are Chinese. Making English a requirement for filing does not
  make reporters bilingual, it makes them leave. See the intake recipe below.
- **End-user surfaces**: UI strings and `src/i18n/`, `README.md` + `README_EN.md`,
  `INSTALLATION_INSTRUCTIONS*.md`, `CHANGELOG.md` and the release notes
  `.github/workflows/tag-release.yml` generates (Chinese copy plus the English
  block it already writes). Localization is not even finished in-product, so a
  promise of all-English user docs would be hollow.
- **`GLOSSARY.md` domain entries** that name Chinese UI words (「记住目录」
  「全局免问」). The Chinese *is* the domain term; translating it makes the entry
  wrong. English `Definition` prose around a Chinese term is the right shape.
- **Existing Chinese docs under `docs/`**. No backfill. New docs default to
  English unless they are user-facing.
- **Chinese-language conversation** with a Chinese-speaking reporter in an issue
  thread, including the comment that reports a fix or closes the issue. The reporter
  is the reader of that thread, so a Chinese report gets a Chinese reply. A
  disposition *document* - triage summary, ADR, acceptance report - is still Tier 2
  English, and it quotes the thread rather than replacing it.

## Intake recipe: normalizing a Chinese report

The reporter keeps their words; the canonical record is English. When triaging a
Chinese issue, edit or comment so the thread reads:

```markdown
**Symptom**: on macOS ARM the app is reported as damaged and refuses to launch.

**Reproduction** (from #74): install 0.6.4 on Apple Silicon, open the app, no
Gatekeeper prompt appears.

> 原文（报告者原话，保留作证据）：
> macOS Arm版打不开，显示已损坏

**Environment**: macOS 14, Apple Silicon, Chatless 0.6.4
**Disposition**: ad-hoc signing added; keep open until verified on a new build.
```

Concretely: retitle in English (keep the `[BUG]` / `[FEATURE]` prefix), restate
the symptom and the steps in English, keep the original text verbatim in a block
quote, and write the triage conclusion in English. `gh issue edit <n> --title
"..." --body "..."` does both.

## Enforcement

`pnpm check:pr-title "<title>"` runs in CI on every pull request and rejects a
non-conventional or non-ASCII PR title - the PR list being the one surface the
owner reads at a glance. Anyone with write access can retitle a PR, so a Chinese
title from an honest contributor is a one-line correction, not a rejected
contribution. Should the gate ever cost more than it saves, loosen the gate rather
than defend it; the same goes for every other line on this page.

Everything else here is a writing habit, not a gate. This file is loaded through
`AGENTS.md`, so a session that is about to create an issue, a PR, or a commit has
the rule in front of it - which is the reason it lives here rather than in
`CONTRIBUTING.md`.
