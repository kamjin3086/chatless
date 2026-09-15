"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Loader2, ArrowLeft, Trash2, FileText, MessageSquarePlus, FilePlus2, RotateCcw, MoreVertical, Edit3, FileEdit, FolderOpen } from "lucide-react";
import { KnowledgeService, KnowledgeBase } from "@/lib/knowledgeService";
import { UnifiedFileService, type UnifiedFile } from "@/lib/unifiedFileService";
import { FileOpener } from '@/lib/utils/fileOpener';
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger, 
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CollapsibleKnowledgeInfo } from './CollapsibleKnowledgeInfo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResourceItem } from "@/components/resources/ResourceItem";
import { ContextMenu } from '@/components/ui/context-menu';
import { createKnowledgeMenuItems } from './knowledgeMenu';
import { AddDocumentsDialog } from './AddDocumentsDialog';
import { IconButton } from '@/components/ui/icon-button';

interface KnowledgeDetailProps {
  knowledgeBase?: KnowledgeBase;
  onBack?: () => void;
  onRefresh?: () => void;
}

export function KnowledgeDetail({ knowledgeBase: propKnowledgeBase, onBack, onRefresh }: KnowledgeDetailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(propKnowledgeBase || null);
  const [documents, setDocuments] = useState<UnifiedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  
  // 编辑对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editType, setEditType] = useState<'rename' | 'details'>('details');
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    icon: 'database',
    isEncrypted: false
  });

  // 删除确认相关状态
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<'knowledge-base' | 'document'>('knowledge-base');
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);

  // 添加文档对话框状态
  const [rebuildDialogOpen, setRebuildDialogOpen] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<number | null>(null);
  const [rebuildMessage, setRebuildMessage] = useState('');
  const [indexStatus, setIndexStatus] = useState<{
    total: number;
    indexed: number;
    pending: number;
    failed: number;
    needsRebuild: boolean;
  } | null>(null);
  // 添加文档对话框状态
  const [addDocsOpen, setAddDocsOpen] = useState(false);

  // 处理返回 - 保持 Tab 状态为知识库
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.push('/knowledge?tab=knowledge');
    }
  };

  // 处理刷新
  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    }
    loadKnowledgeBase();
  };

  // 加载知识库信息
  const loadKnowledgeBase = useCallback(async () => {
    if (propKnowledgeBase) {
      setKnowledgeBase(propKnowledgeBase);
      setEditForm({
        name: propKnowledgeBase.name,
        description: propKnowledgeBase.description || '',
        icon: propKnowledgeBase.icon,
        isEncrypted: propKnowledgeBase.isEncrypted
      });
      return;
    }

    const kbId = searchParams.get('id');
    if (!kbId) {
      console.error('知识库ID未提供');
      handleBack();
      return;
    }

    try {
      setIsLoading(true);
      console.log('[KnowledgeDetail] 开始加载知识库:', kbId);
      const kb = await KnowledgeService.getKnowledgeBase(kbId);
      if (!kb) {
        console.error('知识库不存在:', kbId);
        toast.error('知识库不存在');
        handleBack();
        return;
      }

      console.log('[KnowledgeDetail] 知识库加载成功:', kb.name);
      setKnowledgeBase(kb);
      setEditForm({
        name: kb.name,
        description: kb.description || '',
        icon: kb.icon,
        isEncrypted: kb.isEncrypted
      });
    } catch (error) {
      console.error('加载知识库失败:', error);
      toast.error('加载知识库失败');
      handleBack();
    } finally {
      setIsLoading(false);
    }
  }, [propKnowledgeBase, searchParams]); // 移除router依赖

  // 加载文档列表
  const loadDocuments = useCallback(async () => {
    if (!knowledgeBase) return;

    try {
      // 使用正确的方法：从数据库映射表获取知识库中的文档
      const documentsWithMappings = await KnowledgeService.getDocumentsInKnowledgeBase(knowledgeBase.id);
      
      // 为每个文档查询分片数量
      const docsWithChunk = await Promise.all(
        documentsWithMappings.map(async (item) => {
          const { chunkCount } = await KnowledgeService.getDocumentStats(knowledgeBase.id, item.document.id);
          return {
            ...item.document,
            chunkCount,
          };
        })
      );

      setDocuments(docsWithChunk);
      const status = await KnowledgeService.getKnowledgeBaseIndexStatus(knowledgeBase.id);
      setIndexStatus(status);
      console.log(`[KnowledgeDetail] 加载到 ${docsWithChunk.length} 个文档`);
    } catch (error) {
      console.error('加载文档失败:', error);
      setDocuments([]);
    }
  }, [knowledgeBase]);

  // 组件加载时获取知识库和文档
  useEffect(() => {
    loadKnowledgeBase();
  }, [loadKnowledgeBase]);

  useEffect(() => {
    if (knowledgeBase) {
      console.log('[KnowledgeDetail] 知识库已加载，开始加载文档列表');
      loadDocuments();
    }
  }, [knowledgeBase, loadDocuments]); // 保持对loadDocuments的依赖，但依赖数组更稳定了

  // 处理文档查看
  const handleViewDocument = async (documentId: string) => {
    try {
      const file = await UnifiedFileService.getFile(documentId);
      if (!file) {
        console.error('未找到原有文档，可能已被删除:', documentId);
        toast.error('未找到原有文档，可能已被删除');
        return;
      }
      
      // 使用系统默认程序打开文档
      await FileOpener.openFile(file.filePath, file.name);
    } catch (error) {
      console.error('查看文档失败:', error);
      toast.error('查看文档失败');
    }
  };

  // 重命名知识库
  const handleRename = () => {
    setEditType('rename');
    setEditForm({
      name: knowledgeBase?.name || '',
      description: knowledgeBase?.description || '',
      icon: knowledgeBase?.icon || 'database',
      isEncrypted: knowledgeBase?.isEncrypted || false
    });
    setEditDialogOpen(true);
  };

  // 修改详情
  const handleEditDetails = () => {
    setEditType('details');
    setEditForm({
      name: knowledgeBase?.name || '',
      description: knowledgeBase?.description || '',
      icon: knowledgeBase?.icon || 'database',
      isEncrypted: knowledgeBase?.isEncrypted || false
    });
    setEditDialogOpen(true);
  };

  // 编辑知识库（保留原有函数用于兼容性）
  const handleEdit = () => {
    handleEditDetails();
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!knowledgeBase) return;

    try {
      const updatedKb = await KnowledgeService.updateKnowledgeBase(
        knowledgeBase.id,
        {
          name: editForm.name,
          description: editForm.description,
          icon: editForm.icon,
          isEncrypted: editForm.isEncrypted
        }
      );

      if (updatedKb) {
        setKnowledgeBase(updatedKb);
        handleRefresh();
        toast.success('知识库更新成功');
        setEditDialogOpen(false);
      } else {
        toast.error('更新失败，请重试');
      }
    } catch (error) {
      console.error('更新知识库失败:', error);
      toast.error('更新失败，请重试');
    }
  };

  // 删除知识库
  const handleDelete = async () => {
    if (!knowledgeBase) return;

    setDeleteType('knowledge-base');
    setItemToDelete({ id: knowledgeBase.id, name: knowledgeBase.name });
    setDeleteDialogOpen(true);
  };

  // 下载文档
  const handleDownloadDocument = async (documentId: string) => {
    try {
      toast.info('文档下载功能正在开发中');
    } catch (error) {
      console.error('下载文档失败:', error);
      toast.error('下载文档失败');
    }
  };

  // 从知识库中移除文档
  const handleRemoveDocument = async (documentId: string) => {
    const doc = documents.find(d => d.id === documentId);
    if (!doc) return;

    setDeleteType('document');
    setItemToDelete({ id: documentId, name: doc.name || '未命名文档' });
    setDeleteDialogOpen(true);
  };

  // 确认删除操作
  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;

    try {
      if (deleteType === 'knowledge-base') {
        const success = await KnowledgeService.deleteKnowledgeBase(itemToDelete.id);

        if (success) {
          toast.success('知识库删除成功');
          handleBack();
        } else {
          toast.error('删除失败，请重试');
        }
      } else if (deleteType === 'document' && knowledgeBase) {
        // 从知识库中正确移除文档
        const success = await KnowledgeService.removeDocumentFromKnowledgeBase(
          itemToDelete.id, 
          knowledgeBase.id
        );

        if (success) {
          // 重新加载文档列表以确保数据一致性
          await loadDocuments();
          toast.success('文档已从知识库中移除');
        } else {
          toast.error('移除文档失败');
        }
      }
    } catch (error) {
      console.error('删除操作失败:', error);
      toast.error('删除失败，请重试');
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  // 取消删除
  const handleCancelDelete = () => {
    setDeleteDialogOpen(false);
    setItemToDelete(null);
  };

  // 处理表单变更
  const handleFormChange = (field: string, value: any) => {
    setEditForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // 添加文档到知识库
  const handleRebuildKnowledgeBase = async () => {
    if (!knowledgeBase) return;
    setRebuildProgress(0);
    setRebuildDialogOpen(true);
    try {
      await KnowledgeService.rebuildKnowledgeBase(knowledgeBase.id, {
        onProgress: (p, m) => {
          setRebuildProgress(p);
          setRebuildMessage(m);
        }
      });
      toast.success('知识库重建完成');
      // 重载文档列表
      loadDocuments();
    } catch (error) {
      console.error('重建知识库失败:', error);
      toast.error('重建知识库失败', { description: error instanceof Error ? error.message : '未知错误' });
    } finally {
      setRebuildDialogOpen(false);
      setRebuildProgress(null);
    }
  };

  const handleAddDocument = () => {
    setAddDocsOpen(true);
  };

  // 使用知识库
  const handleUse = () => {
    if (!knowledgeBase) return;
    // 跳转到聊天页并携带 knowledgeBase 查询参数
    router.push(`/chat?knowledgeBase=${knowledgeBase.id}`);
    toast.success('已切换到聊天，可开始使用该知识库');
  };

  // 添加调试信息
  console.log('[KnowledgeDetail] 组件状态:', { 
    isLoading, 
    hasKnowledgeBase: !!knowledgeBase, 
    knowledgeBaseName: knowledgeBase?.name,
    propKnowledgeBase: !!propKnowledgeBase,
    searchParamsId: searchParams.get('id')
  });

  if (isLoading) {
    console.log('[KnowledgeDetail] 显示加载状态');
    return (
      <div className="flex items-center justify-center w-full h-full p-12">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-gray-500">正在加载知识库...</p>
        </div>
      </div>
    );
  }

  if (!knowledgeBase) {
    console.log('[KnowledgeDetail] 知识库数据为空，显示错误状态');
    return (
      <div className="flex items-center justify-center w-full h-full p-12">
        <div className="text-center">
          <p className="text-lg text-gray-500 mb-2">无法加载知识库</p>
          <Button onClick={handleBack} variant="outline">返回</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 overflow-hidden shadow-lg h-full flex flex-col glass-panel">
        {/* 头部 */}
        <div className="app-topbar flex h-12 shrink-0 items-center justify-between border-b border-slate-200/70 px-4 sm:px-5 dark:border-slate-700/60">
          <div className="flex items-center gap-2 sm:gap-3">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleBack} className="text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary cursor-pointer">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>返回</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex flex-col">
              <h2 className="text-base font-semibold leading-tight text-gray-800 dark:text-gray-100">{knowledgeBase.name}</h2>
            </div>
          </div>
          <TooltipProvider delayDuration={100}>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton icon={MessageSquarePlus} onClick={handleUse} title="添加到对话" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>将此知识库应用于当前对话</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary focus:outline-none focus:ring-0 focus:ring-offset-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                
                </Tooltip>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleRename}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleEditDetails}>
                    <FileEdit className="h-4 w-4 mr-2" />
                    修改详情
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleDelete}
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    删除知识库
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TooltipProvider>
        </div>

        {indexStatus?.needsRebuild && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-amber-900 dark:text-amber-100">
              <p className="font-medium">需要重建索引</p>
              <p className="text-xs opacity-80 mt-0.5">
                Evidence RAG v2 升级后旧索引已失效。待索引 {indexStatus.pending} 篇，已索引 {indexStatus.indexed}/{indexStatus.total} 篇。
                未完成重建前检索将不可用。
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setRebuildDialogOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-1" />
              一键重建
            </Button>
          </div>
        )}

        {/* 内容区域 */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          {/* 知识库信息 */}
          <div className="mb-8">
            <h2 className="text-base font-semibold mb-3 text-gray-700 dark:text-gray-300">知识库信息</h2>
            <ContextMenu
              menuItems={createKnowledgeMenuItems(knowledgeBase, { onRename: () => setEditDialogOpen(true), onDelete: handleDelete })}
            >
              <CollapsibleKnowledgeInfo knowledgeBase={knowledgeBase} documentsCount={documents.length} />
            </ContextMenu>
          </div>

          {/* 文档列表 */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">包含的文档</h2>
              <div className="flex items-center gap-2">
                <IconButton icon={FilePlus2} onClick={handleAddDocument} title="添加文档" />
                <IconButton icon={RotateCcw} onClick={() => setRebuildDialogOpen(true)} title="重建索引" />
              </div>
            </div>

            {documents.length === 0 ? (
              <div className="flex items-center justify-center h-60">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <FolderOpen className="h-7 w-7 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mb-1">
                    暂无文档
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-500">
                    通过右上角按钮添加文档到知识库
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200/60 rounded-lg border border-slate-200/70 bg-white dark:divide-slate-800/60 dark:border-slate-700/60 dark:bg-slate-900/50">
                {documents.map((doc) => (
                  <ResourceItem
                    key={doc.id}
                    id={doc.id}
                    title={doc.name || "未命名文档"}
                    filePath={doc.filePath}
                    fileType={doc.fileType}
                    fileSize={doc.fileSize || 0}
                    createdAt={doc.createdAt || ""}
                    updatedAt={doc.updatedAt || ""}
                    isIndexed={doc.isIndexed ?? false}
                    chunkCount={typeof doc.chunkCount === 'number' ? doc.chunkCount : undefined}
                    onView={() => handleViewDocument(doc.id)}
                    onDelete={() => handleRemoveDocument(doc.id)}
                    hideIndexedStatus={true}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 编辑知识库对话框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editType === 'rename' ? '重命名知识库' : '编辑知识库详情'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input
                value={editForm.name}
                onChange={(e) => handleFormChange('name', e.target.value)}
                placeholder="知识库名称"
              />
            </div>
            {editType === 'details' && (
              <div>
                <label className="text-sm font-medium">描述</label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  placeholder="知识库描述"
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重建索引对话框 */}
      <AlertDialog open={rebuildDialogOpen} onOpenChange={setRebuildDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新构建索引</AlertDialogTitle>
            <AlertDialogDescription asChild>
            {rebuildProgress === null ? (
              <p>确认要重新构建该知识库的全部索引吗？这可能需要一些时间。</p>
            ) : (
              <div className="space-y-2">
                <p>{rebuildMessage}</p>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                    style={{ width: `${rebuildProgress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500">{rebuildProgress}%</p>
              </div>
            )}
          </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {rebuildProgress === null ? (
              <>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleRebuildKnowledgeBase}>开始重建</AlertDialogAction>
              </>
            ) : (
              <Button disabled variant="outline">正在重建...</Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          {/* 右上角关闭按钮 */}
          <button
            onClick={() => setDeleteDialogOpen(false)}
            className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 cursor-pointer"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <AlertDialogHeader className="pr-8">
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteType === 'knowledge-base' 
                ? `确定要删除知识库 "${itemToDelete?.name}" 吗？此操作不可恢复。`
                : `确定要从知识库中移除文档 "${itemToDelete?.name}" 吗？`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddDocumentsDialog
        open={addDocsOpen}
        onOpenChange={setAddDocsOpen}
        knowledgeBase={knowledgeBase}
        onSuccess={loadDocuments}
      />
    </>
  );
} 