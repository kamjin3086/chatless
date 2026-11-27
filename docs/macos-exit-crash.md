# macOS: every quit used to end in "Chatless quit unexpectedly"

Closing the window with its X quit the app with everything saved, and macOS still reported a
crash - once per quit, each with its own report:

```console
$ ls -t ~/Library/Logs/DiagnosticReports | grep -i chatless
chatless-2026-11-27-143706.ips
chatless-2026-11-27-141525.ips
```

Started from a terminal, the process aborts instead of exiting and prints the reason itself:

```console
$ /Applications/Chatless.app/Contents/MacOS/chatless; echo "exit=$?"
[...] [INFO] [ORT] Background init succeeded
libc++abi: terminating due to uncaught exception of type std::__1::system_error: mutex lock failed: Invalid argument
[1]    81102 abort      /Applications/Chatless.app/Contents/MacOS/chatless
exit=134
```

`134` is `128 + 6`, i.e. `SIGABRT`.

## Why

ONNX Runtime is loaded at run time - `ort` with its `load-dynamic` feature - and it is never
unloaded: `ort` parks the `libloading::Library` in a `OnceLock`, so the dylib stays mapped
until the process is torn down. When `main` returns, `exit()` reaches `__cxa_finalize`, which
runs that runtime's C++ static destructors while its own threads are still locking what the
destructors destroy. Locking a destroyed `std::mutex` makes libc++ throw `std::system_error`,
and a C++ exception crossing Rust frames becomes `std::terminate`. Everything the user cares
about is already on disk by then, because `cleanup()` in `src/lib/services/appCleanup.ts`
closes the SSE stream, the database and the ONNX sessions before the window is destroyed - so
the abort reads as a clean quit and only the dialog gives it away.

## The rule: leave through the event loop, then through the syscall

`src-tauri/src/lib.rs` builds the app and runs it with a `RunEvent` callback.

- **Wait for `RunEvent::Exit`.** It fires for every way out: the last window closing, the
  dock's Quit (⌘Q), and `AppHandle::exit` (the tray's Quit). `RunEvent::ExitRequested` does
  not fire for ⌘Q - tao's macOS application delegate turns terminate into `LoopDestroyed`,
  which the runtime reports as `Exit` - so shutdown keyed on `ExitRequested` misses it.
- **Call `cleanup_before_exit()` first, on that same thread.** It flushes the settings stores
  (the store plugin only saves a pending auto-save from its drop) and drops the tray icon, and
  macOS wants both on the main thread. It also cannot re-enter Tauri the way a window callback
  can: this is the event loop's own last act, not a message posted to it.
- **Then `libc::_exit`.** No `__cxa_finalize`, so no C++ destructor runs and the runtime's
  threads simply stop existing.

Anything that must reach disk has to be written before that call: `_exit` runs no `atexit`
handler and flushes no buffer. The callback flushes stdout and stderr and logs `[app] exiting`
first, so the log file still ends where the process did.

Two things must not take the fast path:

- **A restart.** `RunEvent::ExitRequested` carrying `tauri::RESTART_EXIT_CODE` means the
  updater or the About page asked to relaunch, and Tauri re-executes the process itself. The
  callback records that in `RESTARTING` and leaves it to Tauri.
- **`std::process::exit` from a command.** The `exit` command the tray's Quit calls used to do
  exactly that, which is why that path never reached `RunEvent::Exit` at all; it asks the loop
  to stop with `AppHandle::exit` now.

## Checking it

`backend-check` in `.github/workflows/ci.yml` runs `cd src-tauri && cargo check` on
ubuntu-22.04, and the vitest suites never close a window, so nothing in CI exercises this. On
a Mac: start `Chatless.app/Contents/MacOS/chatless` from a terminal, close it with the X, and
expect `exit=0`, no `libc++abi:` line, and no new file in `~/Library/Logs/DiagnosticReports`.
Then ⌘Q, then the About page's restart - which has to relaunch, not merely quit.
