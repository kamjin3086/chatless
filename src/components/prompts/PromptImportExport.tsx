"use client";

import { useRef } from 'react';
import { toast } from '@/components/ui/sonner';
import { usePromptStore } from '@/store/promptStore';
import { Download, Upload } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { downloadService } from '@/lib/utils/downloadService';
import { getHtmlLang } from '@/i18n';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';

export function PromptImportExport() {
  const t = useTranslation();
  const language = getHtmlLang(useLocaleStore((state) => state.locale));
  const inputRef = useRef<HTMLInputElement>(null);
  const importPrompts = usePromptStore((s) => s.importPrompts);
  const exportPrompts = usePromptStore((s) => s.exportPrompts);

  const handleImportClick = () => inputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 检查文件格式
    const allowedExtensions = ['.json', '.csv'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (!allowedExtensions.includes(fileExtension)) {
      toast.error(t('prompts.import.unsupportedFormat'), {
        description: t('prompts.import.selectFormat'),
      });
      return;
    }

    try {
      const text = await file.text();
      let data: any;
      
      if (fileExtension === '.json') {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          toast.error(t('prompts.import.invalidJson'), {
            description: t('prompts.import.checkJson'),
          });
          return;
        }
      } else if (fileExtension === '.csv') {
        // 简单 CSV 支持：name,content,tags
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) {
          toast.error(t('prompts.import.invalidCsv'), {
            description: t('prompts.import.csvRows'),
          });
          return;
        }
        
        const headers = lines.shift()!.split(',').map((s) => s.trim());
        const requiredHeaders = ['name', 'content'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        
        if (missingHeaders.length > 0) {
          toast.error(t('prompts.import.missingCsvFields'), {
            description: t('prompts.import.requiredCsvFields').replace('{0}', missingHeaders.join(', ')),
          });
          return;
        }
        
        data = lines.map((line) => {
          const parts = line.split(',');
          const record: any = {};
          headers.forEach((h, i) => (record[h] = parts[i] || ''));
          if (record.tags) record.tags = String(record.tags).split(';').map((s: string) => s.trim()).filter(Boolean);
          if (record.shortcuts) record.shortcuts = String(record.shortcuts).split(';').map((s: string) => s.trim()).filter(Boolean);
          return record;
        });
      }
      
      const arr = Array.isArray(data?.prompts) ? data.prompts : Array.isArray(data) ? data : [];
      
      if (arr.length === 0) {
        toast.error(t('prompts.import.emptyFile'), {
          description: t('prompts.import.noValidPrompts'),
        });
        return;
      }
      
      // 规范化 shortcuts
      arr.forEach((it:any)=>{ 
        if (Array.isArray(it?.shortcuts)) {
          it.shortcuts = Array.from(new Set(it.shortcuts.map((s:any)=>String(s).replace(/^[#/]/,'').toLowerCase()).filter(Boolean)));
        }
      });
      
      const result = importPrompts(arr);
      toast.success(t('prompts.import.complete')
        .replace('{0}', result.created.toLocaleString(language))
        .replace('{1}', result.updated.toLocaleString(language))
        .replace('{2}', result.skipped.toLocaleString(language)));
    } catch (e: any) {
      toast.error(t('prompts.import.failed'), { description: e?.message || t('prompts.import.parseFailed') });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    try {
      const data = { 
        version: 1, 
        exportedAt: new Date().toISOString(),
        promptCount: exportPrompts().length,
        prompts: exportPrompts() 
      };
      
      const fileName = `prompts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
      const success = await downloadService.downloadJson(fileName, data);
      
      if (success) {
        toast.success(t('prompts.export.complete'));
      }
      // 用户取消时不显示任何提示，静默处理
    } catch (error) {
      console.error('导出提示词失败:', error);
      toast.error(t('prompts.export.failed'), { description: t('prompts.export.error') });
    }
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5">
        <input 
          ref={inputRef} 
          type="file" 
          accept=".json,.csv,application/json,text/csv" 
          className="hidden" 
          onChange={handleFileChange} 
        />
        
        <Tooltip>
          <TooltipTrigger asChild>
            <button 
              onClick={handleImportClick}
              className="h-7 px-2 text-xs text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors flex items-center gap-1"
            >
              <Upload className="w-3.5 h-3.5" />
              {t('prompts.import')}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            <div className="space-y-1">
              <div className="font-medium">{t('prompts.import.title')}</div>
              <div>{t('prompts.import.supportedFormats')}</div>
            </div>
          </TooltipContent>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <button 
              onClick={handleExport}
              className="h-7 px-2 text-xs text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              {t('prompts.export')}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {t('prompts.export.format')}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

