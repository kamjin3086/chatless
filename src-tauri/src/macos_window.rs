//! Native macOS window shaping.
//!
//! The app asks for a borderless window (`decorations: false`). On macOS that
//! means `NSWindowStyleMaskBorderless`, for which the system draws neither
//! corners nor a window background, and Tauri's `transparent` flag is not
//! enough on its own:
//!
//! * Tauri/tao only sets a *clear* window background when the window config has
//!   no `backgroundColor`. Ours sets one (it keeps the first frame from flashing
//!   white on Windows), so tao ends up painting an opaque colour behind the
//!   webview and the corners stay solid.
//! * Even with a see-through window, the corners have to be clipped; CSS
//!   rounding of the document is not dependable in WKWebView, so the radius is
//!   also applied to the window's content view layer - the native, composited
//!   path that clips the webview no matter what it paints.
//!
//! Both are done here, on macOS only, so the other platforms are untouched.

// The `objc` macros expand to `cfg(feature = "cargo-clippy")`, which rustc >= 1.80
// reports as an unexpected cfg condition.
#![allow(unexpected_cfgs)]

use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use std::ffi::c_void;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{Runtime, Window};

/// The window, captured once in `setup`.
///
/// Deliberately *not* looked up again later: every Tauri window accessor posts a
/// message to the event loop and waits for the reply, and `sync_corner_radius`
/// runs *from* that loop, where the reply can never arrive - an endless
/// user-message loop that pins a core and starves the window (and the frontend's
/// IPC) until nothing responds. Holding the pointer keeps that path call-free.
///
/// The price of not asking: the pointer is only valid while the window lives, so
/// `forget_window` has to clear it once the window is destroyed.
static NS_WINDOW: AtomicUsize = AtomicUsize::new(0);

/// Which window `NS_WINDOW` belongs to, so a `Destroyed` event for some other window cannot
/// clear a handle that is still in use. `None` while nothing is cached.
static NS_WINDOW_LABEL: Mutex<Option<String>> = Mutex::new(None);

/// Corner radius in points, matching `--window-radius` in
/// `src/styles/globals.css` (keep the two in sync). Close to a native macOS
/// window, deliberately not over-rounded.
pub const CORNER_RADIUS: f64 = 10.0;

/// The pieces of a Tauri window handle this module needs, implemented for both
/// handle types Tauri hands out. Only ever used from `setup`, where asking Tauri
/// for the window is safe.
pub trait NativeWindow {
  fn ns_handle(&self) -> tauri::Result<*mut c_void>;
}

impl<R: Runtime> NativeWindow for Window<R> {
  fn ns_handle(&self) -> tauri::Result<*mut c_void> {
    self.ns_window()
  }
}

impl<R: Runtime> NativeWindow for tauri::WebviewWindow<R> {
  fn ns_handle(&self) -> tauri::Result<*mut c_void> {
    self.ns_window()
  }
}

/// NSWindowStyleMaskFullScreen.
const NS_WINDOW_STYLE_MASK_FULL_SCREEN: usize = 1 << 14;

/// Whether the window fills the screen, read straight from AppKit.
///
/// This runs from `on_window_event`, i.e. while Tauri is already inside its
/// event loop, so it must not call back into Tauri: `is_maximized` /
/// `is_fullscreen` post a message to that same loop and wait for the reply,
/// which the loop cannot deliver while it is still running this callback.
unsafe fn fills_screen(ns_window: *mut Object) -> bool {
  let zoomed: bool = msg_send![ns_window, isZoomed];
  let mask: usize = msg_send![ns_window, styleMask];
  zoomed || (mask & NS_WINDOW_STYLE_MASK_FULL_SCREEN) != 0
}

/// Raw `NSWindow`, or `None` when it is not available (yet).
fn to_ptr(handle: tauri::Result<*mut c_void>) -> Option<*mut Object> {
  match handle {
    Ok(ptr) if !ptr.is_null() => Some(ptr.cast::<Object>()),
    _ => None,
  }
}

fn background_alpha(ns_window: *mut Object) -> f64 {
  unsafe {
    let color: *mut Object = msg_send![ns_window, backgroundColor];
    if color.is_null() {
      -1.0
    } else {
      let alpha: f64 = msg_send![color, alphaComponent];
      alpha
    }
  }
}

