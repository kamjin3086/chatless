//! Keep the main window inside the monitor's usable area.
//!
//! A size preset is logical pixels, and the window-state plugin restores a saved
//! size after only checking that *some* monitor intersects the saved rectangle.
//! Neither compares the rectangle to the work area (the desktop minus taskbar and
//! dock), so a window can open larger than the screen it lands on: at 125 %
//! scaling a 1536x864 display leaves 1228x691 logical, while the shipped default
//! preset is 1024x768. The right and bottom edges then sit off-screen, which
//! looks like a layout bug and puts the window buttons out of reach.
//!
//! Everything here is in physical pixels, and the outer rectangle is the one
//! that has to fit: a borderless window still carries an invisible resize border
//! (18x10 on Windows 11), so clamping the inner size alone leaves the content
//! edges off-screen by the width of that border.

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow};

/// A width and height in logical pixels - the units the size presets speak.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalExtent {
  pub width: f64,
  pub height: f64,
}

/// What a window ends up with after fitting, plus the area it was fitted into.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowFit {
  /// Inner size after the fit, in logical pixels.
  pub size: LogicalExtent,
  /// The display's usable area, in logical pixels.
  pub work_area: LogicalExtent,
}

fn logical_extent(size: PhysicalSize<u32>, scale: f64) -> LogicalExtent {
  LogicalExtent {
    width: size.width as f64 / scale,
    height: size.height as f64 / scale,
  }
}

/// The border and title bar: outer size minus inner size, which stays constant
/// across a resize.
fn frame_of(win: &WebviewWindow, inner: PhysicalSize<u32>) -> tauri::Result<PhysicalSize<u32>> {
  let outer = win.outer_size()?;
  Ok(PhysicalSize::new(
    outer.width.saturating_sub(inner.width),
    outer.height.saturating_sub(inner.height),
  ))
}

/// What the clamp decides: the size and position the window should have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FittedRect {
  size: PhysicalSize<u32>,
  position: PhysicalPosition<i32>,
}

/// Fit a window of inner `size` (plus `frame`) inside `area`, then pull
/// `position` far enough in that its whole outer rectangle lies inside. A window
/// larger than the area takes the area's size and origin.
fn fit_rect(
  size: PhysicalSize<u32>,
  frame: PhysicalSize<u32>,
  position: PhysicalPosition<i32>,
  area: PhysicalRect<i32, u32>,
) -> FittedRect {
  let bounds = area.size;
  let size = PhysicalSize::new(
    size.width.min(bounds.width.saturating_sub(frame.width)),
    size.height.min(bounds.height.saturating_sub(frame.height)),
  );
  let outer_width = size.width + frame.width;
  let outer_height = size.height + frame.height;
  let max_x = (area.position.x + bounds.width as i32 - outer_width as i32).max(area.position.x);
  let max_y = (area.position.y + bounds.height as i32 - outer_height as i32).max(area.position.y);
  FittedRect {
    size,
    position: PhysicalPosition::new(
      position.x.clamp(area.position.x, max_x),
      position.y.clamp(area.position.y, max_y),
    ),
  }
}

/// Move `fitted` onto the window; reports the inner size it now has.
fn apply(win: &WebviewWindow, fitted: FittedRect, current: PhysicalSize<u32>, position: PhysicalPosition<i32>) -> tauri::Result<PhysicalSize<u32>> {
  if fitted.size != current {
    win.set_size(fitted.size)?;
  }
  if fitted.position != position {
    win.set_position(fitted.position)?;
  }
  Ok(fitted.size)
}

/// Shrink and move the window so it fits the work area of the monitor it is on.
///
/// Used at startup, after the window-state plugin has restored a size that may
/// have been saved on a larger display.
pub fn fit_to_work_area(win: &WebviewWindow) -> tauri::Result<Option<PhysicalSize<u32>>> {
  // A maximized or fullscreen window already fits by construction, and resizing
  // it would fight the restored state.
  if win.is_maximized()? || win.is_fullscreen()? {
    return Ok(None);
  }
  let Some(monitor) = win.current_monitor()? else {
    return Ok(None);
  };
  let area = *monitor.work_area();
  if area.size.width == 0 || area.size.height == 0 {
    return Ok(None);
  }
  let inner = win.inner_size()?;
  let position = win.outer_position()?;
  let fitted = fit_rect(inner, frame_of(win, inner)?, position, area);
  apply(win, fitted, inner, position).map(Some)
}

/// Apply a size preset in physical pixels, clamped to the work area.
pub fn apply_size(
  win: &WebviewWindow,
  width: f64,
  height: f64,
) -> tauri::Result<Option<(PhysicalSize<u32>, PhysicalSize<u32>, f64)>> {
  let Some(monitor) = win.current_monitor()? else {
    return Ok(None);
  };
  let area = *monitor.work_area();
  if area.size.width == 0 || area.size.height == 0 {
    return Ok(None);
  }
  let scale = monitor.scale_factor();
  if scale <= 0.0 || !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
    return Ok(None);
  }
  let requested = PhysicalSize::new(
    (width * scale).round().max(1.0) as u32,
    (height * scale).round().max(1.0) as u32,
  );
  let inner = win.inner_size()?;
  let position = win.outer_position()?;
  let fitted = fit_rect(requested, frame_of(win, inner)?, position, area);
  apply(win, fitted, inner, position)?;
  Ok(Some((fitted.size, area.size, scale)))
}

