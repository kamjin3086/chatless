import React, { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/types';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import { AttachmentMenu } from '../AttachmentMenu';

const settings = vi.hoisted(() => ({ locale: 'zh' as Locale }));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof settings) => unknown) =>
    select(settings),
}));

// Render the portal's contents inline to exercise the actual attachment menu rows in Node.
vi.mock('@/components/ui/action-panel', () => {
  const childrenOnly = ({ children }: { children: ReactNode }) => children;
  const row = ({
    title,
    description,
    suffix,
  }: { title: string; description?: string; suffix?: ReactNode }) =>
    createElement('div', {}, title, description, suffix);
  return {
    ActionPanel: childrenOnly,
    ActionPanelTrigger: childrenOnly,
    ActionPanelContent: childrenOnly,
    ActionPanelHeader: row,
    ActionPanelList: childrenOnly,
    ActionPanelItem: row,
    ActionPanelDivider: () => null,
    ActionPanelEmpty: row,
  };
});

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

describe('AttachmentMenu locale', () => {
  it.each([
    [
      'en',
      'Upload image',
      'Attach document',
      'Document attached',
      'Knowledge base:',
    ],
    ['zh', '上传图片', '附加文档', '已附加文档', '知识库:'],
  ] as const)(
    'localizes attachment rows in %s without rewriting user labels or composer triggers',
    (locale, image, attachDocument, attached, knowledgeBase) => {
      settings.locale = locale;
      const name = '项目资料$&';
      const html = renderToStaticMarkup(
        createElement(AttachmentMenu, {
          open: true,
          onOpenChange: vi.fn(),
          onOpenComposerPanel: vi.fn(),
          onPickImage: vi.fn(),
          onPickDocument: vi.fn(),
          onSelectKnowledgeBase: vi.fn(),
          selectedKnowledgeBase: { id: 'kb-1', name } as KnowledgeBase,
          hasDocument: true,
        }),
      );
      for (const label of [
        image,
        attachDocument,
        attached,
        `${knowledgeBase} 项目资料$&amp;`,
      ]) {
        expect(html).toContain(label);
      }
      for (const trigger of ['/', '#', '@']) {
        expect(html).toContain(`>${trigger}</kbd>`);
      }
    },
  );
});
