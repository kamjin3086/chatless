import React, { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { SkillExecutionPlanDraft } from '@/store/skillExecutionPlanStore';
import { SkillExecutionPlanPanel } from '../SkillExecutionPlanPanel';

const { localeState, plans } = vi.hoisted(() => ({
  localeState: { locale: 'zh' as Locale },
  plans: [] as SkillExecutionPlanDraft[],
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => Locale) =>
    select(localeState),
}));
vi.mock('@/store/skillExecutionPlanStore', () => ({
  useSkillExecutionPlanStore: () => ({
    getAllPlans: () => plans,
    removePlan: vi.fn(),
    updatePlan: vi.fn(),
  }),
}));
vi.mock('@/lib/skills/skillTools', () => ({ executeSkillTool: vi.fn() }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: vi.fn(react.useState) };
});
vi.stubGlobal('React', React);

const createdAt = Date.UTC(2026, 6, 10, 14, 30);
const plan: SkillExecutionPlanDraft = {
  id: 'plan-1',
  skillId: '本地索引-skill',
  goal: '生成本地索引',
  steps: Array.from({ length: 7 }, (_, index) => ({
    id: `step-${index + 1}`,
    type: 'script',
    name: `生成索引-${index + 1}`,
  })),
  createdAt,
  status: 'failed',
  errorMessage: '读取权限错误 E_ACCESS',
};

test.each([
  [
    'en',
    'en-US',
    'Created: ',
    [
      'Skill execution plans',
      'Showing only the 2 most recent',
      '>Failed<',
      '>Draft<',
      '1 step',
      '7 steps',
      '… 1 more step',
      'Step preview',
      'Medium risk',
      'title="Run plan"',
      'title="Delete plan"',
    ],
  ],
  [
    'zh',
    'zh-CN',
    '创建时间：',
    [
      'Skill 执行计划',
      '仅展示最近 2 个',
      '>失败<',
      '>草稿<',
      '1 步',
      '7 步',
      '… 还有 1 步',
      '步骤预览',
      '中等风险',
      'title="执行计划"',
      'title="删除计划"',
    ],
  ],
] as const)(
  'presents the execution plan and its counts in %s without translating plan data',
  (locale, dateLocale, dateLabel, labels) => {
    localeState.locale = locale;
    plans.splice(
      0,
      plans.length,
      plan,
      { ...plan, id: 'draft', status: 'draft', steps: plan.steps.slice(0, 1) },
      { ...plan, id: 'older', skillId: 'hidden-skill', status: 'cancelled' },
    );
    // Expand the first plan for static rendering.
    vi.mocked(useState).mockReturnValueOnce([plan.id, vi.fn()]);
    const html = renderToStaticMarkup(
      createElement(SkillExecutionPlanPanel, { maxItems: 2 }),
    );
    for (const label of labels) expect(html).toContain(label);
    expect(html).toContain(
      dateLabel + new Date(createdAt).toLocaleString(dateLocale),
    );
    for (const data of [
      plan.skillId,
      plan.goal,
      plan.errorMessage,
      '>script<',
      '生成索引-6',
    ]) {
      expect(html).toContain(data);
    }
    expect(html).not.toContain('生成索引-7');
    expect(html).not.toContain('hidden-skill');
  },
);
