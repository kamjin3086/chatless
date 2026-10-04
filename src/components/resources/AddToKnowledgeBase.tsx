'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertCircle, FileText, Brain, Database } from "lucide-react";
import { KnowledgeService, KnowledgeBase } from '@/lib/knowledgeService';
import { toast } from '@/components/ui/sonner';
import { truncateDisplayName } from '@/lib/filesystem/safeFileName';

interface AddToKnowledgeBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentTitle: string;
  onSuccess?: () => void;
  preSelectedKnowledgeBaseId?: string;
}

export function AddToKnowledgeBase({
  open,
  onOpenChange,
  documentId,
  documentTitle,
  onSuccess,
  preSelectedKnowledgeBaseId
}: AddToKnowledgeBaseProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string | null>(preSelectedKnowledgeBaseId || null);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  // 加载知识库列表
  useEffect(() => {
    async function loadKnowledgeBases() {
      try {
        setLoading(true);
        const kbs = await KnowledgeService.getAllKnowledgeBases();
        setKnowledgeBases(kbs);
        setError(null);
      } catch (error) {
        console.error('加载知识库列表失败:', error);
        setError('无法加载知识库列表');
      } finally {
        setLoading(false);
      }
    }

    if (open) {
      loadKnowledgeBases();
    }
  }, [open]);

  // 选择知识库
  const handleSelect = (knowledgeBaseId: string) => {
    setSelectedKnowledgeBaseId(knowledgeBaseId === selectedKnowledgeBaseId ? null : knowledgeBaseId);
  };

  // 确认添加文档到知识库
  const handleConfirm = async () => {
    if (!selectedKnowledgeBaseId) {
      toast.error('请先选择一个知识库');
      return;
    }

    try {
      setAdding(true);
      setProgress(0);
      setProgressMessage('开始处理...');
      
      const result = await KnowledgeService.addDocumentToKnowledgeBase(
        documentId, 
        selectedKnowledgeBaseId,
        {
          onProgress: (progressPercent: number, message: string) => {
            setProgress(progressPercent);
            setProgressMessage(message);
            console.log(`进度: ${progressPercent}% - ${message}`);
          }
        }
      );
      
      if (result) {
        const chunksInfo = result.chunksProcessed ? ` (${result.chunksProcessed} 个片段)` : '';
        toast.success(`文档已成功添加到知识库并完成索引${chunksInfo}`);
        
        // 显示索引结果详情
        if (result.indexingResult) {
          console.log('索引结果:', result.indexingResult);
          console.log(`处理时间: ${result.indexingResult.processingTime}ms`);
          console.log(`文档片段: ${result.indexingResult.chunksProcessed}个`);
        }
        
        setTimeout(() => {
          onOpenChange(false);
          if (onSuccess) {
            onSuccess();
          }
        }, 1500); // 延长显示时间让用户看到结果
      } else {
        toast.error('添加文档失败：无返回结果');
      }
    } catch (error) {
      console.error('添加文档到知识库失败:', error);
      
      // 根据错误类型显示不同的提示
      let errorMessage = '添加文档失败';
      if (error instanceof Error) {
        if (error.message.includes('嵌入服务')) {
          errorMessage = '嵌入服务未配置或连接失败，请检查设置';
        } else if (error.message.includes('文档不存在')) {
          errorMessage = '文档文件不存在，请重新上传';
        } else if (error.message.includes('索引失败')) {
          errorMessage = '文档索引处理失败，请重试';
        } else {
          errorMessage = error.message;
        }
      }
      
      toast.error(errorMessage);
      setProgress(100);
      setProgressMessage('处理失败');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>添加到知识库</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {!adding ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 break-words">
              将文档 <span className="font-medium text-slate-700 dark:text-slate-300" title={documentTitle}>"{truncateDisplayName(documentTitle, 56)}"</span> 添加到以下知识库:
            </p>
          ) : (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  {progress < 20 && <FileText className="h-4 w-4 text-blue-500" />}
                  {progress >= 20 && progress < 90 && <Brain className="h-4 w-4 text-orange-500 animate-pulse" />}
                  {progress >= 90 && <Database className="h-4 w-4 text-green-500" />}
                  <span className="text-sm font-medium">正在索引文档...</span>
                </div>
                <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="mb-2" />
              <p className="text-xs text-slate-500 dark:text-slate-400">{progressMessage}</p>
            </div>
          )}

          {!adding && loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !adding && error ? (
            <div className="flex items-center gap-2 text-destructive bg-destructive/10 p-4 rounded-md">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          ) : !adding && knowledgeBases.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-4 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center">
                <Database className="w-6 h-6 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">暂无知识库，请先创建知识库</p>
              <Button 
                onClick={() => {
                  onOpenChange(false);
                  // 导航到知识库页面
                  window.location.href = '/knowledge';
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow-md transition-all duration-200 px-4 py-2 rounded-lg font-medium"
              >
                创建知识库
              </Button>
            </div>
          ) : !adding ? (
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2">
              {knowledgeBases.map((kb) => (
                <div
                  key={kb.id}
                  className={`p-3 rounded-md border cursor-pointer transition-colors ${
                    selectedKnowledgeBaseId === kb.id
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                  }`}
                  onClick={() => handleSelect(kb.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{kb.name}</h3>
                      {kb.description && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-1 mt-1">
                          {kb.description}
                        </p>
                      )}
                    </div>
                    {selectedKnowledgeBaseId === kb.id && (
                      <CheckCircle2 className="h-5 w-5 text-blue-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button 
            variant="dialogSecondary" 
            onClick={() => onOpenChange(false)}
            disabled={adding}
          >
            {adding ? '处理中...' : '取消'}
          </Button>
          <Button 
            variant="dialogPrimary"
            onClick={handleConfirm} 
            disabled={!selectedKnowledgeBaseId || adding || loading}
          >
            {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {adding ? '索引中...' : '确认添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 