import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from '@/components/ui/sonner';

interface CreateKnowledgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

export function CreateKnowledgeDialog({ open, onOpenChange, onCreate }: CreateKnowledgeDialogProps) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  const validName = (str: string) => /^[\u4e00-\u9fa5A-Za-z0-9 _-]+$/.test(str);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('名称不能为空');
      return;
    }
    if (!validName(name.trim())) {
      toast.error('名称包含非法字符');
      return;
    }
    try {
      setLoading(true);
      await onCreate(name.trim(), desc.trim());
      setName('');
      setDesc('');
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-0 overflow-hidden">
        <DialogHeader className="border-b border-slate-200/40 dark:border-slate-700/40 px-6 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">新建知识库</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">知识库名称 <span className="text-red-500/80">*</span></label>
            <Input
              className="h-10"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：技术文档、产品手册..."
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">知识库描述 <span className="text-xs text-slate-400">(可选)</span></label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="简要说明知识库的用途和内容..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="border-t border-slate-200/40 dark:border-slate-700/40 px-6 py-4 glass-dialog-footer">
          <Button variant="dialogSecondary" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-lg">取消</Button>
          <Button variant="dialogPrimary" onClick={handleSubmit} disabled={loading} className="rounded-lg">创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 