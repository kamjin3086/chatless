import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { PendingAuthorization } from '@/store/authorizationStore';
import { useConversationAccessStore } from '@/store/conversationAccessStore';
import { ToolCallCard } from '../ToolCallCard';

const { useAuthorizationStore } = await vi.importActual<
  typeof import('@/store/authorizationStore')
>('@/store/authorizationStore');
const { dispatchMessageAction, toast } = vi.hoisted(() => ({
  dispatchMessageAction: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn() },
}));
vi.mock('@/components/ui/sonner', () => ({ toast }));
let locale: Locale = 'zh';

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: Object.assign(
    (select: (state: { locale: Locale }) => Locale) => select({ locale }),
    { getState: () => ({ locale }) },
  ),
}));
vi.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ dispatchMessageAction }) },
}));
vi.mock('@/store/authorizationStore', async (importOriginal) => {
  const { useAuthorizationStore: store } =
    await importOriginal<typeof import('@/store/authorizationStore')>();
  // Static rendering reads the initial Zustand snapshot. Expose current state
  // so the card sees the same pending approval as a mounted client component.
  return {
    useAuthorizationStore: (
      select = (state: ReturnType<typeof store.getState>) => state,
    ) => select(store.getState()),
  };
});

const knowledge = {
  kind: 'tool',
  toolKey: 'knowledge:read',
  label: '知识库读取',
  automaticEligible: true,
} as const;
const directory = '/资料/$&';
const path = `${directory}/example.md`;
const filesystem = {
  kind: 'filesystem',
  op: 'write',
  path,
  directory,
} as const;

function pendingCard({
  server = 'knowledge',
  tool = 'search',
  scope,
  args,
}: Pick<PendingAuthorization, 'scope' | 'args'> &
  Partial<Pick<PendingAuthorization, 'server' | 'tool'>>) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  useAuthorizationStore.getState().addPendingAuthorization({
    id: 'run:card',
    messageId: 'run',
    conversationId: 'conversation',
    server,
    tool,
    args,
    createdAt: 1,
    scope,
    onApprove,
    onReject,
  });
  const card = createElement(ToolCallCard, {
    server,
    tool,
    args,
    status: 'pending_auth',
    messageId: 'run',
    cardId: 'card',
  });
  return { card, onApprove, onReject };
}

// Capture the rendered button's actual handler without replacing the card's React hooks.
function clickApprovalButton(card: React.ReactElement, label: string) {
  const create = vi.spyOn(React, 'createElement');
  try {
    renderToStaticMarkup(card);
    const call = create.mock.calls.find(
      ([type, , child]) => type === 'button' && child === label,
    );
    const handler = (call?.[1] as { onClick?: () => void } | undefined)
      ?.onClick;
    expect(handler, `handler for ${label}`).toBeTypeOf('function');
    handler?.();
  } finally {
    create.mockRestore();
  }
}

afterEach(() => {
  locale = 'zh';
  dispatchMessageAction.mockClear();
  toast.info.mockClear();
  toast.success.mockClear();
  useAuthorizationStore.setState({ pendingAuthorizations: new Map() });
  useConversationAccessStore.setState({ conversations: {}, revisions: {} });
});

it('localizes the Knowledge conversation grant and leaves approval markers unchanged', () => {
  const { card } = pendingCard({ scope: knowledge });
  const zh = renderToStaticMarkup(card);
  expect(zh).toContain('>仅本次</button>');
  expect(zh).toContain('本会话允许知识库读取；访问范围不变；可在聊天顶部撤销');
  expect(zh).toContain('>本会话允许知识库读取</button>');
  expect(zh).toContain('>拒绝</button>');

  locale = 'en';
  const en = renderToStaticMarkup(card);
  expect(en).toContain('>Allow once</button>');
  expect(en).toContain(
    '>Allow knowledge base reads in this conversation</button>',
  );
  expect(en).toContain(
    'Allow knowledge base reads in this conversation without changing its access scope',
  );
  expect(en).toContain('>Reject</button>');
  expect(en).toContain('data-approval-choice="once" data-approval-run="run"');
  expect(en).toContain(
    'data-approval-choice="conversation" data-approval-run="run"',
  );
  expect(en).not.toContain('知识库读取');
});

it('describes filesystem grants without changing the exact target or directory', () => {
  locale = 'en';
  const { card } = pendingCard({ scope: filesystem });
  const html = renderToStaticMarkup(card);
  expect(html).toContain(
    'title="Allow only this call: /资料/$&amp;/example.md"',
  );
  expect(html).toContain(
    '>Allow reads and writes in this folder for this conversation</button>',
  );
  expect(html).toContain(
    'Allow reading, writing, and creating in this folder only, not deleting. You can revoke this at the top of the chat.',
  );
  expect(html).toContain(
    'title="Add this folder to the allowlist (excluding deletion): /资料/$&amp;"',
  );
  expect(html).toContain('>Always allow</button>');
});

it('keeps filesystem deletion target-only and does not offer an always choice', () => {
  locale = 'en';
  const { card } = pendingCard({ scope: { ...filesystem, op: 'delete' } });
  const html = renderToStaticMarkup(card);
  expect(html).toContain(
    'title="Allow only this call: /资料/$&amp;/example.md"',
  );
  expect(html).toContain(
    '>Allow deleting this target in this conversation</button>',
  );
  expect(html).toContain('Remember only this deletion target');
  expect(html).not.toContain('>Always allow</button>');
});

