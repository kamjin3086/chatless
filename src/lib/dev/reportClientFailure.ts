import { describeClientFailure } from './clientFailure';

let reported = false;

export function reportClientFailure(
  reason: unknown,
  kind: 'error' | 'rejection' | 'render',
) {
  if (
    process.env.NODE_ENV !== 'development' ||
    typeof window === 'undefined' ||
    reported
  )
    return;
  const details = describeClientFailure(reason, window.location.pathname, kind);
  reported = true;
  const line = `[dev-client-failure] ${JSON.stringify({ time: new Date().toISOString(), ...details })}`;
  console.info(line);
  if ('__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/plugin-log')
      .then(({ error }) => error(line))
      .catch(() => {});
  }
}
