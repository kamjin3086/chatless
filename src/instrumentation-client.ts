import { reportClientFailure } from '@/lib/dev/reportClientFailure';

if (process.env.NODE_ENV === 'development') {
  window.addEventListener(
    'error',
    (event) => {
      if (event.error != null) reportClientFailure(event.error, 'error');
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) =>
    reportClientFailure(event.reason, 'rejection'),
  );
}
