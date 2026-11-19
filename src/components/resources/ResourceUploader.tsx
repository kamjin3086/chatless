'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, HardDriveUpload } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import type { ResourceUploaderProps } from './types';

export function ResourceUploader({
  onUploadSuccess,
  displayType = 'button',
}: ResourceUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (selectedFiles: readonly File[]) => {
    if (selectedFiles.length === 0) return;
    const files = Array.from(selectedFiles);
    setUploading(true);
    try {
      const uploadedFiles = [];
      const failures: string[] = [];
      for (const file of files) {
        try {
          const { UnifiedFileService } = await import('@/lib/unifiedFileService');
          const savedFile = await UnifiedFileService.saveFile(file, file.name, 'upload', {
            tags: ['手动上传'],
            note: `通过文件上传界面添加于 ${new Date().toLocaleDateString('zh-CN')}`,
          });
          uploadedFiles.push(savedFile);
        } catch (error) {
          console.error(`文件上传失败: ${file.name}`, error);
          failures.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (uploadedFiles.length > 0) {
        toast.success('文档上传成功', {
          description: `已成功上传 ${uploadedFiles.length} 个文档${failures.length ? `，${failures.length} 个文件上传失败` : ''}`,
        });
        onUploadSuccess();
      } else {
        toast.error('文档上传失败', {
          description: failures.slice(0, 2).join('；') || '所有文件上传都失败了，请检查文件类型和权限',
        });
      }
    } catch (error) {
      console.error('文档上传过程出错:', error);
      toast.error('文档上传失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUploading(false);
    }
  }, [onUploadSuccess]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files.length > 0) {
      void handleFileSelect(Array.from(event.dataTransfer.files));
      event.dataTransfer.clearData();
    }
  }, [handleFileSelect]);

  return (
    <>
      {/* Keep the picker mounted and retain its files until async reads finish. */}
      <input
        ref={fileInputRef}
        type="file"
        id="fileInput"
        multiple
        className="hidden"
        aria-label="选择上传文件"
        onChange={async (event) => {
          const input = event.currentTarget;
          try {
            await handleFileSelect(Array.from(input.files || []));
          } finally {
            // Allow selecting the same files again after success or failure.
            input.value = '';
          }
        }}
      />
      {displayType === 'button' ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleUploadClick}
          disabled={uploading}
          className="flex items-center gap-2"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? '上传中...' : '上传文件'}
        </Button>
      ) : (
        <button
          type="button"
          disabled={uploading}
          className={`w-full border border-dashed border-slate-300/60 dark:border-slate-600/40 rounded-lg flex items-center justify-center p-3 cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 hover:border-slate-400/60 dark:hover:border-slate-500/50 transition-colors ${uploading ? 'opacity-70' : ''}`}
          onClick={handleUploadClick}
          onDrop={uploading ? undefined : handleDrop}
          onDragOver={(event) => event.preventDefault()}
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
              <span className="text-xs text-slate-500">上传中...</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <HardDriveUpload className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500 dark:text-slate-400">拖放文件或点击上传</span>
            </span>
          )}
        </button>
      )}
    </>
  );
}
