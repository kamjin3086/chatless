import { beforeEach, expect, it, vi } from 'vitest';
import { waitForCallApproval } from '../approvalWait';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { useConversationAccessStore } from '@/store/conversationAccessStore';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        executeTransaction: async (
          work: (tx: { execute: typeof mocks.execute }) => Promise<unknown>,
        ) => work({ execute: mocks.execute }),
      }),
    }),
  },
}));
beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue({});
  useAuthorizationStore.setState({ pendingAuthorizations: new Map() });
  useConversationAccessStore.setState({ conversations: {}, revisions: {} });
});
function wait(eligible = true) {
  return waitForCallApproval({
    id: 'approval',
    runId: 'run',
    conversationId: 'conversation',
    server: 'knowledge',
    tool: 'read',
    args: {},
    approvalScope: {
      kind: eligible ? 'tool' : 'filesystem',
      automaticEligible: eligible,
    },
  });
}
async function pending() {
  await vi.waitFor(() =>
    expect(
      useAuthorizationStore.getState().hasPendingAuthorization('approval'),
    ).toBe(true),
  );
}
it('enabling automatic mode releases a pending eligible call through durable approval', async () => {
  const result = wait();
  await pending();
  useConversationAccessStore.getState().setAutomatic('other', true);
  expect(
    useAuthorizationStore.getState().hasPendingAuthorization('approval'),
  ).toBe(true);
  useConversationAccessStore.getState().setAutomatic('conversation', true);
  await expect(result).resolves.toMatchObject({
    approved: true,
    decision: 'once',
  });
  expect(
    mocks.execute.mock.calls.some(([sql]) =>
      sql.includes('UPDATE agent_approvals'),
    ),
  ).toBe(true);
});
it('does not automatically authorize a pending filesystem scope expansion', async () => {
  const result = wait(false);
  await pending();
  useConversationAccessStore.getState().setAutomatic('conversation', true);
  expect(
    useAuthorizationStore.getState().hasPendingAuthorization('approval'),
  ).toBe(true);
  useAuthorizationStore.getState().rejectAuthorization('approval');
  await expect(result).resolves.toMatchObject({
    approved: false,
    decision: 'once',
  });
});
it('does not report approval when persisting the decision fails', async () => {
  const result = wait();
  await pending();
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith('UPDATE agent_approvals'))
      throw new Error('disk failure');
    return {};
  });
  useConversationAccessStore.getState().setAutomatic('conversation', true);
  await expect(result).resolves.toMatchObject({
    approved: false,
    decision: 'once',
  });
});
it('cancellation wins and removes automatic-mode listeners', async () => {
  const result = wait();
  await pending();
  useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
  await expect(result).resolves.toMatchObject({
    approved: false,
    decision: 'once',
  });
  const count = mocks.execute.mock.calls.length;
  useConversationAccessStore.getState().setAutomatic('conversation', true);
  expect(mocks.execute).toHaveBeenCalledTimes(count);
});
it('a delayed decision cannot restore trust revoked while persistence was in flight', async () => {
  const result = wait();
  await pending();
  let release: (() => void) | undefined;
  mocks.execute.mockImplementation(async (sql: string) => {
    if (!sql.startsWith('UPDATE agent_approvals')) return {};
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  useAuthorizationStore
    .getState()
    .approveAuthorization('approval', 'unrestricted');
  await vi.waitFor(() => expect(release).toBeDefined());
  useConversationAccessStore.getState().revoke('conversation');
  release?.();
  const approved = await result;
  expect(approved.approved).toBe(true);
  useConversationAccessStore
    .getState()
    .grantTool('conversation', 'knowledge:read', approved.revision);
  expect(
    useConversationAccessStore.getState().conversations.conversation,
  ).toBeUndefined();
});