it('distinguishes shell conversation approval from skipping prompts in every conversation', () => {
  locale = 'en';
  const rawCommand = 'echo 你好';
  const { card } = pendingCard({
    server: 'shell_executor',
    tool: 'execute',
    scope: { kind: 'shell', command: rawCommand },
    args: { workingDir: directory, command: rawCommand },
  });
  const html = renderToStaticMarkup(card);
  expect(html).toContain('title="Approving will remember this folder"');
  expect(html).toContain('>Allow commands in this conversation</button>');
  expect(html).toContain('Workspace and sandbox checks still apply');
  expect(html).toContain('>Always skip prompts</button>');
  expect(html).toContain('Stop asking for all commands in every conversation');
  expect(html).toContain(rawCommand);
});

it('leaves a third-party tool label unchanged in its localized grant description', () => {
  locale = 'en';
  const { card } = pendingCard({
    server: 'example',
    tool: 'lookup',
    scope: { kind: 'tool', label: '自定义.lookup$&', automaticEligible: true },
  });
  const html = renderToStaticMarkup(card);
  expect(html).toContain('>Allow this tool in this conversation</button>');
  expect(html).toContain(
    'Allow 自定义.lookup$&amp; in this conversation without changing its access scope',
  );
});

it('does not add a conversation choice to an ineligible tool or a scopeless approval', () => {
  locale = 'en';
  const restricted = renderToStaticMarkup(
    pendingCard({ scope: { kind: 'tool' } }).card,
  );
  expect(restricted).toContain('>Reject</button>');
  expect(restricted).not.toContain('data-approval-choice="conversation"');
  const scopeless = renderToStaticMarkup(pendingCard({}).card);
  expect(scopeless).toContain('title="Allow only this call"');
  expect(scopeless).toContain('>Cancel</button>');
  expect(scopeless).not.toContain('data-approval-choice="conversation"');
});

it.each([
  ['Allow once', 'once'],
  [
    'Allow reads and writes in this folder for this conversation',
    'unrestricted',
  ],
  ['Always allow', 'always'],
] as const)(
  'maps the localized %s button to the existing %s decision',
  (label, decision) => {
    locale = 'en';
    const { card, onApprove, onReject } = pendingCard({ scope: filesystem });
    clickApprovalButton(card, label);
    expect(onApprove).toHaveBeenCalledExactlyOnceWith(decision);
    expect(onReject).not.toHaveBeenCalled();
    expect(dispatchMessageAction).not.toHaveBeenCalled();
  },
);

it.each([
  [
    'Always allow',
    { scope: filesystem },
    'Folder added to the allowlist. Reads and writes no longer require approval.',
  ],
  [
    'Always skip prompts',
    {
      server: 'shell_executor',
      tool: 'execute',
      scope: { kind: 'shell', command: 'pwd' },
    },
    'Prompts for all commands are now disabled',
  ],
] as const)(
  'localizes the %s confirmation toast',
  (label, pending, feedback) => {
    locale = 'en';
    const { card, onApprove } = pendingCard(pending);
    clickApprovalButton(card, label);
    expect(onApprove).toHaveBeenCalledExactlyOnceWith('always');
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(feedback);
  },
);

it('revokes only the approved conversation and confirms in the current locale', () => {
  locale = 'en';
  const { card, onApprove } = pendingCard({ scope: knowledge });
  const { grantTool } = useConversationAccessStore.getState();
  grantTool('conversation', knowledge.toolKey);
  grantTool('other-conversation', knowledge.toolKey);

  clickApprovalButton(card, 'Allow knowledge base reads in this conversation');
  expect(onApprove).toHaveBeenCalledExactlyOnceWith('unrestricted');
  expect(toast.info).toHaveBeenCalledExactlyOnceWith(
    'Access for this conversation will apply once approval goes through',
    {
      action: {
        label: 'Revoke conversation access',
        onClick: expect.any(Function),
      },
    },
  );
  const action = toast.info.mock.calls[0][1].action;
  locale = 'zh';
  action.onClick();
  const { conversations } = useConversationAccessStore.getState();
  expect(conversations.conversation).toBeUndefined();
  expect(conversations['other-conversation'].tools).toEqual([
    knowledge.toolKey,
  ]);
  expect(toast.info).toHaveBeenLastCalledWith('已撤销本会话临时授权');
});

it('localizes the expired approval toast without dispatching a decision', () => {
  locale = 'en';
  const { card, onApprove, onReject } = pendingCard({ scope: filesystem });
  useAuthorizationStore.setState({ pendingAuthorizations: new Map() });
  clickApprovalButton(card, 'Allow once');
  expect(toast.info).toHaveBeenCalledExactlyOnceWith('Approval expired', {
    description: 'Select “Continue” to check permissions again.',
  });
  expect(onApprove).not.toHaveBeenCalled();
  expect(onReject).not.toHaveBeenCalled();
  expect(dispatchMessageAction).not.toHaveBeenCalled();
});

it('keeps the rejection dispatch and callback unchanged in English', () => {
  locale = 'en';
  const { card, onApprove, onReject } = pendingCard({ scope: knowledge });
  clickApprovalButton(card, 'Reject');
  expect(onReject).toHaveBeenCalledTimes(1);
  expect(onApprove).not.toHaveBeenCalled();
  expect(dispatchMessageAction).toHaveBeenCalledExactlyOnceWith('run', {
    type: 'TOOL_RESULT',
    server: 'knowledge',
    tool: 'search',
    ok: false,
    errorMessage: '用户拒绝',
    cardId: 'card',
  });
});
