'use client';

import { useMemo, useState } from 'react';
import { PromptCard, Prompt } from "./PromptCard";
import { PromptEditorDialog } from "./PromptEditorDialog";
import { usePromptStore } from "@/store/promptStore";
import { useChatStore } from "@/store/chatStore";
import { toast } from "@/components/ui/sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface PromptListProps {
  prompts: Prompt[];
}

export function PromptList({ prompts }: PromptListProps) {
  const toggleFavorite = usePromptStore((s) => s.toggleFavorite);
  const updatePrompt = usePromptStore((s) => s.updatePrompt);
  const deletePrompt = usePromptStore((s) => s.deletePrompt);
  const allPrompts = usePromptStore((s) => s.prompts);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const currentConversationId = useChatStore((s) => s.currentConversationId);

  // 编辑对话框状态
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingInitial = useMemo(() => allPrompts.find(p => p.id === editingId) || null, [allPrompts, editingId]);

  // 删除确认
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleToggleFavorite = (id: string) => toggleFavorite(id);
  
  const handleEdit = (id: string) => { 
    setEditingId(id); 
    setEditorOpen(true); 
  };
  
  const handleDelete = (id: string) => { 
    setPendingDeleteId(id); 
  };

  // 点击卡片直接进入编辑
  const handleCardClick = (id: string) => {
    handleEdit(id);
  };

  const applyToCurrentChat = (id: string) => {
    if (!currentConversationId) { 
      toast.info('请先选择一个对话'); 
      return; 
    }
    updateConversation(currentConversationId, { 
      system_prompt_applied: { promptId: id, mode: 'permanent' } as any 
    });
    toast.success('已应用到当前对话');
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {prompts.map((prompt) => (
          <PromptCard 
            key={prompt.id} 
            {...prompt} 
            onClick={handleCardClick}
            onToggleFavorite={handleToggleFavorite}
            onApply={applyToCurrentChat}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* 编辑对话框 - 点击卡片直接打开 */}
      <PromptEditorDialog
        open={editorOpen}
        onOpenChange={(o) => { setEditorOpen(o); if (!o) setEditingId(null); }}
        initial={editingInitial}
        onSubmit={(data) => {
          if (!editingId) return;
          updatePrompt(editingId, {
            name: data.name,
            description: data.description,
            content: data.content,
            tags: data.tags,
            languages: data.languages,
            modelHints: data.modelHints,
            variables: data.variables,
            favorite: data.favorite,
            shortcuts: (data as any).shortcuts,
          } as any);
          toast.success('已保存修改');
        }}
        onDelete={() => {
          if (editingId) {
            setEditorOpen(false);
            handleDelete(editingId);
          }
        }}
        onToggleFavorite={() => {
          if (editingId) handleToggleFavorite(editingId);
        }}
      />

      {/* 删除确认对话框 */}
      <AlertDialog open={!!pendingDeleteId} onOpenChange={(o) => { if (!o) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除提示词？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，相关使用统计将一并移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteId(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { 
              if (pendingDeleteId) { 
                deletePrompt(pendingDeleteId); 
                toast.success('已删除提示词'); 
                setPendingDeleteId(null); 
              } 
            }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
