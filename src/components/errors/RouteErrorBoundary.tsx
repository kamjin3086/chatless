'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLocaleStore } from '@/store/localeStore';
import { RouteFailureView } from './RouteFailureView';
import { canReturnToChat, describeRouteFailure } from './routeFailure';

interface BoundaryState {
  failed: boolean;
  error: unknown;
  componentStack: string | null;
}

/**
 * A render failure on a route must not take the window with it. The boundary sits around
 * routed content only: the app shell, the stores and an in-flight conversation are outside
 * it, so retrying or going back does not throw that state away.
 *
 * The error is shown, not swallowed: the fallback carries the route and the message, and
 * the boundary also writes the full error to the console for the developer.
 */
class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
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

  private reset = (): void => {
    this.setState({ failed: false, error: null, componentStack: null });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <RouteFailure
        error={this.state.error}
        componentStack={this.state.componentStack}
        onRetry={this.reset}
      />
    );
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // A route change remounts the boundary, so navigating away from a failed page cannot
  // leave the old failure surface in place. The conversation stores are module-level and
  // outside this subtree, so their state survives the remount.
  return <Boundary key={pathname}>{children}</Boundary>;
}

function RouteFailure({
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
      title={t('error.title')}
      description={t('error.description')}
      routeLabel={t('error.route')}
      detailsLabel={t('error.details')}
      retryLabel={t('error.retry')}
      backLabel={t('error.backToChat')}
      details={details}
      canGoBack={canGoBack}
      onRetry={onRetry}
      onBack={() => {
        // Do not reset the boundary first: that re-renders the failing route and can abort
        // the navigation before it commits. A route change remounts the keyed boundary,
        // which clears the failure once the chat route is actually rendered.
        router.push('/chat');
      }}
    />
  );
}
