import React, { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { PendingSkillAction } from '@/lib/skills/types';
import { SkillApprovalPanel } from '../SkillApprovalPanel';

const { localeState, pendingActions } = vi.hoisted(() => ({
  localeState: { locale: 'zh' as Locale },
  pendingActions: [] as Pick<
    PendingSkillAction,
    | 'id'
    | 'skillId'
    | 'skillName'
    | 'action'
    | 'resolvedCommand'
    | 'resolvedArgs'
  >[],
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => Locale) =>
    select(localeState),
}));
vi.mock('@/store/skillAuthStore', async (importOriginal) => {
  const auth = await importOriginal<typeof import('@/store/skillAuthStore')>();
  return {
    ...auth,
    useSkillAuthStore: () => ({
      ...auth.useSkillAuthStore.getState(),
      getAllPendingActions: () => pendingActions,
    }),
  };
});
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.stubGlobal('React', React);

const pending = {
  id: 'action-1',
  skillId: 'read-skill',
  skillName: '本地索引助手',
  action: {
    id: 'read',
    type: 'script',
    name: '读取索引',
    description: '原有说明',
    command: 'original_command',
    workingDir: '/workspace/$&/资料',
    riskLevel: 'low',
    scriptContent: 'print("资料")',
  },
  resolvedCommand: 'read_index',
  resolvedArgs: ['资料.txt'],
} satisfies (typeof pendingActions)[number];

test.each([
  [
    'en',
    [
      'Actions awaiting approval',
      'Approve all',
      'Reject all',
      '1 more action awaiting approval',
      'This action needs your confirmation',
      'Edit command',
      'Confirm and run',
      'Reject action',
      '>Cancel<',
      '>Script<',
      'Low risk',
      'This action is low risk and usually only reads data.',
      'Working directory:',
      'Script contents',
    ],
  ],
  [
    'zh',
    [
      '待审批操作',
      '全部批准',
      '全部拒绝',
      '还有 1 个待审批操作',
      '此操作需要您的确认',
      '编辑命令',
      '确认执行',
      '拒绝执行',
      '>取消<',
      '>脚本<',
      '低风险',
      '此操作风险较低，通常是读取操作',
      '工作目录:',
      '脚本内容',
    ],
  ],
] as const)(
  'localizes the Skill approval panel and action card in %s while retaining the resolved command and details',
  (locale, labels) => {
    localeState.locale = locale;
    pendingActions.splice(0, pendingActions.length, pending, {
      ...pending,
      id: 'action-2',
    });
    // Expand the only displayed card for static rendering.
    vi.mocked(useState).mockReturnValueOnce([true, vi.fn()]);
    const html = renderToStaticMarkup(
      createElement(SkillApprovalPanel, { maxItems: 1 }),
    );
    for (const label of labels) expect(html).toContain(label);
    for (const data of [
      pending.skillName,
      pending.action.name,
      pending.action.description,
      pending.resolvedCommand,
      ...pending.resolvedArgs,
    ]) {
      expect(html).toContain(data);
    }
    expect(html).toContain('/workspace/$&amp;/资料');
    expect(html).toContain('print(&quot;资料&quot;)');
    expect(html).not.toContain(pending.action.command);
  },
);
