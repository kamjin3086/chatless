# One tool-risk table, two predicates, membership deliberately not widened

Three places in the pipeline answered "is this tool read-only" with their own per-server name regex - the approval decision, the plan-mode gate and the retry decision, all in `ToolExecutionPipeline.ts` - while a fourth derived the filesystem permission kind from the same tool names with an if-cascade. They are not the same question: "may this run while planning" and "would replaying this add a side effect" happened to share a regex. We replaced all four with one explicit `server + tool → risk` table plus two derived predicates.

Membership was not widened while consolidating — the table is the union of what the old lists actually contained, nothing more. That matters because `filesystemOp` keeps its existing fail-open default of `read` for unrecognised tool names: names like `list_files` and `search_files` are *not* registered under `fs`, so neither predicate lets an fs call through under those names. That looks like an oversight and is not one; registering them would silently make them plan-allowed and replayable.

Consequence: adding an fs tool name to the table is a security-relevant edit, not a cleanup. Whether a name is registered at all is what decides if plan mode lets it through - `fs`'s `read` is registered, `fs`'s `list_files` is not, and nothing about the two names hints at that difference.

Status: accepted, and on `main` - the table (`policy/toolRisk.ts`), `filesystemOp` and their oracle tests shipped.

Amendment (skill aliases). `skill`'s row originally carried the alias names `use`, `read_file` and `list_files` because the adapter routed them. Those aliases had no caller and were deleted with the adapter branches, and the row narrowed with them: a name nothing routes must not stay plan-allowed. The oracle test now skips exactly these three names and a separate test owns the narrowing, so "the table equals the cascades it replaced" still holds for every name that can arrive.

Amendment (two real reads registered). `list_resources` and `get_template` were never in the row - only their old alias names were - while the skill index now actively tells the model to call them to read a file a guide points at. They read files inside the skill package and nothing else, so they are registered as reads: plan mode lets them through, and `skill` is still outside `REPLAYABLE_SERVERS`, so retry behaviour is unchanged. This is the widening the original decision warned about - a deliberate, named one, not a cleanup.

Amendment (retired names are display history). A conversation recorded while `skill__use` and its siblings were routable replays a name the tool set no longer has, and its stored result is already in the message: the card says the tool was removed (#236), and no live path routes these names, so display tolerance does not re-open the door this ADR closed.
