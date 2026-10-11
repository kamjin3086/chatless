# Tool policy is pure; the pipeline owns every side effect

Approving a tool call means waiting for a human, and the trust they hand over has to be persisted — so the natural shape was a policy module that does the asking and the granting itself. We decided against it: `decide` and `promote` are pure functions that take a snapshot and return a decision or a state delta, while the pipeline reads the snapshot, waits for the user, and performs every store write, Tauri call and grant registration.

The alternative would have made the rules untestable without a live store, a database and a waiting user — which is exactly what the existing interface tests pay today with eight mocks. As written, the approval matrix and the promotion grid are table-driven tests with no mocks at all.
