"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageTabs } from '@/components/ui/PageTabs';
import { ResourceManager } from '@/components/resources/ResourceManager';
import { UnifiedFileService } from '@/lib/unifiedFileService';
import { KnowledgeService, KnowledgeBase } from "@/lib/knowledgeService";
import { initializeSampleDataIfNeeded } from '@/lib/sampleDataInitializer';
import { Loader2, Database, Plus, FolderOpen } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useRouter } from "next/navigation";
import { KnowledgeBaseCard } from "@/components/knowledge/KnowledgeBaseCard";
import { CreateKnowledgeDialog } from '@/components/knowledge/CreateKnowledgeDialog';
import { EditKnowledgeDialog } from '@/components/knowledge/EditKnowledgeDialog';
import { KnowledgeBaseDetailDialog } from '@/components/knowledge/KnowledgeBaseDetailDialog';
import { RecentUsedList } from "@/components/ui/RecentUsedList";
import { RAGQueryInterface } from "@/components/knowledge/RAGQueryInterface";
import { AlertDialog, AlertDialogHeader, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { motion } from "framer-motion";
import { cn } from '@/lib/utils';

// 扩展知识库类型，添加文档数量
interface KnowledgeBaseWithCount extends KnowledgeBase {
  documentCount: number;
}

const tabs = [
  { id: 'resources', label: '资源', icon: <FolderOpen className="w-4 h-4" /> },
  { id: 'knowledge', label: '知识库', icon: <Database className="w-4 h-4" /> },
];

export default function KnowledgePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Tab 状态，支持 URL 参数
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabParam = searchParams.get('tab');
    return tabParam === 'resources' || tabParam === 'knowledge' ? tabParam : 'resources';
  });

  // 资源页状态
  const [fileCount, setFileCount] = useState(0);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // 知识库页状态
  const [knowledgeSubTab, setKnowledgeSubTab] = useState('my'); // 'my', 'query'
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseWithCount[]>([]);
  const [isLoadingKB, setIsLoadingKB] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteKbDialogOpen, setDeleteKbDialogOpen] = useState(false);
  const [kbToDelete, setKbToDelete] = useState<KnowledgeBase | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [kbEditing, setKbEditing] = useState<KnowledgeBase | null>(null);
  
  // 详情对话框状态
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailKb, setDetailKb] = useState<KnowledgeBaseWithCount | null>(null);
  
  const hasInitializedRef = useRef(false);

  // URL 参数同步
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'resources' || tabParam === 'knowledge') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // 资源页：加载文件统计
  const loadFileStatistics = async () => {
    try {
      const stats = await UnifiedFileService.getFileStatistics();
      setFileCount(stats.total);
    } catch (error) {
      console.error('加载文件统计失败:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleResourceManagerRefresh = async () => {
    await loadFileStatistics();
  };

  // 知识库页：加载知识库
  const loadKnowledgeBases = useCallback(async () => {
    try {
      setIsLoadingKB(true);
      
      const kbs = await KnowledgeService.getAllKnowledgeBases();
      const allFiles = await UnifiedFileService.getAllFiles();
      
      if (kbs.length === 0 && allFiles.length === 0 && !hasInitializedRef.current) {
        hasInitializedRef.current = true;
        try {
          await initializeSampleDataIfNeeded(() => {});
          const updatedKbs = await KnowledgeService.getAllKnowledgeBases();
          kbs.push(...updatedKbs);
        } catch (initError) {
          console.warn('示例数据初始化失败:', initError);
        }
      }
      
      const kbsWithCounts: KnowledgeBaseWithCount[] = await Promise.all(
        kbs.map(async (kb) => {
          try {
            const stats = await KnowledgeService.getKnowledgeBaseStats(kb.id);
            return { ...kb, documentCount: stats.documentCount };
          } catch {
            return { ...kb, documentCount: 0 };
          }
        })
      );
      
      setKnowledgeBases(kbsWithCounts);
    } catch (error) {
      console.error('加载知识库失败:', error);
      setKnowledgeBases([]);
    } finally {
      setIsLoadingKB(false);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadFileStatistics();
    loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  // 知识库操作
  const handleCardClick = (kb: KnowledgeBase & { documentCount?: number }) => {
    setDetailKb({ ...kb, documentCount: kb.documentCount ?? 0 });
    setDetailDialogOpen(true);
  };

  const handleManageKnowledgeBase = (id: string) => {
    router.push(`/knowledge/detail?id=${id}`);
  };

  const handleUseKnowledgeBase = (id: string) => {
    toast.info('知识库启用成功', {
      description: '已在聊天中启用该知识库'
    });
    router.push(`/chat?knowledgeBase=${id}`);
  };

  const createKnowledgeBase = async (name: string, description: string) => {
    const kb = await KnowledgeService.createKnowledgeBase(name, description, 'database', false);
    setKnowledgeBases(prev => [...prev, { ...kb, documentCount: 0 }]);
    toast.success('知识库创建成功');
  };

  const handleDeleteKnowledgeBase = (kb: KnowledgeBase) => {
    setKbToDelete(kb);
    setDeleteKbDialogOpen(true);
  };

  const confirmDeleteKb = async () => {
    if (!kbToDelete) return;
    try {
      await KnowledgeService.deleteKnowledgeBase(kbToDelete.id);
      setKnowledgeBases(prev => prev.filter(item => item.id !== kbToDelete.id));
      toast.success('知识库已删除');
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleteKbDialogOpen(false);
      setKbToDelete(null);
    }
  };

  const openEditDialog = (kb: KnowledgeBase) => {
    setKbEditing(kb);
    setEditDialogOpen(true);
  };

  const handleSaveEditKb = async (name: string, description: string) => {
    if (!kbEditing) return;
    try {
      const updated = await KnowledgeService.updateKnowledgeBase(kbEditing.id, { name, description });
      setKnowledgeBases(prev => prev.map(item => 
        item.id === kbEditing.id 
          ? { ...item, name: updated?.name ?? name, description: updated?.description ?? description }
          : item
      ));
      toast.success('已保存');
    } catch {
      toast.error('保存失败');
    }
  };

  // 筛选和排序知识库
  const filteredKnowledgeBases = knowledgeBases
    .filter(kb => activeFilter === 'all' || activeFilter === 'local')
    .sort((a, b) => {
      if (sortBy === 'recent') return b.updatedAt - a.updatedAt;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'docs') return b.documentCount - a.documentCount;
      return 0;
    });

  const recentKnowledgeBases = filteredKnowledgeBases.slice(0, 3).map(kb => ({
    id: kb.id,
    name: kb.name,
    icon: kb.icon || 'database',
    iconBg: 'from-gray-400 to-gray-600',
    source: '本地',
    docCount: kb.documentCount,
    description: kb.description || '',
    lastUpdated: new Date(kb.updatedAt).toLocaleString('zh-CN'),
    isEncrypted: kb.isEncrypted
  }));

  return (
    <div className="flex flex-col h-full bg-white/95 dark:bg-slate-900/95 overflow-hidden glass-surface">
      {/* 顶部 Tab */}
      <PageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'resources' ? (
          <ResourceManager 
            onRefresh={handleResourceManagerRefresh}
            totalFileCount={fileCount}
            isLoadingStats={isLoadingStats}
          />
        ) : (
          <div className="h-full flex flex-col">
            {/* 知识库子导航 */}
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/40 flex items-center justify-between">
              <div className="flex gap-1">
                {[
                  { id: 'my', label: '我的知识库' },
                  { id: 'query', label: '智能问答' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setKnowledgeSubTab(tab.id)}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded-md transition-colors",
                      knowledgeSubTab === tab.id
                        ? "bg-slate-200/50 dark:bg-white/10 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-white/10"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 border border-transparent"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              
              {knowledgeSubTab === 'my' && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none"
                  >
                    <option value="recent">最近更新</option>
                    <option value="name">名称</option>
                    <option value="docs">文档数量</option>
                  </select>
                  <button
                    onClick={() => setShowCreateDialog(true)}
                    className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新建
                  </button>
                </div>
              )}
            </div>

            {/* 知识库内容 */}
            <div className="flex-1 overflow-auto p-4">
              {isLoadingKB ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : knowledgeSubTab === 'query' ? (
                <RAGQueryInterface />
              ) : (
                <div className="space-y-6">
                  {filteredKnowledgeBases.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredKnowledgeBases.map((kb) => (
                        <KnowledgeBaseCard
                          key={kb.id}
                          kb={kb}
                          onClick={handleCardClick}
                          onManage={handleManageKnowledgeBase}
                          onDelete={handleDeleteKnowledgeBase}
                          onRename={openEditDialog}
                          onEditDesc={openEditDialog}
                        />
                      ))}
                    </div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col items-center justify-center py-12"
                    >
                      <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center mb-3">
                        <Database className="w-5 h-5 text-slate-400" />
                      </div>
                      <h3 className="text-xs font-medium text-slate-500 mb-0.5">暂无知识库</h3>
                      <p className="text-[11px] text-slate-400 mb-3">创建您的第一个知识库</p>
                      <button 
                        onClick={() => setShowCreateDialog(true)} 
                        className="h-7 px-3 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded border border-slate-200/60 dark:border-slate-700/40 transition-colors flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        创建知识库
                      </button>
                    </motion.div>
                  )}

                  {recentKnowledgeBases.length > 0 && filteredKnowledgeBases.length > 0 && (
                    <div className="mt-6 border-t border-slate-200/50 dark:border-slate-700/30 pt-3">
                      <RecentUsedList 
                        title="最近使用"
                        items={recentKnowledgeBases.map(kb => ({
                          id: kb.id,
                          name: kb.name,
                          iconType: 'database',
                          subtitle: `${kb.docCount} 文档`,
                          time: kb.lastUpdated,
                        }))}
                        onItemClick={handleUseKnowledgeBase}
                        emptyText="暂无"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 对话框 */}
      <CreateKnowledgeDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={createKnowledgeBase}
      />
      
      <AlertDialog open={deleteKbDialogOpen} onOpenChange={setDeleteKbDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除知识库</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除知识库 "{kbToDelete?.name}" 吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteKb}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <EditKnowledgeDialog 
        open={editDialogOpen} 
        kb={kbEditing} 
        onOpenChange={setEditDialogOpen} 
        onSave={handleSaveEditKb} 
      />
      
      {/* 知识库详情对话框 */}
      <KnowledgeBaseDetailDialog
        open={detailDialogOpen}
        onOpenChange={(o) => { setDetailDialogOpen(o); if (!o) setDetailKb(null); }}
        kb={detailKb}
        onManage={() => detailKb && handleManageKnowledgeBase(detailKb.id)}
        onRename={() => detailKb && openEditDialog(detailKb)}
        onEditDesc={() => detailKb && openEditDialog(detailKb)}
        onDelete={() => detailKb && handleDeleteKnowledgeBase(detailKb)}
      />
    </div>
  );
}
