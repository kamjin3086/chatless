# One tool-risk table, two predicates, membership deliberately not widened

Three places in the pipeline answered "is this tool read-only" with their own per-server name regex - the approval decision, the plan-mode gate and the retry decision, all in `ToolExecutionPipeline.ts` - while a fourth derived the filesystem permission kind from the same tool names with an if-cascade. They are not the same question: "may this run while planning" and "would replaying this add a side effect" happened to share a regex. We replaced all four with one explicit `server + tool → risk` table plus two derived predicates.

Membership was not widened while consolidating — the table is the union of what the old lists actually contained, nothing more. That matters because `filesystemOp` keeps its existing fail-open default of `read` for unrecognised tool names: names like `list_files` and `search_files` are *not* registered under `fs`, so neither predicate lets an fs call through under those names (`list_files` is still registered where it always was, under `skill`). That looks like an oversight and is not one; registering them would silently make them plan-allowed and replayable.

Consequence: adding an fs tool name to the table is a security-relevant edit, not a cleanup. Whether a name is registered at all is what decides if plan mode lets it through - `fs`'s `read` is registered, `fs`'s `list_files` is not, and nothing about the two names hints at that difference.

Status: accepted. The table (`policy/toolRisk.ts`), `filesystemOp` and their oracle tests land with PR #85; the four cascades being replaced are what `main` runs today.
