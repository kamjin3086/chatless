import React, { createElement, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import { PrivacySettings } from '../PrivacySettings';

const localeState = vi.hoisted(() => ({
  locale: 'zh' as Locale,
}));

vi.mock('@/store/localeStore', () => ({
  useLocaleStore: (select: (state: typeof localeState) => unknown) =>
    select(localeState),
}));

// Radix portals do not render on the server, so unwrap these wrappers to inspect their copy.
vi.mock('@/components/ui/alert-dialog', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    AlertDialog: inline,
    AlertDialogTrigger: inline,
    AlertDialogContent: inline,
    AlertDialogTitle: inline,
    AlertDialogDescription: inline,
    AlertDialogFooter: inline,
    AlertDialogCancel: inline,
    AlertDialogAction: inline,
  };
});
vi.mock('@/components/ui/collapsible', () => {
  const inline = ({ children }: PropsWithChildren) => children;
  return {
    Collapsible: inline,
    CollapsibleTrigger: inline,
    CollapsibleContent: inline,
  };
});

// These modules are only used by event handlers, so a render test needs no real Tauri/database implementation.
vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({}) },
}));
vi.mock('@/lib/utils/downloadService', () => ({
  downloadService: { downloadJson: vi.fn() },
}));
vi.mock('@/lib/embedding/OnnxModelDownloader', () => ({
  OnnxModelDownloader: vi.fn().mockImplementation(() => ({
    waitUntilReady: vi.fn(),
    deleteAllModels: vi.fn(),
  })),
}));
vi.mock('@/lib/request', () => ({ tauriFetch: vi.fn() }));
vi.mock('@/lib/storage', () => ({ StorageUtil: {} }));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const confirmationTokens = ['DELETE', 'CLEAR KB', 'CLEAR MODEL', 'RESET APP'];

