"use client";

import { useRef } from 'react';
import { toast } from '@/components/ui/sonner';
import { usePromptStore } from '@/store/promptStore';
import { Download, Upload } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { downloadService } from '@/lib/utils/downloadService';

export function PromptImportExport() {
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
      toast.error('不支持的文件格式', { 
        description: `请选择 ${allowedExtensions.join(' 或 ')} 格式的文件` 
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
          toast.error('JSON文件格式错误', { 
            description: '请检查JSON文件格式是否正确' 
          });
          return;
        }
      } else if (fileExtension === '.csv') {
        // 简单 CSV 支持：name,content,tags
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) {
          toast.error('CSV文件格式错误', { 
            description: 'CSV文件至少需要包含标题行和一行数据' 
          });
          return;
        }
        
        const headers = lines.shift()!.split(',').map((s) => s.trim());
        const requiredHeaders = ['name', 'content'];
        const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
        
        if (missingHeaders.length > 0) {
          toast.error('CSV文件缺少必要字段', { 
            description: `CSV文件必须包含以下字段：${missingHeaders.join(', ')}` 
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
        toast.error('文件内容为空', { 
          description: '文件中没有找到有效的提示词数据' 
        });
        return;
      }
      
      // 规范化 shortcuts
      arr.forEach((it:any)=>{ 
        if (Array.isArray(it?.shortcuts)) {
          it.shortcuts = Array.from(new Set(it.shortcuts.map((s:any)=>String(s).replace(/^\//,'').toLowerCase()).filter(Boolean))); 
        }
      });
      
      const result = importPrompts(arr);
      toast.success(`导入完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`);
    } catch (e: any) {
      toast.error('导入失败', { description: e?.message || '文件解析失败' });
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
        toast.success('提示词已导出');
      }
      // 用户取消时不显示任何提示，静默处理
    } catch (error) {
      console.error('导出提示词失败:', error);
      toast.error('导出失败', { description: '导出过程中发生错误' });
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
              导入
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            <div className="space-y-1">
              <div className="font-medium">导入提示词</div>
              <div>支持 .json 和 .csv 格式</div>
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
              导出
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            导出为 .json 格式文件
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

