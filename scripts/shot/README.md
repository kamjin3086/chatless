# Looking at the app

Two scripts, because the alternative is writing them again in every session that touches the UI
(three times in one session, on 2026-10-20).

```bash
pnpm dev            # in one terminal; or `pnpm tauri dev` for the real window
pnpm shot           # capture the window -> %TEMP%\chatless-shot.png
pnpm shot -- -Out D:\tmp\settings.png -Width 1176 -Height 656
pnpm click -- -X 61 -Y 383      # click at a screen point (physical pixels)
pnpm click -- -X 800 -Y 400 -Wheel -360   # scroll, no click
```

`pnpm shot` prints one line: `FG=<bool> rect=<x>,<y> <w>x<h> SAVED: <path>`, and a warning when the
window could not be brought to the front. **Trust the warning**: a capture of an unfocused window
shows whatever was on top of it, which is how one session spent two rounds analysing a terminal.

## The two traps it encodes

- **`PrintWindow` captures nothing useful.** On a WebView2 window it returns the frame with a
  black content area, because the content is an accelerated layer. Capture the screen rect instead.
- **Coordinates are physical pixels.** PowerShell is not DPI-aware by default; at 125% scaling
  `GetWindowRect` reports 0.8x the true size and a click lands 20% short. Both scripts call
  `SetProcessDPIAware()` first, so the numbers they print and accept are the real ones.

## Sizing

`-Width`/`-Height` are physical pixels and default to 1470x820, which fits a 1536x864 display at
125%. Do not ask for a window bigger than the work area: the app's own presets can exceed it
(1024x768 logical is 1280x960 physical, against a 1228x691 logical work area here), and the
resulting off-screen edge reads as a layout bug that is not one. `-NoResize` leaves the window as
it is.

## What this cannot do

- Anything interactive beyond a point click: typing goes through `SendKeys`, which is fragile.
- Pixels inside the webview: no devtools and no CDP on this build, so a rendering question is
  answered by looking at the image, not by reading the DOM.
- Non-Windows hosts. These are PowerShell scripts; on Linux/Wayland the equivalent capture path
  produced black frames in an earlier session (see #155).
