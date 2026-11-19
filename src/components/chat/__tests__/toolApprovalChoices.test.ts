import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ToolCallCard } from '../ToolCallCard';
const { useAuthorizationStore } = await vi.importActual<
  typeof import('@/store/authorizationStore')
>('@/store/authorizationStore');

vi.stubGlobal('React', React);
vi.mock('@/store/authorizationStore', async (importOriginal) => {
  const { useAuthorizationStore: store } =
    await importOriginal<typeof import('@/store/authorizationStore')>();
  // Static rendering reads the initial Zustand snapshot. Expose current state
  // so the card sees the same pending approval as a mounted client component.
  return {
    useAuthorizationStore: (
      select = (state: ReturnType<typeof store.getState>) => state,
    ) => select(store.getState()),
    store,
  };
});
it('offers a Knowledge conversation grant instead of only confirm/cancel', () => {
  useAuthorizationStore.getState().addPendingAuthorization({
    id: 'run:card',
    messageId: 'run',
    conversationId: 'conversation',
    server: 'knowledge',
    tool: 'search',
    createdAt: 1,
    scope: {
      kind: 'tool',
      toolKey: 'knowledge:read',
      label: '知识库读取',
      automaticEligible: true,
    },
    onApprove: vi.fn(),
    onReject: vi.fn(),
  });
  const html = renderToStaticMarkup(
    createElement(ToolCallCard, {
      server: 'knowledge',
      tool: 'search',
      status: 'pending_auth',
      messageId: 'run',
      cardId: 'card',
    }),
  );
  expect(html).toContain('仅本次');
  expect(html).toContain('本会话允许知识库读取');
  expect(html).toContain('拒绝');
});
