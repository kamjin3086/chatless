# Tauri window pitfalls (macOS, learned the hard way in 0.7.0/0.7.1)

Three separate bugs in this release all came from touching the window from the
wrong place. Each one looked like "the app hangs" and none of them failed a
build, a type check, or a smoke test.

## 1. Never call a Tauri window accessor from `on_window_event`

`is_maximized`, `is_fullscreen`, `ns_window`, `is_decorated`, `is_minimized`, ...
post a message to Tauri's event loop and block until the reply arrives. A window
event callback *is* that event loop, so the reply can never be delivered: the
callback spins forever, the main thread never returns to `nextEventMatchingMask`,
the app pegs a core, and the frontend's IPC never completes, so the UI sits on
its first loading state forever.

On macOS ask AppKit directly instead (`isZoomed`, `NSWindowStyleMaskFullScreen`),
and hold the `NSWindow` pointer captured once in `setup` (see
`src-tauri/src/macos_window.rs`, `NS_WINDOW`).

## 2. Never query the window from inside a resize handler

`window.onResized(() => window.isMaximized())` looks harmless but is a feedback
loop on macOS: AppKit recomputes the zoom state while the resize is still being
delivered, and the query makes it emit another resize. Measured: **2101 resize
events in 6 seconds**, a pinned core, and a window that could not be closed,
resized or clicked (moving it still worked, because the window server moves
windows without the app). tao even carries an `is_checking_zoomed_in` flag for
this.

Defer the query out of the notification (a short timeout is enough) - see
`WindowTitleBar.tsx` and `appCleanup.ts`.

## 3. A restored "hidden" state produces an invisible app

`tauri-plugin-window-state` restores a saved `visible: false` regardless of the
configured `StateFlags`, so hiding the window to the tray and quitting left a
later launch running with no window at all. Show the window explicitly at
start-up (`lib.rs`) and do not persist the visible flag.

## Client-side exceptions in dev

Before reloading a failed window, copy the first `[dev-client-failure]` line from the
Tauri dev terminal or the app's `logs.log` (Linux: `$XDG_DATA_HOME/com.kamjin.chatless/logs`,
defaulting to `~/.local/share`). The frontend reports once per page load, including errors
caught by Chatless's route and shell boundaries. The line carries an error category, known
route and source positions when available, not error messages or a full stack. Existing
application logs are not sanitized by this reporter; do not share the entire file.

Check `agent-browser` compatibility with `pi-agent-browser-doctor` before a UI verification
batch. If unavailable, use an isolated browser/WebKit profile to verify routing, and keep the
actual Tauri window's diagnostic separate. A fresh browser succeeding does not explain a
crash seen in the existing desktop window. For an isolated dev server on another port,
point `next.config.ts`'s dev `assetPrefix` at that port in the scratch checkout as well;
HTTP 200 on the page is not proof that its JavaScript loaded from the same server.

To smoke-test capture, open a fresh dev page and run
`setTimeout(() => { throw new TypeError('recovery smoke marker'); }, 0)` in DevTools.
Expect one `[dev-client-failure]` line with the current route and `TypeError`, but no marker
text. Throw a second error without reloading and check that it does not emit a second line.
This checks capture, not native close IPC. To verify recovery separately, throw from the
custom title-bar component in a scratch checkout, then remove the throw before using Reload.

## Checking this class of bug

`scripts/verify-app-startup.sh` starts the built app and asserts that
initialisation *finishes* (MCP servers connect) and that CPU stays low at idle
**and after a window resize** - the last part is the one that catches the
resize-loop above. It needs Accessibility permission for the terminal; without
it the resize checks report SKIP instead of PASS.
