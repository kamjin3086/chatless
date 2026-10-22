'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocaleStore } from '@/store/localeStore';
import { RouteFailureView } from './RouteFailureView';
import {
  canReturnToChat,
  describeRouteFailure,
  shouldClearFailure,
} from './routeFailure';

interface BoundaryState {
  failed: boolean;
  error: unknown;
  componentStack: string | null;
}

interface BoundaryProps {
  children: ReactNode;
  /** A route change clears a failure in place instead of remounting the routed subtree. */
  resetKey: string;
}

/**
 * A render failure on a route must not take the window with it. The boundary sits around
 * routed content only: the app shell, the stores and an in-flight conversation are outside
 * it, so retrying or going back does not throw that state away.
 *
 * The error is shown, not swallowed: the fallback carries the route and the message, and
 * the boundary also writes the full error to the console for the developer.
 */
class RouteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {
    failed: false,
    error: null,
    componentStack: null,
  };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failed: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error(
      '[RouteErrorBoundary] route content failed to render',
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (
      shouldClearFailure(
        previous.resetKey,
        this.props.resetKey,
        this.state.failed,
      )
    ) {
      this.reset();
    }
  }

  private reset = (): void => {
    this.setState({ failed: false, error: null, componentStack: null });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <RouteFailureContainer
        error={this.state.error}
        componentStack={this.state.componentStack}
        onRetry={this.reset}
      />
    );
  }
}

export function RouteErrorBoundary({
  children,
  resetKey,
}: {
  children: ReactNode;
  /** Extra state that should clear a failure, e.g. the selected chat conversation. */
  resetKey?: string;
}) {
  const pathname = usePathname();
  // A route or conversation change clears a failure in place. Keeping the same boundary
  // (no key) lets Next preserve layouts such as the chat list instead of remounting the
  // routed subtree.
  return (
    <RouteBoundary resetKey={`${pathname}:${resetKey ?? ''}`}>
      {children}
    </RouteBoundary>
  );
}

function RouteFailureContainer({
  error,
  componentStack,
  onRetry,
}: {
  error: unknown;
  componentStack: string | null;
  onRetry: () => void;
}) {
  const t = useLocaleStore((state) => state.t);
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const details = describeRouteFailure(error, pathname, componentStack);
  const canGoBack = canReturnToChat(pathname);

  return (
    <RouteFailureView
      labels={{
        title: t('error.title'),
        description: t('error.description'),
        route: t('error.route'),
        details: t('error.details'),
        componentStack: t('error.componentStack'),
        unknown: t('error.unknown'),
        retry: t('error.retry'),
        backToChat: t('error.backToChat'),
      }}
      details={details}
      canGoBack={canGoBack}
      onRetry={onRetry}
      onBack={() => {
        // Do not reset the boundary first: that re-renders the failing route and can abort
        // the navigation before it commits. The pathname change clears the failure in
        // componentDidUpdate once the chat route is actually rendering.
        router.push('/chat');
      }}
    />
  );
}
