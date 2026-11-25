# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `kamjin3086/chatless`.
Use the `gh` CLI for all operations; infer the repo from `git remote -v`, which `gh`
does itself inside a clone.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies).
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with the `--label` / `--state` filters you want.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or afterwards
  `gh issue edit <parent> --add-sub-issue <child>` (`gh` 2.94+; this host runs 2.97). On an older
  `gh`, post the link through the API:
  `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`.
  The database id - not the `#number`, not the `node_id` - comes from
  `gh api repos/<owner>/<repo>/issues/<n> --jq .id`. Where sub-issues are unavailable, add the
  child to a task list in the parent body and put `Part of #<parent>` at the top of the child.
- **Blocking**: GitHub's native issue dependencies, the UI-visible representation. Prefer the CLI
  flags (`gh issue create --blocked-by <n>`, `gh issue edit <n> --add-blocked-by <n>`), and fall
  back to `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by
  -F issue_id=<blocker-db-id>` on an older `gh`. GitHub reports
  `issue_dependencies_summary.blocked_by` (open blockers only - the live gate), and a ticket is
  unblocked when every blocker is closed.

When an issue and a PR share a number space, `#42` may be either: try
`gh pr view 42`, fall back to `gh issue view 42`.

**PRs as a request surface: no.** External PRs are not treated as feature requests, so
`/triage` reads this as `no` and does not walk pull requests through the label states.
(`gh pr view --comments`, `gh pr diff`, `gh pr comment`, `gh pr edit --add-label`,
`gh pr close` are the equivalents, if that ever changes.)

## Wayfinding operations

Never used in this repo: no issue carries a `wayfinder:*` label (`gh label list` returns zero
hits) and no `wayfinder:map` issue exists. Do not run these steps as written; if wayfinding is
ever adopted, create the labels first and re-run `/setup-matt-pocock-skills`, which regenerates
this section from its own template.

- **Map**: one issue labelled `wayfinder:map`, holding Notes / Decisions-so-far / Fog.
- **Child ticket**: a sub-issue of the map (above), labelled `wayfinder:<type>` -
  `research`, `prototype`, `grilling` or `task` - and assigned to the dev driving it.
- **Frontier query**: the map's open children, minus anything with an open blocker
  (`issue_dependencies_summary.blocked_by > 0`) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` - the session's first write.
- **Resolve**: comment the answer, close the ticket, then append the context pointer to the
  map's Decisions-so-far.

## When a skill says "publish to the issue tracker" / "fetch the ticket"

Create a GitHub issue; read it as in **Read an issue** above.
