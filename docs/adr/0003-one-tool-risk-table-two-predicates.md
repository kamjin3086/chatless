# One tool-risk table, two predicates, membership deliberately not widened

Four places in the tool execution path answered "is this tool read-only" with their own regex. They are not the same question: "may this run while planning" and "would replaying this add a side effect" happened to share a regex, and a third consumer derived the filesystem permission kind from a fourth list. We replaced all four with one explicit `server + tool → risk` table plus two derived predicates.

Membership was not widened while consolidating — the table is the union of what the old lists actually contained, nothing more. That matters because `filesystemOp` keeps its existing fail-open default of `read` for unrecognised tool names: names like `list_files` and `search_files` are therefore *not* in the table, so neither predicate lets them through. That looks like an oversight and is not one; registering them would silently make them plan-allowed and replayable.

Consequence: adding an fs tool name to the table is a security-relevant edit, not a cleanup. Two tool names differ only by whether they are registered.
