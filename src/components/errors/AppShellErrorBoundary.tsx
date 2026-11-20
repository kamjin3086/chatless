'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppRecoveryView } from './AppRecoveryView';

export class AppShellErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[AppShell] The application shell failed to render',
      error,
      info.componentStack,
    );
  }

  render() {
    return this.state.failed ? <AppRecoveryView /> : this.props.children;
  }
}
