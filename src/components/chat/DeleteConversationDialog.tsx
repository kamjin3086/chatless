"use client";

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
import type { Conversation } from "@/types/chat";

interface DeleteConversationDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: () => void;
  conversation: Conversation | null;
}

export function DeleteConversationDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  conversation,
}: DeleteConversationDialogProps) {
  if (!conversation) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {/* 右上角关闭按钮 */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 cursor-pointer"
          aria-label="关闭"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <AlertDialogHeader className="pr-8">
          <AlertDialogTitle>确定要删除这个会话吗？</AlertDialogTitle>
          <AlertDialogDescription>
            将会话 "{conversation.title}" 删除。这个操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
} 