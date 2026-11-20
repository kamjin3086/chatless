'use client';

import { useEffect } from 'react';
import { AppRecoveryView } from '@/components/errors/AppRecoveryView';

export default function GlobalError({
  error,
}: { error: Error & { digest?: string } }) {
  useEffect(() => {
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
