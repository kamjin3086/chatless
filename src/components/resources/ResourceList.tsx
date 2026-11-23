'use client';

import { ResourceItem } from './ResourceItem';
import { Loader2 } from 'lucide-react';
import { ResourceListProps } from './types';
import { FileText } from 'lucide-react'; // Added FileText import
import { translate } from '@/i18n';
import { useLocaleStore } from '@/store/localeStore';

// 文档类型扩展名
const DOCUMENT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'pdf', 'doc', 'docx', 
  'ppt', 'pptx', 'xls', 'xlsx', 'rtf', 'odt'
];

// 代码和数据文件扩展名
const FILE_EXTENSIONS = [
  'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cpp', 'c', 'h', 'cs', 'php', 'rb', 'go', 'rs', 'swift',
  'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'toml', 'env',
  'csv', 'sql', 'db', 'sqlite', 'log', 'conf'
];

// 判断文件是否为文档类型
const isDocumentType = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? DOCUMENT_EXTENSIONS.includes(ext) : false;
};

// 判断文件是否为代码/数据文件类型
const isFileType = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? FILE_EXTENSIONS.includes(ext) : false;
};

export function ResourceList({
  resources,
  type,
  loading,
  onView,
  onAddToKnowledgeBase,
  onDelete,
  onAddNote,
  onComment
}: ResourceListProps) {
  const locale = useLocaleStore((state) => state.locale);

  // 根据类型筛选资源
  const filteredResources = type === 'documents'
    ? resources.filter(r => r.source !== 'chat' && isDocumentType(r.title)) // 只显示文档类型，排除聊天文件
      : type === 'files'
      ? resources.filter(r => r.source !== 'chat' && isFileType(r.title)) // 只显示代码/数据文件，排除聊天文件
      : type === 'chat'
        ? resources.filter(r => r.source === 'chat') // 只显示聊天文件
        : type === 'knowledge'
          ? resources.filter(r => r.isIndexed) // 只显示已索引文件
          : resources;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" />
          <p className="mt-2 text-xs text-slate-400">{translate(locale, 'resources.loading')}</p>
        </div>
      </div>
    );
  }

  if (filteredResources.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-3 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-slate-400" strokeWidth={1.5} />
          </div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            {translate(locale, `resources.empty.${type}`)}
          </p>
          <p className="text-[11px] text-slate-400">
            {translate(locale, type === 'knowledge'
              ? 'resources.empty.knowledgeHint'
              : type === 'chat'
                ? 'resources.empty.chatHint'
                : 'resources.empty.uploadHint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {filteredResources.map(resource => (
        <ResourceItem 
          key={resource.id}
          {...resource}
          onView={onView}
          onAddToKnowledgeBase={(id: string) => onAddToKnowledgeBase?.(id)}
          onDelete={onDelete}
          onAddNote={(id: string) => onAddNote?.(id, '')}
          onComment={onComment}
        />
      ))}
    </div>
  );
} 