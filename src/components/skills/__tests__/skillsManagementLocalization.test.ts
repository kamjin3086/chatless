import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ExtensionsPage from '@/app/extensions/page';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import type { Skill } from '@/lib/skills/types';
import { SkillDetailDialog } from '../SkillDetailDialog';
import { SkillFileTree } from '../SkillFileTree';
import { SkillGrid } from '../SkillGrid';
import { SkillImportDialog } from '../SkillImportDialog';
import { SkillStatusBadge } from '../SkillStatusBadge';

let locale: Locale;
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: () => ({
    locale,
    t: (key: TranslationKey) => translate(locale, key),
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=skills'),
}));
vi.mock('@/components/settings/McpServersSettings', () => ({
  McpServersSettings: () => null,
}));
vi.mock('@/lib/skills', () => ({ getSkillManager: vi.fn() }));

// Node rendering does not mount Radix portals or the lazy Markdown component.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({
    closeLabel,
    children,
  }: { closeLabel?: string; children: ReactNode }) =>
    createElement(
      'div',
      { role: 'dialog' },
      children,
      closeLabel && createElement('button', {}, closeLabel),
    ),
  DialogTitle: ({ children }: { children: ReactNode }) =>
    createElement('h2', {}, children),
  DialogHeader: ({ children }: { children: ReactNode }) => children,
  DialogDescription: ({ children }: { children: ReactNode }) => children,
  DialogFooter: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/chat/LazyStreamingMarkdown', () => ({
  LazyStreamingMarkdown: ({ content }: { content: string }) =>
    createElement('pre', {}, content),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const skill = {
  id: 'proofreader-v2',
  name: '校对工具',
  description: '检查标点',
  author: '小林',
  tags: ['文字'],
  version: '2.3.0',
  source: 'local',
  status: 'installed',
  path: '/skills/proofreader-v2',
  enabled: true,
  installedAt: new Date(2024, 6, 14, 12).getTime(),
  skillMdContent: '## 用法\n\n`./scripts/check.sh`',
} satisfies Skill;

const noop = () => {};

const cases = [
  {
    locale: 'en',
    tab: 'Skills',
    search: 'Search skills…',
    shown: 'Shown: 0',
    update: 'Update available',
    empty: 'No skills to show',
    loading: 'Loading skills…',
    loadFailed: 'Could not load skills',
    local: 'Local',
    installed: 'Installed',
    unknown: 'Unknown ($&amp;_status)',
    noDescription: 'No description',
    noDocs: 'No documentation available',
    files: 'File structure',
    readFailed: 'Could not read the folder',
    enabled: 'Enabled',
    close: 'Close',
    installedDate: '7/14/2024',
    importTitle: 'Import a skill',
    importZip: 'Import from ZIP',
    cloneGit: 'Clone from Git',
  },
  {
    locale: 'zh',
    tab: '技能',
    search: '搜索技能…',
    shown: '0 个',
    update: '有更新',
    empty: '暂无技能',
    loading: '正在加载技能…',
    loadFailed: '加载技能失败',
    local: '本地',
    installed: '已安装',
    unknown: '未知（$&amp;_status）',
    noDescription: '暂无描述',
    noDocs: '暂无文档内容',
    files: '文件结构',
    readFailed: '无法读取目录',
    enabled: '已启用',
    close: '关闭',
    installedDate: '2024/7/14',
    importTitle: '导入技能',
    importZip: '从 ZIP 导入',
    cloneGit: '从 Git 克隆',
  },
] satisfies { locale: Locale; [key: string]: string }[];

describe.each(cases)('Skills management in $locale', (labels) => {
  it('localizes the entry tab, toolbar, and list states without changing filter values or diagnostics', () => {
    locale = labels.locale;
    const entry = renderToStaticMarkup(createElement(ExtensionsPage));
    expect(entry).toContain(`</svg>${labels.tab}`);
    expect(entry).toContain(`placeholder="${labels.search}"`);
    expect(entry).toContain(`value="needs_update">${labels.update}</option>`);
    expect(entry).toContain(labels.shown);
    expect(entry).toContain(labels.empty);

    const loading = renderToStaticMarkup(
      createElement(SkillGrid, { skills: [], isLoading: true }),
    );
    expect(loading).toContain(labels.loading);
    const error = `EACCES: ${skill.path}`;
    const failure = renderToStaticMarkup(
      createElement(SkillGrid, { skills: [], error }),
    );
    expect(failure).toContain(labels.loadFailed);
    expect(failure).toContain(error);
  });

  it('localizes card copy and fallback status while preserving provided metadata and status codes', () => {
    locale = labels.locale;
    const cards = renderToStaticMarkup(
      createElement(SkillGrid, {
        skills: [skill, { ...skill, id: 'no-description', description: '' }],
      }),
    );
    for (const text of [
      labels.local,
      labels.installed,
      labels.noDescription,
      skill.name,
      skill.description,
      skill.author,
      skill.tags[0],
      skill.version,
    ]) {
      expect(cards).toContain(text);
    }
    const status = renderToStaticMarkup(
      createElement(SkillStatusBadge, { status: '$&_status' }),
    );
    expect(status).toContain(labels.unknown);
  });

  it('localizes detail framing and the installation date without translating IDs or skill Markdown', () => {
    locale = labels.locale;
    const detail = (selected: Skill) =>
      renderToStaticMarkup(
        createElement(SkillDetailDialog, {
          skill: selected,
          open: true,
          onOpenChange: noop,
        }),
      );
    const html = detail(skill);
    for (const text of [
      labels.files,
      labels.enabled,
      labels.installedDate,
      skill.name,
      skill.id,
      skill.skillMdContent,
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(`aria-label="${labels.close}"`);
    expect(detail({ ...skill, skillMdContent: undefined })).toContain(
      labels.noDocs,
    );
    const tree = renderToStaticMarkup(
      createElement(SkillFileTree, { rootPath: skill.path }),
    );
    expect(tree).toContain(labels.readFailed);
  });

  it('localizes reachable import copy and leaves the SKILL.md filename intact', () => {
    locale = labels.locale;
    const html = renderToStaticMarkup(
      createElement(SkillImportDialog, {
        open: true,
        mode: 'zip',
        onOpenChange: noop,
        onModeChange: noop,
        onSuccess: noop,
      }),
    );
    expect(html).toContain(labels.importTitle);
    expect(html).toContain(labels.importZip);
    expect(html).toContain(labels.cloneGit);
    expect(html).toContain('SKILL.md');
    expect(html).toContain(`<button>${labels.close}</button>`);
  });
});