/// Logical work area of the monitor the main window is on.
#[tauri::command]
pub fn window_work_area(app: AppHandle) -> Option<LogicalExtent> {
  let win = app.get_webview_window("main")?;
  let monitor = win.current_monitor().ok().flatten()?;
  let scale = monitor.scale_factor();
  if scale <= 0.0 {
    return None;
  }
  Some(logical_extent(monitor.work_area().size, scale))
}

/// Set the main window to `width`x`height` (logical pixels) and report the size
/// it actually took plus the area it had to fit into.
#[tauri::command]
pub fn apply_window_size(app: AppHandle, width: f64, height: f64) -> Option<WindowFit> {
  let win = app.get_webview_window("main")?;
  match apply_size(&win, width, height) {
    Ok(Some((size, area, scale))) => Some(WindowFit {
      size: logical_extent(size, scale),
      work_area: logical_extent(area, scale),
    }),
    Ok(None) => None,
    Err(err) => {
      log::warn!("applying the window size failed: {err}");
      None
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn area(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
    PhysicalRect {
      position: PhysicalPosition::new(x, y),
      size: PhysicalSize::new(width, height),
    }
  }

  /// The invisible resize border measured on Windows 11 for this window.
  fn frame() -> PhysicalSize<u32> {
    PhysicalSize::new(18, 10)
  }

  // A 1536x864 display at 125 % has a 1536x824 physical work area once the
  // taskbar is subtracted. The shipped 1024x768 preset is 1280x960 physical
  // there, so the bottom of the window lands below the taskbar (#169).
  #[test]
  fn shrinks_the_default_preset_to_the_reported_work_area() {
    let fitted = fit_rect(
      PhysicalSize::new(1280, 960),
      frame(),
      PhysicalPosition::new(0, 0),
      area(0, 0, 1536, 824),
    );
    assert_eq!(fitted.size, PhysicalSize::new(1280, 814));
    assert_eq!(fitted.position, PhysicalPosition::new(0, 0));
  }

  #[test]
  fn pulls_a_window_back_from_the_edges_it_overflowed() {
    let fitted = fit_rect(
      PhysicalSize::new(1280, 960),
      frame(),
      PhysicalPosition::new(400, 300),
      area(0, 0, 1536, 824),
    );
    assert_eq!(fitted.size, PhysicalSize::new(1280, 814));
    assert_eq!(fitted.position, PhysicalPosition::new(238, 0));
  }

  #[test]
  fn leaves_a_window_that_fits_alone() {
    let fitted = fit_rect(
      PhysicalSize::new(1280, 768),
      frame(),
      PhysicalPosition::new(100, 20),
      area(0, 0, 1536, 824),
    );
    assert_eq!(fitted.size, PhysicalSize::new(1280, 768));
    assert_eq!(fitted.position, PhysicalPosition::new(100, 20));
  }

  #[test]
  fn pulls_in_a_window_whose_frame_crosses_the_edge() {
    let fitted = fit_rect(
      PhysicalSize::new(1280, 768),
      frame(),
      PhysicalPosition::new(100, 50),
      area(0, 0, 1536, 824),
    );
    assert_eq!(fitted.size, PhysicalSize::new(1280, 768));
    assert_eq!(fitted.position, PhysicalPosition::new(100, 46));
  }

  #[test]
  fn keeps_a_window_on_a_monitor_left_of_the_primary() {
    let fitted = fit_rect(
      PhysicalSize::new(1600, 1000),
      frame(),
      PhysicalPosition::new(-2000, -50),
      area(-1920, 0, 1920, 1040),
    );
    assert_eq!(fitted.size, PhysicalSize::new(1600, 1000));
    assert_eq!(fitted.position, PhysicalPosition::new(-1920, 0));
  }

  #[test]
  fn an_area_smaller_than_the_window_wins() {
    let fitted = fit_rect(
      PhysicalSize::new(1200, 900),
      frame(),
      PhysicalPosition::new(10, 10),
      area(0, 0, 800, 600),
    );
    assert_eq!(fitted.size, PhysicalSize::new(782, 590));
    assert_eq!(fitted.position, PhysicalPosition::new(0, 0));
  }

  #[test]
  fn a_frame_wider_than_the_area_does_not_underflow() {
    let fitted = fit_rect(
      PhysicalSize::new(200, 200),
      PhysicalSize::new(900, 700),
      PhysicalPosition::new(0, 0),
      area(0, 0, 800, 600),
    );
    assert_eq!(fitted.size, PhysicalSize::new(0, 0));
    assert_eq!(fitted.position, PhysicalPosition::new(0, 0));
  }
}
