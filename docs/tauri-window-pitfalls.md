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

## Checking this class of bug

`scripts/verify-app-startup.sh` starts the built app and asserts that
initialisation *finishes* (MCP servers connect) and that CPU stays low at idle
**and after a window resize** - the last part is the one that catches the
resize-loop above. It needs Accessibility permission for the terminal; without
it the resize checks report SKIP instead of PASS.