it.each([
  {
    locale: 'zh',
    heading: '数据与备份',
    importBackup: '导入备份',
    exportRecords: '导出记录',
    dangerZone: '危险操作',
    clearChats: '清空聊天记录',
    clearChatsTitle: '确认清空全部聊天记录？',
    clearChatsWarning: '将执行以下操作并',
    irreversible: '无法撤销',
    clearChatsItemConversations: '删除所有会话（Conversation）记录',
    clearChatsItemMessages: '删除每条聊天消息内容',
    clearChatsItemStats: '重置最近聊天模型统计',
    clearChatsPlaceholder: '请输入 DELETE 以确认',
    clearKnowledge: '清空知识库数据',
    clearKnowledgeTitle: '确认清空所有知识库数据？',
    clearKnowledgeWarning: '此操作将删除以下内容并',
    unrecoverable: '无法恢复',
    clearKnowledgeItemDocs: '已上传 / 抓取的文档文件',
    clearKnowledgeItemIndex: '删除知识库索引和缓存',
    clearKnowledgeItemConfig: '知识库配置项',
    clearKnowledgePlaceholder: '请输入 CLEAR KB 以确认',
    clearModelCache: '清空模型缓存',
    clearModelCacheTitle: '确认清空所有本地模型缓存？',
    clearModelCacheWarning: '将删除以下内容：',
    clearModelCacheItemDownloaded: '通过应用下载的模型文件',
    clearModelCacheItemProgress: '模型下载进度与缓存记录',
    clearModelCachePlaceholder: '请输入 CLEAR MODEL',
    factoryReset: '恢复出厂设置',
    factoryResetTitle: '确认恢复出厂设置？',
    factoryResetWarning: '此操作极其危险，将执行以下步骤并',
    factoryResetItemChats: '全部聊天记录',
    factoryResetItemSettingsEmphasis: '个人设置',
    factoryResetItemCache: '清空所有应用缓存文件',
    factoryResetItemRestart: '应用随后自动重启为初始状态',
    factoryResetPlaceholder: '请输入 RESET APP',
    cancel: '取消',
    confirmDelete: '确认删除',
    confirmReset: '确认恢复',
    importDone: '已导入 3 个对话',
    importFailed: '导入失败：boom',
  },
  {
    locale: 'en',
    heading: 'Data and backup',
    importBackup: 'Import backup',
    exportRecords: 'Export records',
    dangerZone: 'Danger zone',
    clearChats: 'Clear chat history',
    clearChatsTitle: 'Clear all chat history?',
    clearChatsWarning: 'The following actions will be performed and ',
    irreversible: 'cannot be undone',
    clearChatsItemConversations: 'Delete all conversations',
    clearChatsItemMessages: 'Delete every chat message',
    clearChatsItemStats: 'Reset recent chat model statistics',
    clearChatsPlaceholder: 'Type DELETE to confirm',
    clearKnowledge: 'Clear knowledge base data',
    clearKnowledgeTitle: 'Clear all knowledge base data?',
    clearKnowledgeWarning: 'This will delete the following and ',
    unrecoverable: 'cannot be recovered',
    clearKnowledgeItemDocs: 'Uploaded or crawled document files',
    clearKnowledgeItemIndex: 'Delete the knowledge base index and cache',
    clearKnowledgeItemConfig: 'Knowledge base configuration',
    clearKnowledgePlaceholder: 'Type CLEAR KB to confirm',
    clearModelCache: 'Clear model cache',
    clearModelCacheTitle: 'Clear all local model cache?',
    clearModelCacheWarning: 'The following will be deleted:',
    clearModelCacheItemDownloaded: 'Model files downloaded through the app',
    clearModelCacheItemProgress: 'Model download progress and cache records',
    clearModelCachePlaceholder: 'Type CLEAR MODEL',
    factoryReset: 'Factory reset',
    factoryResetTitle: 'Factory reset the app?',
    factoryResetWarning:
      'This is extremely destructive. It will perform the following steps and ',
    factoryResetItemChats: 'all chat history',
    factoryResetItemSettingsEmphasis: 'personal settings',
    factoryResetItemCache: 'Clear all app cache files',
    factoryResetItemRestart:
      'The app then restarts automatically to its initial state',
    factoryResetPlaceholder: 'Type RESET APP',
    cancel: 'Cancel',
    confirmDelete: 'Delete',
    confirmReset: 'Reset',
    importDone: 'Imported 3 conversations',
    importFailed: 'Import failed: boom',
  },
] as const)('localizes PrivacySettings copy in $locale', (labels) => {
  localeState.locale = labels.locale;
  const html = renderToStaticMarkup(createElement(PrivacySettings));

  for (const text of [
    labels.heading,
    labels.importBackup,
    labels.exportRecords,
    labels.dangerZone,
    labels.clearChats,
    labels.clearChatsTitle,
    labels.clearChatsWarning,
    labels.clearKnowledgeWarning,
    labels.factoryResetWarning,
    labels.irreversible,
    labels.unrecoverable,
    labels.clearChatsItemConversations,
    labels.clearChatsItemMessages,
    labels.clearChatsItemStats,
    labels.clearKnowledge,
    labels.clearKnowledgeTitle,
    labels.clearKnowledgeItemDocs,
    labels.clearKnowledgeItemIndex,
    labels.clearKnowledgeItemConfig,
    labels.clearModelCache,
    labels.clearModelCacheTitle,
    labels.clearModelCacheWarning,
    labels.clearModelCacheItemDownloaded,
    labels.clearModelCacheItemProgress,
    labels.factoryReset,
    labels.factoryResetTitle,
    labels.factoryResetItemChats,
    labels.factoryResetItemSettingsEmphasis,
    labels.factoryResetItemCache,
    labels.factoryResetItemRestart,
    labels.cancel,
    labels.confirmDelete,
    labels.confirmReset,
  ]) {
    expect(html, `expected copy: ${text}`).toContain(text);
  }

  for (const placeholder of [
    labels.clearChatsPlaceholder,
    labels.clearKnowledgePlaceholder,
    labels.clearModelCachePlaceholder,
    labels.factoryResetPlaceholder,
  ]) {
    expect(html).toContain(`placeholder="${placeholder}"`);
  }

  // Destructive confirmation tokens must stay literal, otherwise they would mismatch input validation.
  for (const token of confirmationTokens) {
    expect(html).toContain(token);
  }

  // Handler toast copy uses the same catalog and keeps interpolation placeholders in both languages.
  expect(
    translate(labels.locale, 'settings.privacy.importDone').replace('{0}', '3'),
  ).toBe(labels.importDone);
  expect(
    translate(labels.locale, 'settings.privacy.importFailed').replace(
      '{0}',
      'boom',
    ),
  ).toBe(labels.importFailed);
});

