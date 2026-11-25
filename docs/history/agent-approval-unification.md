# Conversation approval unification

> **Archived.** One round of work, kept as the record of what was decided and what was
> measured then - not current status. For how the code works today, read
> `docs/agents/subsystems.md`; for what is still open, the issue tracker.


## Admission and scope

This is Core permission/approval UX for everyday Knowledge and agent users. It
improves local control and practical automation without a new runtime, dependency,
or OS permission default. MCP/Skills cannot own the application's approval queue,
so this must extend the existing pipeline, ToolCard and authorization store.

Temporary state is memory-only and conversation-scoped; no new startup I/O or
background service is introduced. Success means one Knowledge read grant covers
list/search/read across turns in that conversation, another conversation still
asks, revocation affects subsequent calls, and explicit automatic mode does not
silently grant new filesystem ranges. Maintainers own policy/store regressions,
pipeline integration, approval persistence/cancellation tests and bounded UI checks.
Cross-platform filesystem containment uses the existing allowlist path utility.

## Contract

- Keep current default and persisted server settings. Offer once and conversation
  choices on eligible approval cards; Knowledge groups only its three read tools.
  Administrative and patch operations that require explicit approval keep it.
- Other server grants cover the exact server/tool, not arbitrary future tools.
- Filesystem session grants cover the approved directory and everyday operations;
  delete permission is exact-target unless an existing allowlist authorizes more.
- Automatic mode is explicit, visible and revocable, applying to enabled tools
  within existing scope. Filesystem scope prompts (including deletion) still
  require authorization, and mandatory administrative prompts remain.
  Knowledge mounting, workspace validation, capability projection, sandbox limits,
  cancellation and approval persistence are not bypassed.
- Session grants do not persist across app restart/reload. Modes and grants never
  leak between conversations. Enabling automatic mode can release an already
  pending *eligible* tool approval, but cannot approve a new filesystem scope.
- Reuse the existing call-scoped backend grant mechanism; do not add default
  filesystem/HTTP/opener permissions or another approval engine.

## Verification

- `pnpm verify` passed in an isolated snapshot (1144 tests passed, 6 skipped).
  The snapshot's changed executable/test/replay files matched the working tree.
- A Linux desktop with the retained test profile and real Qwen verified one
  Knowledge grant covering actual search and read, and reload clearing that
  grant. A separate live run enabled automatic mode while an approval was pending,
  verified the next turn had no approval records, then revoked it and verified
  per-call approvals returned.
- The full Knowledge replay was attempted with `CHATLESS_KB_APPROVAL_CHOICE=conversation`
  but stopped at a WebDriver element-not-interactable error. A later repeated
  question produced a model answer with no tool calls; it is not counted as a
  test of approvals. The focused live checks above exercised real tool calls.
- Existing uncommitted ResourceUploader repair remains separate.
