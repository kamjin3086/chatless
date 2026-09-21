'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from '@/components/ui/dropdown-menu';
import { Ban, FileText, FileJson, FileCode, Database, RotateCcw, Trash2, Clock, HardDrive, Layers, Info, Eye, MoreVertical } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ResourceDocument } from './types';
import { useState } from 'react';
import { SectionCard } from '@/components/ui/section-card';

// 根据扩展名返回简洁图标
const getFileIcon = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'json':
      return <FileJson className="h-4 w-4 text-slate-400" />;
    case 'md':
    case 'markdown':
    case 'txt':
      return <FileCode className="h-4 w-4 text-slate-400" />;
    default:
      return <FileText className="h-4 w-4 text-slate-400" />;
  }
};

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// 扩展资源项目属性接口
interface ExtendedResourceItemProps extends ResourceDocument {
  onView?: (id: string) => void;
  onAddToKnowledgeBase?: (id: string) => void;
  onDelete?: (id: string) => void;
  onAddNote?: (id: string) => void;
  onComment?: (id: string) => void;
  hideIndexedStatus?: boolean; // 新增：是否隐藏"已入库"状态
  /** 语义索引失败/等待时提供的操作入口 */
  onRetrySemantic?: (id: string) => void;
  onCancelSemantic?: (id: string) => void;
}