it('keeps every settings.privacy key present in both catalogs', () => {
  const keys = [
    'settings.privacy.dataAndBackup',
    'settings.privacy.importBackup',
    'settings.privacy.importing',
    'settings.privacy.exportRecords',
    'settings.privacy.exporting',
    'settings.privacy.dangerZone',
    'settings.privacy.cancel',
    'settings.privacy.clearing',
    'settings.privacy.confirmDelete',
    'settings.privacy.resetting',
    'settings.privacy.confirmReset',
    'settings.privacy.clearChats',
    'settings.privacy.clearChatsTitle',
    'settings.privacy.clearChatsWarning',
    'settings.privacy.clearChatsItemConversations',
    'settings.privacy.clearChatsItemMessages',
    'settings.privacy.clearChatsItemStats',
    'settings.privacy.clearChatsConfirmPrefix',
    'settings.privacy.clearChatsConfirmSuffix',
    'settings.privacy.clearChatsPlaceholder',
    'settings.privacy.clearKnowledge',
    'settings.privacy.clearKnowledgeTitle',
    'settings.privacy.clearKnowledgeWarning',
    'settings.privacy.clearKnowledgeItemDocs',
    'settings.privacy.clearKnowledgeItemIndex',
    'settings.privacy.clearKnowledgeItemConfig',
    'settings.privacy.clearKnowledgeConfirmPrefix',
    'settings.privacy.clearKnowledgeConfirmSuffix',
    'settings.privacy.clearKnowledgePlaceholder',
    'settings.privacy.clearModelCache',
    'settings.privacy.clearModelCacheTitle',
    'settings.privacy.clearModelCacheWarning',
    'settings.privacy.clearModelCacheItemDownloaded',
    'settings.privacy.clearModelCacheItemProgress',
    'settings.privacy.clearModelCacheConfirmPrefix',
    'settings.privacy.clearModelCacheConfirmSuffix',
    'settings.privacy.clearModelCachePlaceholder',
    'settings.privacy.factoryReset',
    'settings.privacy.factoryResetTitle',
    'settings.privacy.factoryResetWarning',
    'settings.privacy.factoryResetDeletePrefix',
    'settings.privacy.factoryResetItemChats',
    'settings.privacy.factoryResetItemKnowledge',
    'settings.privacy.factoryResetItemModels',
    'settings.privacy.factoryResetItemSettingsPrefix',
    'settings.privacy.factoryResetItemSettingsEmphasis',
    'settings.privacy.factoryResetItemCache',
    'settings.privacy.factoryResetItemRestart',
    'settings.privacy.factoryResetConfirmPrefix',
    'settings.privacy.factoryResetConfirmSuffix',
    'settings.privacy.factoryResetPlaceholder',
    'settings.privacy.irreversible',
    'settings.privacy.unrecoverable',
    'settings.privacy.warningColon',
    'settings.privacy.chatsCleared',
    'settings.privacy.knowledgeCleared',
    'settings.privacy.modelCacheCleared',
    'settings.privacy.factoryResetDone',
    'settings.privacy.chatsExported',
    'settings.privacy.importDone',
    'settings.privacy.importDefaultTitle',
    'settings.privacy.unknownError',
    'settings.privacy.clearChatsFailed',
    'settings.privacy.clearKnowledgeFailed',
    'settings.privacy.clearModelCacheFailed',
    'settings.privacy.factoryResetFailed',
    'settings.privacy.exportFailed',
    'settings.privacy.importFailed',
    'settings.privacy.importInvalidType',
    'settings.privacy.importInvalidFormat',
  ] as const;

  for (const key of keys) {
    expect(translate('zh', key as TranslationKey)).not.toBe(key);
    expect(translate('en', key as TranslationKey)).not.toBe(key);
  }
});
