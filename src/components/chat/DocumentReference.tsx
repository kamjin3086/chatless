"use client";

import { useState } from 'react';
import { FileText, ChevronDown, ChevronRight, File, FileType } from 'lucide-react';
import { cn } from "@/lib/utils";

interface DocumentReferenceProps {
  fileName: string;
  fileType: string;
  fileSize: number;
  summary: string;
  fullContent?: string;
  className?: string;
  variant?: 'default' | 'user-message' | 'ai-message';
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const truncateText = (text: string, maxLength: number): string => {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
};

const getFileIcon = (fileType: string, variant: string = 'default') => {
  const type = fileType.toLowerCase();
  let iconColor = "";
  
  switch (variant) {
    case 'user-message':
      iconColor = "text-blue-500/80 dark:text-blue-400/80";
      break;
    case 'ai-message':
      iconColor = "text-slate-600 dark:text-slate-400";
      break;
    default:
      iconColor = "text-blue-600 dark:text-blue-400";
      break;
  }
  
  if (type === 'pdf') return <FileType className={`w-4 h-4 ${iconColor}`} />;
  if (type === 'docx' || type === 'doc') return <FileText className={`w-4 h-4 ${iconColor}`} />;
  if (type === 'txt' || type === 'md' || type === 'markdown') return <File className={`w-4 h-4 ${iconColor}`} />;
  return <FileText className={`w-4 h-4 ${iconColor}`} />;
};

export function DocumentReference({
  fileName,
  fileType,
  fileSize,
  summary,
  fullContent,
  className,
  variant = 'default'
}: DocumentReferenceProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // 根据变体选择样式
  const getVariantStyles = () => {
    switch (variant) {
      case 'user-message':
        return {
          container: "border border-emerald-200/50 dark:border-emerald-700/40 rounded-xl bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-emerald-50/80 dark:from-emerald-900/20 dark:to-teal-900/15 p-3 my-2 shadow-sm backdrop-blur-sm",
          fileName: "font-semibold text-emerald-900 dark:text-emerald-100 text-sm truncate block",
          fileType: "text-xs text-emerald-700 dark:text-emerald-300 bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-800/50 dark:to-teal-800/40 px-2 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-700/50",
          fileSize: "text-xs text-emerald-600/70 dark:text-emerald-400/70 font-mono",
          summary: "text-sm text-emerald-800/90 dark:text-emerald-200/90 truncate",
          expandButton: "text-xs text-emerald-600/80 dark:text-emerald-300/80 hover:text-emerald-700 dark:hover:text-emerald-200",
          expandedHeader: "text-xs text-emerald-600/70 dark:text-emerald-400/70 mb-2 font-medium",
          expandedContent: "text-sm text-emerald-900 dark:text-emerald-100 bg-white/95 dark:bg-slate-800/90 p-3 rounded-lg border border-emerald-200/60 dark:border-emerald-800/50 max-h-60 overflow-y-auto backdrop-blur-sm shadow-sm"
        };
      case 'ai-message':
        return {
          container: "border border-slate-200/60 dark:border-slate-700/50 rounded-xl bg-gradient-to-r from-slate-50/80 to-slate-50/60 dark:from-slate-800/40 dark:to-slate-800/30 p-3 my-2 shadow-sm backdrop-blur-sm",
          fileName: "font-semibold text-slate-900 dark:text-slate-100 text-sm truncate block",
          fileType: "text-xs text-slate-700 dark:text-slate-300 bg-gradient-to-r from-slate-100 to-slate-100 dark:from-slate-700/60 dark:to-slate-700/50 px-2 py-0.5 rounded-full border border-slate-200/50 dark:border-slate-600/50",
          fileSize: "text-xs text-slate-600 dark:text-slate-400 font-mono",
          summary: "text-sm text-slate-700 dark:text-slate-300 truncate",
          expandButton: "text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200",
          expandedHeader: "text-xs text-slate-600 dark:text-slate-400 mb-2 font-medium",
          expandedContent: "text-sm text-slate-900 dark:text-slate-100 bg-white/95 dark:bg-slate-800/90 p-3 rounded-lg border border-slate-200/60 dark:border-slate-700/50 max-h-60 overflow-y-auto backdrop-blur-sm shadow-sm"
        };
      default:
        return {
          container: "border border-blue-200/60 dark:border-blue-800/50 rounded-xl bg-gradient-to-r from-blue-50/80 to-indigo-50/60 dark:from-blue-900/30 dark:to-indigo-900/25 p-3 my-2 shadow-sm backdrop-blur-sm",
          fileName: "font-semibold text-blue-900 dark:text-blue-100 text-sm truncate block",
          fileType: "text-xs text-blue-700 dark:text-blue-300 bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-800/60 dark:to-indigo-800/50 px-2 py-0.5 rounded-full border border-blue-200/50 dark:border-blue-700/50",
          fileSize: "text-xs text-blue-600 dark:text-blue-400 font-mono",
          summary: "text-sm text-blue-800 dark:text-blue-200 truncate",
          expandButton: "text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300",
          expandedHeader: "text-xs text-blue-600 dark:text-blue-400 mb-2 font-medium",
          expandedContent: "text-sm text-blue-900 dark:text-blue-100 bg-white/95 dark:bg-slate-800/90 p-3 rounded-lg border border-blue-200/60 dark:border-blue-800/50 max-h-60 overflow-y-auto backdrop-blur-sm shadow-sm"
        };
    }
  };
  
  const styles = getVariantStyles();
  
  return (
    <div className={cn(
      styles.container,
      "will-change-auto transform-gpu transition-all duration-200 min-w-0",
      className
    )}>
      {/* 文档引用头部 */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-slate-100 to-slate-100 dark:from-slate-700/60 dark:to-slate-700/50 flex items-center justify-center shadow-sm">
          {getFileIcon(fileType, variant)}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={styles.fileName} title={fileName}>
              📎 {truncateText(fileName, 18)}
            </span>
            <span className={styles.fileType}>
              {fileType.toUpperCase()}
            </span>
            <span className={styles.fileSize}>
              {formatFileSize(fileSize)}
            </span>
          </div>
          
          <p className={styles.summary} title={summary}>
            {truncateText(summary, 36)}
          </p>
          
          {/* 展开/收起按钮 */}
          {fullContent && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                "flex items-center gap-1.5 mt-2.5 transition-all duration-200 hover:gap-2",
                styles.expandButton
              )}
            >
              {isExpanded ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  收起完整内容
                </>
              ) : (
                <>
                  <ChevronRight className="w-3.5 h-3.5" />
                  查看完整内容
                </>
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* 展开的完整内容 */}
      {isExpanded && fullContent && (
        <div className={cn(
          "mt-3 pt-3",
          variant === 'user-message'
            ? "border-t border-blue-500/10 dark:border-blue-400/10"
            : "border-t border-slate-200 dark:border-slate-700"
        )}>
          <div className={styles.expandedHeader}>文档完整内容：</div>
          <div className={styles.expandedContent}>
            <pre className="whitespace-pre-wrap break-words font-sans">{fullContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
} 