# "Always" stays one word with two meanings; the promotion grid is enumerated

An approval answer is `once`, `always` or `unrestricted`. `always` does something different per scope: for the filesystem it remembers the containing directory with everyday permissions (and refuses to remember anything for a delete), for the shell it turns prompts off globally and persistently. `unrestricted` is conversation-scoped for both. One word, two meanings, and a third meaning we declined to add.

We kept the overloaded word rather than splitting it into scope-specific answers, because renaming would reach UI copy and stored approval records for no behavioural gain. In exchange, `planFilesystemPromotion` and `planShellPromotion` enumerate all six cells of answer × scope explicitly — no default branch — so an extraction or an added answer cannot silently drop a cell. The grid is pinned by tests, including the delete exception.

Considered and rejected: scope-specific answer names (`remember-directory`, `allow-always`). Genuinely clearer, but it changes what the approval cards offer and what is already persisted in `agent_approvals`.
