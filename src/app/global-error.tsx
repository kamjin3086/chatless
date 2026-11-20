'use client';

import { useEffect } from 'react';
import { AppRecoveryView } from '@/components/errors/AppRecoveryView';
import { reportClientFailure } from '@/lib/dev/reportClientFailure';

export default function GlobalError({
  error,
}: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportClientFailure(error, 'render');
    console.error('[AppRecovery] The root layout failed', error);
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0 }}>
        <AppRecoveryView />
      </body>
    </html>
  );
}
