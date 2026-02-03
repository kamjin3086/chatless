'use client';

import { useState, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Upload, Loader2, HardDriveUpload } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { ResourceUploaderProps } from './types';

export function ResourceUploader({ 
  onUploadSuccess, 
  displayType = 'button' 
}: ResourceUploaderProps) {
  const [uploading, setUploading] = useState(false);

  // 处理文件选择
  const handleFileSelect = useCallback(async (selectedFiles: FileList) => {
    if (selectedFiles.length === 0) return;
    
    console.log(`开始上传 ${selectedFiles.length} 个文件`);
    
    setUploading(true);
    try {
      const filesArray = Array.from(selectedFiles);
      console.log('准备上传的文件:', filesArray.map(f => ({ name: f.name, size: f.size, type: f.type })));
      
      // 串行上传文件以避免并发问题
      const uploadedFiles = [];
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        console.log(`正在上传文件 ${i + 1}/${filesArray.length}: ${file.name}`);
        
        try {
          // 使用统一文件服务上传
          const { UnifiedFileService } = await import('@/lib/unifiedFileService');
          
          const savedFile = await UnifiedFileService.saveFile(
            file,
            file.name,
            'upload', // 标记为手动上传
            {
              tags: ['手动上传'],
              note: `通过文件上传界面添加于 ${new Date().toLocaleDateString('zh-CN')}`
            }
          );
          
          uploadedFiles.push(savedFile);
          console.log(`文件上传成功: ${file.name} (ID: ${savedFile.id})`);
        } catch (fileError) {
          console.error(`❌ 文件上传失败: ${file.name}`, fileError);
          // 继续处理其他文件，不让一个文件的失败影响其他文件
        }
      }
      
      if (uploadedFiles.length > 0) {
        toast.success('文档上传成功', {
          description: `已成功上传 ${uploadedFiles.length} 个文档${filesArray.length > uploadedFiles.length ? `，${filesArray.length - uploadedFiles.length} 个文件上传失败` : ''}`,
        });
        
        console.log('所有文件处理完成，开始刷新资源列表...');
        // 调用成功回调，刷新资源列表
        onUploadSuccess();
      } else {
        toast.error('文档上传失败', {
          description: '所有文件上传都失败了，请检查文件类型和权限',
        });
      }
    } catch (error) {
      console.error('文档上传过程出错:', error);
      toast.error('文档上传失败', {
        description: '请检查文件类型和权限后重试',
      });
    } finally {
      setUploading(false);
    }
  }, [onUploadSuccess]);

  // 处理上传点击
  const handleUploadClick = useCallback(() => {
    // 创建隐藏的文件输入框
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '*.*'; // 接受所有文件类型
    fileInput.multiple = true;
    
    fileInput.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files) {
        handleFileSelect(target.files);
      }
    };
    
    fileInput.click();
  }, [handleFileSelect]);

  // 处理拖放
  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleFileSelect(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  }, [handleFileSelect]);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // 按钮版本
  if (displayType === 'button') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleUploadClick}
        disabled={uploading}
        className="flex items-center gap-2"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {uploading ? '上传中...' : '上传文件'}
      </Button>
    );
  }

  // 拖放区域版本
  return (
    <div 
      className={`border border-dashed border-slate-300/60 dark:border-slate-600/40 rounded-lg flex items-center justify-center p-3 cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-400/60 dark:hover:border-slate-500/50 transition-colors ${uploading ? 'opacity-70' : ''}`}
      onClick={uploading ? undefined : handleUploadClick}
      onDrop={uploading ? undefined : handleDrop}
      onDragOver={handleDragOver}
    >
      <input 
        type="file" 
        id="fileInput" 
        multiple 
        className="hidden" 
        onChange={(e) => e.target.files && handleFileSelect(e.target.files)} 
      />
      
      {uploading ? (
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
          <span className="text-xs text-slate-500">上传中...</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <HardDriveUpload className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500 dark:text-slate-400">拖放文件或点击上传</span>
        </div>
      )}
    </div>
  );
} 