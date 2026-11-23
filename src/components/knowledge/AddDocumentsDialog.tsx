import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Loader2, FileText, Database, AlertCircle, MessageSquare } from 'lucide-react';
import { listKnowledgeDocumentChoices, type KnowledgeDocumentChoice } from '@/lib/knowledgeDocumentChoices';
import { KnowledgeService, type KnowledgeBase, type KnowledgeIndexProgress } from '@/lib/knowledgeService';
import { toast } from '@/components/ui/sonner';
import { truncateDisplayName } from '@/lib/filesystem/safeFileName';
import { getHtmlLang, translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';
import { formatKnowledgeIndexProgress } from './formatKnowledgeIndexProgress';

interface AddDocumentsDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  knowledgeBase: KnowledgeBase;
  onSuccess?: () => void;
}

type DisplayFile = KnowledgeDocumentChoice;

export function AddDocumentsDialog({ open, onOpenChange, knowledgeBase, onSuccess }: AddDocumentsDialogProps) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const language = getHtmlLang(locale);
  const [files, setFiles] = useState<DisplayFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [progressUpdate, setProgressUpdate] = useState<
    KnowledgeIndexProgress | { fileName: string } | 'complete' | null
  >(null);

  // 加载所有可用文档
  useEffect(() => {
    if (!open) return;
    
    async function loadAllFiles() {
      try {
        setLoading(true);
        setError(null);
        
        setFiles(await listKnowledgeDocumentChoices(knowledgeBase.id));
        
      } catch (error) {
        console.error('加载文件失败:', error);
        setError('knowledge.import.loadFilesFailed');
      } finally {
        setLoading(false);
      }
    }
    
    loadAllFiles();
  }, [open, knowledgeBase.id]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const newSet = new Set(prev);
      newSet.has(id) ? newSet.delete(id) : newSet.add(id);
      return newSet;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) {
      toast.error(t('knowledge.import.selectFiles'));
      return;
    }

    try {
      setAdding(true);
      const selectedIds = Array.from(selected);
      
      for (let i = 0; i < selectedIds.length; i++) {
        const selectedId = selectedIds[i];
        const file = files.find(f => f.id === selectedId);
        
        if (!file) continue;
        
        setProgressUpdate({ fileName: file.name });
        
        // Both upload and chat choices carry durable document IDs and bytes.
        await KnowledgeService.addDocumentToKnowledgeBase(selectedId, knowledgeBase.id, {
          onProgress: (p, update) => {
            const base = (i / selectedIds.length) * 100;
            const segment = p / selectedIds.length;
            setProgress(Math.min(99, Math.round(base + segment)));
            setProgressUpdate(update);
          }
        });
      }

      setProgress(100);
      setProgressUpdate('complete');
      toast.success(t('knowledge.import.addedDocuments'));
      
      if (onSuccess) onSuccess();
      onOpenChange(false);
      
    } catch (error) {
      console.error('添加过程出错:', error);
      toast.error(t('knowledge.import.addFailed'));
    } finally {
      setAdding(false);
      setProgress(0);
      setProgressUpdate(null);
      setSelected(new Set());
    }
  };

  const getFileIcon = (file: DisplayFile) => {
    if (file.type === 'chat') {
      return <MessageSquare className="h-4 w-4 text-blue-500" />;
    }
    return <FileText className="h-4 w-4 text-slate-500" />;
  };

  const getFileLabel = (file: DisplayFile) => {
    if (file.type === 'chat') {
      return (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm truncate text-slate-800 dark:text-slate-200 min-w-0 flex-1" title={file.name}>
            {truncateDisplayName(file.name)}
          </span>
          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-md dark:bg-blue-900/30 dark:text-blue-400">
            💬 {t('knowledge.import.chatFile')}
          </span>
        </div>
      );
    }
    
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm truncate text-slate-800 dark:text-slate-200 min-w-0 flex-1" title={file.name}>
          {truncateDisplayName(file.name)}
        </span>
        {file.isAlreadyInKB && (
          <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-md dark:bg-green-900/30 dark:text-green-400">
            {t('knowledge.import.alreadyAdded')}
          </span>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-xl max-h-[80vh] overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-xl dark:bg-slate-900">
        <DialogHeader className="border-b border-slate-100/80 dark:border-slate-800/60 pb-3 bg-gradient-to-b from-slate-50/50 to-transparent dark:from-slate-900/30">
          <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('knowledge.import.addDocumentsTitle')}</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{t(error)}</span>
            </div>
          ) : adding ? (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Database className="h-4 w-4 text-blue-500" />
                {progressUpdate === 'complete'
                  ? t('knowledge.import.complete')
                  : !progressUpdate
                    ? t('knowledge.import.addingDocuments')
                    : 'fileName' in progressUpdate
                      ? t('knowledge.import.processingFile').replace('{0}', () => progressUpdate.fileName)
                      : formatKnowledgeIndexProgress(locale, progressUpdate)}
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
              {files.map(file => (
                <label 
                  key={file.id} 
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors min-w-0"
                >
                  <Checkbox 
                    checked={selected.has(file.id)} 
                    onCheckedChange={() => toggle(file.id)}
                    className="border-slate-300 dark:border-slate-600 shrink-0"
                  />
                  <span className="shrink-0">{getFileIcon(file)}</span>
                  <span className="min-w-0 flex-1">{getFileLabel(file)}</span>
                </label>
              ))}
              {files.length === 0 && (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('knowledge.import.noFiles')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-100/80 dark:border-slate-800/60 pt-4 bg-gradient-to-t from-slate-50/30 to-transparent dark:from-slate-900/20">
          <Button variant="dialogSecondary" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-lg">{t('common.cancel')}</Button>
          <Button variant="dialogPrimary" onClick={handleConfirm} disabled={adding || selected.size === 0} className="rounded-lg shadow-sm">
            {selected.size > 0
              ? t('knowledge.import.confirmAddCount').replace('{0}', selected.size.toLocaleString(language))
              : t('knowledge.import.confirmAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 