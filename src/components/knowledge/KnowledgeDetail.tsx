"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Loader2, ArrowLeft, Trash2, FileText, MessageSquarePlus, FilePlus2, RotateCcw, MoreVertical, Edit3, FileEdit, FolderOpen } from "lucide-react";
import { KnowledgeService, type KnowledgeBase, type KnowledgeIndexProgress } from "@/lib/knowledgeService";
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
import { useLocaleStore } from '@/store/localeStore';
import { getHtmlLang, translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { formatKnowledgeIndexProgress } from './formatKnowledgeIndexProgress';

interface KnowledgeDetailProps {
  knowledgeBase?: KnowledgeBase;
  onBack?: () => void;
  onRefresh?: () => void;
}

export function KnowledgeDetail({ knowledgeBase: propKnowledgeBase, onBack, onRefresh }: KnowledgeDetailProps) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const language = getHtmlLang(locale);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(propKnowledgeBase || null);
  const [documents, setDocuments] = useState<Array<UnifiedFile & Partial<Awaited<ReturnType<typeof KnowledgeService.getDocumentStats>>>>>([]);
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
  const [rebuildUpdate, setRebuildUpdate] = useState<KnowledgeIndexProgress | null>(null);
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
        toast.error(translate(useLocaleStore.getState().locale, 'knowledge.toast.notFound'));
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
      toast.error(translate(useLocaleStore.getState().locale, 'knowledge.detail.loadFailed'));
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
      const { semanticIndexQueue } = await import('@/lib/indexing/SemanticIndexQueue');
      const progressRevision = semanticIndexQueue.getRevision();
      const documentsWithMappings = await KnowledgeService.getDocumentsInKnowledgeBase(knowledgeBase.id);
      
      // 为每个文档查询分片数量
      const docsWithChunk = await Promise.all(
        documentsWithMappings.map(async (item) => {
          const stats = await KnowledgeService.getDocumentStats(knowledgeBase.id, item.document.id);
          return { ...item.document, ...stats };
        })
      );

      // If progress changed while the initial list loaded, recheck those
      // snapshots once rather than overwriting a newer completion event.
      const changed = semanticIndexQueue.getRevision() !== progressRevision;
      setDocuments(changed ? docsWithChunk.map((doc) => ({ ...doc, indexTaskStatus: 'pending' })) : docsWithChunk);
      const status = await KnowledgeService.getKnowledgeBaseIndexStatus(knowledgeBase.id);
      setIndexStatus(status);
      console.log(`[KnowledgeDetail] 加载到 ${docsWithChunk.length} 个文档`);
    } catch (error) {
      console.error('加载文档失败:', error);
      setDocuments([]);
    }
  }, [knowledgeBase]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void import('@/lib/indexing/SemanticIndexQueue').then(({ semanticIndexQueue }) => {
      if (active) unsubscribe = semanticIndexQueue.subscribe((documentId) => {
        setDocuments((current) => documentId && !current.some((doc) => doc.id === documentId) ? current :
          current.map((doc) => !documentId || doc.id === documentId ? { ...doc, indexTaskStatus: 'pending' } : doc));
      });
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  // Refresh only active work. Terminal/cancelled/waiting-model tasks do not
  // keep an idle knowledge page polling, and hidden windows do no work.
  useEffect(() => {
    const pending = documents.filter((doc) => doc.indexTaskStatus === 'pending' || doc.indexTaskStatus === 'running');
    if (!knowledgeBase || !pending.length) return;
    let active = true;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const updates = await Promise.all(pending.map(async (doc) => [doc.id, await KnowledgeService.getDocumentStats(knowledgeBase.id, doc.id)] as const));
        const byId = new Map(updates);
        if (active) setDocuments((current) => current.map((doc) => byId.has(doc.id) ? { ...doc, ...byId.get(doc.id) } : doc));
      } finally { inFlight = false; }
    }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [documents, knowledgeBase]);

  /**
   * Semantic indexing is optional: keyword search works without a model. These
   * actions cover the two states a user can act on — retry after a failure or
   * after configuring a model, and cancel work that is still queued.
   */
  const handleRetrySemantic = useCallback(async (documentId: string) => {
    const { semanticIndexQueue } = await import('@/lib/indexing/SemanticIndexQueue');
    await semanticIndexQueue.retryForDocument(documentId);
    await loadDocuments();
  }, [loadDocuments]);

  const handleCancelSemantic = useCallback(async (documentId: string) => {
    const { semanticIndexQueue } = await import('@/lib/indexing/SemanticIndexQueue');
    await semanticIndexQueue.cancelForDocument(documentId);
    await loadDocuments();
  }, [loadDocuments]);

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
        toast.error(t('knowledge.detail.documentMissing'));
        return;
      }
      
      // 使用系统默认程序打开文档
      await FileOpener.openFile(file.filePath, file.name);
    } catch (error) {
      console.error('查看文档失败:', error);
      toast.error(t('knowledge.detail.viewFailed'));
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
        toast.success(t('knowledge.toast.saved'));
        setEditDialogOpen(false);
      } else {
        toast.error(t('knowledge.toast.saveFailed'));
      }
    } catch (error) {
      console.error('更新知识库失败:', error);
      toast.error(t('knowledge.toast.saveFailed'));
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
      toast.info(t('knowledge.detail.downloadUnavailable'));
    } catch (error) {
      console.error('下载文档失败:', error);
      toast.error(t('knowledge.detail.downloadFailed'));
    }
  };

  // 从知识库中移除文档
  const handleRemoveDocument = async (documentId: string) => {
    const doc = documents.find(d => d.id === documentId);
    if (!doc) return;

    setDeleteType('document');
    setItemToDelete({ id: documentId, name: doc.name || '' });
    setDeleteDialogOpen(true);
  };

  // 确认删除操作
  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;

    try {
      if (deleteType === 'knowledge-base') {
        const success = await KnowledgeService.deleteKnowledgeBase(itemToDelete.id);

        if (success) {
          toast.success(t('knowledge.toast.deleted'));
          handleBack();
        } else {
          toast.error(t('knowledge.toast.deleteFailed'));
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
          toast.success(t('knowledge.detail.documentRemoved'));
        } else {
          toast.error(t('knowledge.detail.removeDocumentFailed'));
        }
      }
    } catch (error) {
      console.error('删除操作失败:', error);
      toast.error(t('knowledge.toast.deleteFailed'));
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
        onProgress: (p, update) => {
          setRebuildProgress(p);
          setRebuildUpdate(update);
        }
      });
      toast.success(t('knowledge.index.rebuildComplete'));
      // 重载文档列表
      loadDocuments();
    } catch (error) {
      console.error('重建知识库失败:', error);
      toast.error(t('knowledge.index.rebuildFailed'));
    } finally {
      setRebuildDialogOpen(false);
      setRebuildProgress(null);
      setRebuildUpdate(null);
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
    toast.success(t('knowledge.toast.enabledInChat'));
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
          <p className="text-sm text-slate-500">{t('knowledge.detail.loading')}</p>
        </div>
      </div>
    );
  }

  if (!knowledgeBase) {
    console.log('[KnowledgeDetail] 知识库数据为空，显示错误状态');
    return (
      <div className="flex items-center justify-center w-full h-full p-12">
        <div className="text-center">
          <p className="text-lg text-slate-500 mb-2">{t('knowledge.detail.loadFailed')}</p>
          <Button onClick={handleBack} variant="outline">{t('knowledge.detail.back')}</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden shadow-lg h-full flex flex-col glass-panel">
        {/* 头部 */}
        <div className="app-topbar flex h-12 shrink-0 items-center justify-between border-b border-slate-200/70 px-4 sm:px-5 dark:border-slate-700/60">
          <div className="flex items-center gap-2 sm:gap-3">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleBack} aria-label={t('knowledge.detail.back')} className="text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary cursor-pointer">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('knowledge.detail.back')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex flex-col">
              <h2 className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-100">{knowledgeBase.name}</h2>
            </div>
          </div>
          <TooltipProvider delayDuration={100}>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton icon={MessageSquarePlus} onClick={handleUse} title={t('knowledge.detail.useInChat')} />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('knowledge.detail.useInChatHint')}</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        aria-label={t('knowledge.detail.moreActions')}
                        className="text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-primary focus:outline-none focus:ring-0 focus:ring-offset-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                
                </Tooltip>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleRename}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    {t('knowledge.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleEditDetails}>
                    <FileEdit className="h-4 w-4 mr-2" />
                    {t('knowledge.detail.editDetails')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleDelete}
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('knowledge.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TooltipProvider>
        </div>

        {indexStatus?.needsRebuild && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-amber-900 dark:text-amber-100">
              <p className="font-medium">{t('knowledge.index.rebuildNeeded')}</p>
              <p className="text-xs opacity-80 mt-0.5">
                {t('knowledge.index.summary')
                  .replace('{pending}', indexStatus.pending.toLocaleString(language))
                  .replace('{failed}', indexStatus.failed.toLocaleString(language))
                  .replace('{indexed}', indexStatus.indexed.toLocaleString(language))
                  .replace('{total}', indexStatus.total.toLocaleString(language))}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setRebuildDialogOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-1" />
              {t('knowledge.index.rebuild')}
            </Button>
          </div>
        )}

        {/* 内容区域 */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          {/* 知识库信息 */}
          <div className="mb-8">
            <h2 className="text-base font-semibold mb-3 text-slate-700 dark:text-slate-300">{t('knowledge.detail.information')}</h2>
            <ContextMenu
              menuItems={createKnowledgeMenuItems(knowledgeBase, locale, { onRename: () => setEditDialogOpen(true), onDelete: handleDelete })}
            >
              <CollapsibleKnowledgeInfo knowledgeBase={knowledgeBase} documentsCount={documents.length} />
            </ContextMenu>
          </div>

          {/* 文档列表 */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('knowledge.detail.documents')}</h2>
              <div className="flex items-center gap-2">
                <IconButton icon={FilePlus2} onClick={handleAddDocument} title={t('knowledge.import.addDocuments')} />
                <IconButton icon={RotateCcw} onClick={() => setRebuildDialogOpen(true)} title={t('knowledge.index.rebuild')} />
              </div>
            </div>

            {documents.length === 0 ? (
              <div className="flex items-center justify-center h-60">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800/50">
                    <FolderOpen className="h-7 w-7 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mb-1">
                    {t('knowledge.detail.emptyDocuments')}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-500">
                    {t('knowledge.detail.emptyDocumentsHint')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200/60 rounded-lg border border-slate-200/70 bg-white dark:divide-slate-800/60 dark:border-slate-700/60 dark:bg-slate-900/50">
                {documents.map((doc) => (
                  <ResourceItem
                    key={doc.id}
                    id={doc.id}
                    title={doc.name || t('knowledge.detail.unnamedDocument')}
                    filePath={doc.filePath}
                    fileType={doc.fileType}
                    fileSize={doc.fileSize || 0}
                    createdAt={doc.createdAt || ""}
                    updatedAt={doc.updatedAt || ""}
                    isIndexed={doc.isIndexed ?? false}
                    chunkCount={typeof doc.chunkCount === 'number' ? doc.chunkCount : undefined}
                    lexicalStatus={(doc as any).lexicalStatus}
                    semanticStatus={(doc as any).semanticStatus}
                    onView={() => handleViewDocument(doc.id)}
                    onDelete={() => handleRemoveDocument(doc.id)}
                    onRetrySemantic={handleRetrySemantic}
                    onCancelSemantic={doc.semanticTaskStatus && ['pending', 'running', 'waiting_model'].includes(doc.semanticTaskStatus) ? handleCancelSemantic : undefined}
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
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>
              {t(editType === 'rename' ? 'knowledge.detail.renameTitle' : 'knowledge.edit.title')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t('knowledge.field.name')}</label>
              <Input
                value={editForm.name}
                onChange={(e) => handleFormChange('name', e.target.value)}
                placeholder={t('knowledge.field.name')}
              />
            </div>
            {editType === 'details' && (
              <div>
                <label className="text-sm font-medium">{t('knowledge.description')}</label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  placeholder={t('knowledge.field.description')}
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEdit}>
              {t('knowledge.edit.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重建索引对话框 */}
      <AlertDialog open={rebuildDialogOpen} onOpenChange={setRebuildDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('knowledge.index.rebuildTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
            {rebuildProgress === null ? (
              <p>{t('knowledge.index.rebuildDescription')}</p>
            ) : (
              <div className="space-y-2">
                <p>{rebuildUpdate ? formatKnowledgeIndexProgress(locale, rebuildUpdate) : t('knowledge.index.rebuilding')}</p>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                    style={{ width: `${rebuildProgress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">{rebuildProgress}%</p>
              </div>
            )}
          </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {rebuildProgress === null ? (
              <>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleRebuildKnowledgeBase}>{t('knowledge.index.startRebuild')}</AlertDialogAction>
              </>
            ) : (
              <Button disabled variant="outline">{t('knowledge.index.rebuilding')}</Button>
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
            className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 cursor-pointer"
            aria-label={t('common.close')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <AlertDialogHeader className="pr-8">
            <AlertDialogTitle>{t(deleteType === 'knowledge-base' ? 'knowledge.delete.title' : 'knowledge.detail.removeDocumentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteType === 'knowledge-base' 
                ? t('knowledge.delete.description').replace('{0}', () => itemToDelete?.name ?? '')
                : t('knowledge.detail.removeDocumentDescription').replace('{0}', () => itemToDelete?.name || t('knowledge.detail.unnamedDocument'))
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              {t(deleteType === 'knowledge-base' ? 'knowledge.delete' : 'knowledge.resource.remove')}
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
