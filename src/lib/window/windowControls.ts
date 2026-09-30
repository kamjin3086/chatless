/** macOS traffic lights sit on the left; Windows/Linux caption buttons sit on the right. */
export function windowControlsOnLeft(platform: string): boolean {
  const p = platform.trim().toLowerCase();
  return p === 'macos' || p === 'darwin' || p === 'osx';
}
