# Open issue / PR triage — 2026-09-30

Baseline: `main` at `949ecaa`; latest published release: `v0.6.4`.
Scope: all seven open issues and the one existing open PR. Mobile and broader
localization remain backlog items by maintainer decision. No release was created.

| Item | Evidence and disposition |
| --- | --- |
| [#14 Localization](https://github.com/kamjin3086/chatless/issues/14) | The tree has a small zh-CN/en-US translation layer, but substantial UI remains hard-coded. Keep open as backlog; do not claim complete localization. |
| [#63 Knowledge Q&A / long filenames](https://github.com/kamjin3086/chatless/issues/63) | Main replaces the legacy Q&A generator with an Agent launcher. AddDocumentsDialog now uses min-width constraints, truncation and full-name tooltips; safe filename tests pass. These changes are absent from the published v0.6.4. Keep open pending a new release and reporter verification. |
| [#68 MCP text / scrolling / portable / tray](https://github.com/kamjin3086/chatless/issues/68) | Main has a revised native tool stream, thinking-channel tests, streaming flush and scroll-follow logic, plus a minimize-to-tray preference. This does not prove the reported intermittent behavior fixed. Request exact leaked text, provider/model and a scroll reproduction on the new build. Portable ZIP and close-to-tray remain separate product decisions. |
| [#70 vLLM tables](https://github.com/kamjin3086/chatless/issues/70) | Main preserves Streamdown default remark plugins, including GFM, through toRemarkPluginList; this module does not exist in v0.6.4. Three plugin-shape regression tests pass. Ask for the raw Markdown if a new build still fails; a screenshot cannot distinguish malformed Markdown from a renderer bug. Keep open pending release verification. |
| [#71 Knowledge deletion / Q&A / tray](https://github.com/kamjin3086/chatless/issues/71) | Main deletes knowledge relationships without deleting shared document chunks and replaces the old Q&A screen. This maintenance branch also prevents false deletion-success feedback when no row was removed. Windows 10 LTSC 1809 reproduction remains unverified; retain the issue until a new build is tested. Close-to-tray is distinct from the existing minimize-to-tray setting. |
| [#72 Mobile](https://github.com/kamjin3086/chatless/issues/72) | Keep open as a planned-scope discussion. No Android/iOS implementation or release commitment this round. |
| [#74 macOS ARM launch](https://github.com/kamjin3086/chatless/issues/74) | Add Tauri ad-hoc signing and block artifact upload when deep/strict signature validation fails. No Apple certificate or notarization is configured. Gatekeeper restrictions can remain; validate on macOS and a newly built artifact before closing. |

## PR #73 review

Reviewed head `fa8a7a957c2d9938dc0cb7f5643126ae938a6d9a` by static inspection;
GitHub reports conflicts with main. The PR author's reported test results are not
independent verification on current main. Do not merge this head.

1. **P1 — Saved credentials do not reach inference.** The connect panel writes
   `orcarouter_credential` / `orcarouter-oauth_credential` records. ProviderSettings
   discards the callback's CredentialResult and only invokes onDefaultApiKeyBlur.
   OrcaRouterProvider inherits BaseProvider.getApiKey, which reads KeyManager
   provider/model keys, not those records. A successful panel login can therefore
   still yield NO_KEY in actual chat. Wire one credential source through save,
   lookup, logout and inference; test the real settings-to-provider path.
2. **P1 — Authentication failure handling is disconnected and wrongly scoped.**
   fetchOrcaCatalog's 401 message omits `HTTP 401`, but OrcaRouterProvider tests that
   exact substring, so its reauthentication branch is never taken. If reached,
   markCredentialNeedsReauth reads and marks both provider records using their
   current generation, not the rejected request's generation. Use a typed status
   and capture the exact identity/generation when sending the request; test an
   old failing request after reauthorization and independent API/OAuth accounts.
3. **P2 — Model selector does not subscribe to catalog updates.** It reads the
   Zustand store via getState() inside memoized callbacks; asynchronous load does
   not trigger a React render or invalidate visibleProviders. Subscribe to the
   relevant catalog entry and test an open dropdown during delayed discovery.
4. **P2 — Catalog cache crosses account/origin boundaries.** The cache key contains
   only capability/modalities, and ModelSelector selects the first Orca provider.
   Both API/OAuth entries can receive that account's cached catalog. Include
   provider identity, origin and credential generation in cache scope without
   exposing raw keys; discard stale responses after identity changes.

The maintainer must still decide whether to accept a dedicated OrcaRouter OAuth
integration or request a smaller ordinary API-key provider contribution.

## Validation

- 72 test files, 350 tests passed after isolating the browser-fetch fallback in
  nativeToolStreams.test.ts. Previously the test reached the real network and
  timed out; no production transport behavior was changed by this test fix.
- `pnpm typecheck` and `pnpm lint:ci` passed.
- Release workflow YAML and macOS configuration JSON parsed successfully.
- macOS codesign/Gatekeeper, Windows LTSC 1809 and interactive intermittent
  scrolling have not been reproduced or verified in this Windows-only check.
