import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthorizationStore } from '../authorizationStore';

const pending = (onApprove: (decision?: string) => void, onReject: () => void) => ({
  id: 'run:card',
  messageId: 'run',
  server: 'filesystem',
  tool: 'write_file',
  createdAt: Date.now(),
  onApprove,
  onReject,
});

describe('authorization store decisions', () => {
  beforeEach(() => {
    useAuthorizationStore.setState({ pendingAuthorizations: new Map() });
  });

  it('forwards the requested grant duration to the waiting call', () => {
    const onApprove = vi.fn();
    useAuthorizationStore.getState().addPendingAuthorization(pending(onApprove, vi.fn()) as never);

    expect(useAuthorizationStore.getState().approveAuthorization('run:card', 'session')).toBe(true);

    expect(onApprove).toHaveBeenCalledWith('session');
    expect(useAuthorizationStore.getState().hasPendingAuthorization('run:card')).toBe(false);
  });

  it('defaults to a one-off approval', () => {
    const onApprove = vi.fn();
    useAuthorizationStore.getState().addPendingAuthorization(pending(onApprove, vi.fn()) as never);

    useAuthorizationStore.getState().approveAuthorization('run:card');

    expect(onApprove).toHaveBeenCalledWith('once');
  });

  it('reports a stale approval instead of silently approving', () => {
    expect(useAuthorizationStore.getState().approveAuthorization('missing', 'always')).toBe(false);
  });
});