export function ResourceItem({
  id,
  title,
  filePath,
  fileSize,
  createdAt,
  onView,
  onAddToKnowledgeBase,
  onDelete,
  isIndexed,
  chunkCount,
  lexicalStatus,
  semanticStatus,
  knowledgeBases = [],
  hideIndexedStatus = false, // 新增参数，默认为false
  source,
  conversationId,
  onRetrySemantic,
  onCancelSemantic,
}: ExtendedResourceItemProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  
  // 检查是否为聊天文件 - 修复检测逻辑
  const isChatFile = source === 'chat';

  // 处理跳转到对话的功能
  const handleJumpToConversation = async () => {
    if (conversationId) {
      try {
        const { useChatStore } = await import('@/store/chatStore');
        const { setCurrentConversation } = useChatStore.getState();
        setCurrentConversation(conversationId);
        // 使用window.location进行跳转，确保状态已设置
        window.location.href = '/chat';
      } catch (error) {
        console.error('跳转到对话失败:', error);
        // 备用方案：使用URL参数跳转
        window.location.href = `/chat?conversationId=${conversationId}`;
      }
    }
  };

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex items-center gap-2.5 px-2 py-2 border-b border-slate-100 dark:border-slate-800/40 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
        {/* 文件图标 */}
        <div className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 dark:bg-slate-800 flex-shrink-0">
          {getFileIcon(title)}
        </div>

        {/* 文件信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
              {title}
            </p>
            {isChatFile && (
              <span className="rounded px-1 py-0.5 text-[10px] border border-slate-200/70 bg-slate-100/70 text-slate-600 dark:border-slate-600/50 dark:bg-slate-800/40 dark:text-slate-300">
                聊天
              </span>
            )}
            {lexicalStatus && (
              <span className={`rounded px-1 py-0.5 text-[10px] border ${lexicalStatus === 'ready'
                ? 'border-emerald-200/70 bg-emerald-50/70 text-emerald-700 dark:text-emerald-400'
                : lexicalStatus === 'failed' ? 'border-red-200/70 bg-red-50/70 text-red-700 dark:text-red-400'
                : 'border-slate-200/70 bg-slate-100/70 text-slate-600 dark:text-slate-300'}`}>
                关键词{lexicalStatus === 'ready' ? '可用' : lexicalStatus === 'failed' ? '失败' : '处理中'}
              </span>
            )}
            {semanticStatus && (
              <span className={`rounded px-1 py-0.5 text-[10px] border ${semanticStatus === 'ready'
                ? 'border-blue-200/70 bg-blue-50/70 text-blue-700 dark:text-blue-400'
                : semanticStatus === 'failed' ? 'border-amber-200/70 bg-amber-50/70 text-amber-700 dark:text-amber-400'
                : 'border-slate-200/70 bg-slate-100/70 text-slate-600 dark:text-slate-300'}`}>
                语义{semanticStatus === 'ready' ? '可用' : semanticStatus === 'failed' ? '不可用' : '等待'}
              </span>
            )}
            {semanticStatus && semanticStatus !== 'ready' && onRetrySemantic && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="重试语义索引"
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={(event) => { event.stopPropagation(); onRetrySemantic(id); }}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>重试语义索引</TooltipContent>
              </Tooltip>
            )}
            {onCancelSemantic && (semanticStatus === 'processing' || semanticStatus === 'pending') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="取消语义索引"
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    onClick={(event) => { event.stopPropagation(); onCancelSemantic(id); }}
                  >
                    <Ban className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>取消语义索引</TooltipContent>
              </Tooltip>
            )}
            {!hideIndexedStatus && knowledgeBases && knowledgeBases.length > 0 && (
              <div className="flex gap-0.5 flex-wrap">
                {knowledgeBases.slice(0, 2).map((kb, index) => (
                  <span 
                    key={`${kb.id}-${index}`} 
                    className={`rounded px-1 py-0.5 text-[10px] border ${
                      kb.status === 'indexed' 
                        ? 'border-emerald-200/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-400'
                        : kb.status === 'pending' || kb.status === 'indexing'
                        ? 'border-slate-200/70 bg-slate-100/70 text-slate-600 dark:border-slate-600/50 dark:bg-slate-800/40 dark:text-slate-300'
                        : 'border-red-200/70 bg-red-50/70 text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400'
                    }`}
                  >
                    {kb.name}
                  </span>
                ))}
                {knowledgeBases.length > 2 && (
                  <span className="text-[10px] text-slate-400">+{knowledgeBases.length - 2}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
            <span>{formatFileSize(fileSize)}</span>
            <span>{new Date(createdAt).toLocaleDateString('zh-CN')}</span>
            {!isChatFile && typeof chunkCount === 'number' && chunkCount > 0 && (
              <span>{chunkCount} 分片</span>
            )}
            {isChatFile && conversationId && (
              <span 
                className="text-blue-500 dark:text-blue-400 cursor-pointer hover:underline"
                onClick={handleJumpToConversation}
              >
                对话中
              </span>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-0.5">
          {onView && (
            <button
              onClick={() => onView(id)}
              className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
              title={isChatFile ? '跳转到对话' : '查看'}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}

          {onAddToKnowledgeBase && (
            <button
              onClick={() => onAddToKnowledgeBase(id)}
              className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
              title="添加到知识库"
            >
              <Database className="h-3.5 w-3.5" />
            </button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32 text-xs">
              <DropdownMenuItem onClick={() => setDetailOpen(true)} className="cursor-pointer text-xs">
                <Info className="h-3 w-3 mr-2" />
                详情
              </DropdownMenuItem>
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => onDelete(id)} 
                    className="cursor-pointer text-xs text-red-500"
                  >
                    <Trash2 className="h-3 w-3 mr-2" />
                    {isChatFile ? '移除' : '删除'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 详情对话框 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-200/40 dark:border-slate-700/40">
            <DialogTitle className="text-lg font-semibold truncate pr-8 text-slate-900 dark:text-slate-100">{title}</DialogTitle>
          </DialogHeader>
          <div className="text-sm space-y-4 px-6 py-4 max-h-96 overflow-y-auto text-slate-700 dark:text-slate-300">
            <div className="space-y-2">
              <p><strong>文件大小:</strong> {formatFileSize(fileSize)}</p>
              <p><strong>创建时间:</strong> {new Date(createdAt).toLocaleString('zh-CN')}</p>
              {typeof chunkCount === 'number' && <p><strong>分片数量:</strong> {chunkCount} 个</p>}
            </div>
            
            {!hideIndexedStatus && knowledgeBases && knowledgeBases.length > 0 && (
              <div>
                <p className="font-medium mb-3">关联的知识库:</p>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {knowledgeBases.map((kb, index) => (
                    <div key={`${kb.id}-${index}`} className="flex items-center justify-between p-2.5 glass-inset rounded-lg text-sm">
                      <span className="truncate mr-2">{kb.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 border ${
                        kb.status === 'indexed' 
                          ? 'text-emerald-700 border-emerald-200/70 bg-emerald-50/50 dark:text-emerald-400 dark:border-emerald-800/40 dark:bg-emerald-900/20'
                          : kb.status === 'pending' || kb.status === 'indexing'
                          ? 'text-slate-600 border-slate-200/70 bg-slate-100/50 dark:text-slate-300 dark:border-slate-600/50 dark:bg-slate-800/40'
                          : 'text-red-600 border-red-200/70 bg-red-50/50 dark:text-red-400 dark:border-red-800/40 dark:bg-red-900/20'
                      }`}>
                        {kb.status === 'indexed' ? '已索引' : kb.status === 'pending' ? '待处理' : kb.status === 'indexing' ? '处理中' : '失败'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {!hideIndexedStatus && (!knowledgeBases || knowledgeBases.length === 0) && (
              <div className="text-center py-4">
                <p className="text-gray-500 dark:text-gray-400">尚未添加到任何知识库</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