/// Clip everything the window draws (i.e. the webview) to `radius` corners.
/// Returns the radius and clip flag actually in effect, for the log.
unsafe fn round_content_view(ns_window: *mut Object, radius: f64) -> (f64, bool) {
  let content_view: *mut Object = msg_send![ns_window, contentView];
  if content_view.is_null() {
    return (-1.0, false);
  }

  let mut layer: *mut Object = msg_send![content_view, layer];
  if layer.is_null() {
    // Not layer-backed yet: ask AppKit for one, then retry.
    let _: () = msg_send![content_view, setWantsLayer: true];
    layer = msg_send![content_view, layer];
    if layer.is_null() {
      return (-1.0, false);
    }
  }

  let _: () = msg_send![layer, setCornerRadius: radius];
  let _: () = msg_send![layer, setMasksToBounds: true];

  let applied: f64 = msg_send![layer, cornerRadius];
  let clipped: bool = msg_send![layer, masksToBounds];
  (applied, clipped)
}

/// Make the window see-through and round its corners. Called once, after the
/// window exists (see `setup` in lib.rs), with the label the handle is cached under.
pub fn apply<W: NativeWindow>(window: &W, label: &str) {
  let handle = to_ptr(window.ns_handle());
  let pointer = handle.unwrap_or(std::ptr::null_mut());
  NS_WINDOW.store(pointer as usize, Ordering::Release);
  if let Ok(mut cached) = NS_WINDOW_LABEL.lock() {
    *cached = (!pointer.is_null()).then(|| label.to_string());
  }
  apply_raw(handle);
}

/// Drop the cached handle when its window is destroyed.
///
/// `sync_corner_radius` runs from inside a window event callback and stays call-free on
/// purpose (see `NS_WINDOW`), so it cannot ask Tauri whether the window still exists. A
/// resize delivered after the `NSWindow` is released would otherwise message a freed
/// object: a use-after-free instead of a no-op.
pub fn forget_window(label: &str) {
  if let Ok(mut cached) = NS_WINDOW_LABEL.lock() {
    if cached.as_deref() == Some(label) {
      NS_WINDOW.store(0, Ordering::Release);
      *cached = None;
    }
  }
}

fn apply_raw(ns_window: Option<*mut Object>) {
  let Some(ns_window) = ns_window else {
    log::warn!("[window] macOS: no NSWindow handle yet, skipping transparency and corners");
    return;
  };

  let opaque_before: bool = unsafe { msg_send![ns_window, isOpaque] };
  let alpha_before = background_alpha(ns_window);

  let (radius, clipped) = unsafe {
    let clear: *mut Object = msg_send![class!(NSColor), clearColor];
    let _: () = msg_send![ns_window, setOpaque: false];
    let _: () = msg_send![ns_window, setBackgroundColor: clear];
    round_content_view(ns_window, CORNER_RADIUS)
  };

  let opaque_after: bool = unsafe { msg_send![ns_window, isOpaque] };
  let alpha_after = background_alpha(ns_window);
  log::info!(
    "[window] macOS window: opaque {opaque_before} -> {opaque_after}, background alpha \
     {alpha_before:.2} -> {alpha_after:.2}, corner radius {radius} (clipped: {clipped})"
  );
}

/// Keep the corners square while the window fills the screen (maximized or
/// fullscreen), where a radius would only cut slivers out of the display edges.
///
/// Takes no window handle on purpose: this runs on every resize, i.e. from
/// inside a window event callback, and must not touch Tauri (see `NS_WINDOW`).
/// Cheap and idempotent.
pub fn sync_corner_radius() {
  let cached = NS_WINDOW.load(Ordering::Acquire);
  if cached == 0 {
    return;
  }
  let ns_window = cached as *mut Object;
  let filling = unsafe { fills_screen(ns_window) };
  log::debug!("[window] resize event (filling={filling})");

  let radius = if filling { 0.0 } else { CORNER_RADIUS };

  unsafe {
    let content_view: *mut Object = msg_send![ns_window, contentView];
    if content_view.is_null() {
      return;
    }
    let layer: *mut Object = msg_send![content_view, layer];
    if layer.is_null() {
      round_content_view(ns_window, radius);
      return;
    }
    let current: f64 = msg_send![layer, cornerRadius];
    if (current - radius).abs() < 0.5 {
      return;
    }
    let _: () = msg_send![layer, setCornerRadius: radius];
    log::info!("[window] macOS corner radius -> {radius} (filling screen: {filling})");
  }
}
