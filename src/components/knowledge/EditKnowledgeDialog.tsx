import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/sonner';
import type { KnowledgeBase } from '@/lib/knowledgeService';
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';

interface EditKnowledgeDialogProps {
  open: boolean;
  kb: KnowledgeBase | null;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, description: string) => Promise<void>;
}

export function EditKnowledgeDialog({ open, kb, onOpenChange, onSave }: EditKnowledgeDialogProps) {
  const locale = useLocaleStore((state) => state.locale);
  const t = (key: TranslationKey) => translate(locale, key);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (kb) {
      setName(kb.name);
      setDesc(kb.description || '');
    }
  }, [kb]);

  const validName = (str: string) => /^[\u4e00-\u9fa5A-Za-z0-9 _-]+$/.test(str);

  const handleSubmit = async () => {
    if (!kb) return;
    if (!name.trim()) {
      toast.error(t('knowledge.validation.nameRequired'));
      return;
    }
    if (!validName(name.trim())) {
      toast.error(t('knowledge.validation.nameInvalid'));
      return;
    }
    try {
      setLoading(true);
      await onSave(name.trim(), desc.trim());
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-0 overflow-hidden" closeLabel={t('common.close')}>
        <DialogHeader className="border-b border-slate-200/40 dark:border-slate-700/40 px-6 pt-5 pb-3">
          <DialogTitle className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('knowledge.edit.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">{t('knowledge.field.name')}</label>
            <Input className="h-10" value={name} onChange={(e)=>setName(e.target.value)} placeholder={t('knowledge.field.name')} />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">{t('knowledge.field.description')}</label>
            <Textarea rows={3} value={desc} onChange={(e)=>setDesc(e.target.value)} placeholder={t('knowledge.field.description')} />
          </div>
        </div>
        <DialogFooter className="border-t border-slate-200/40 dark:border-slate-700/40 px-6 py-4 glass-dialog-footer">
          <Button variant="dialogSecondary" onClick={()=>onOpenChange(false)} disabled={loading} className="rounded-lg">{t('common.cancel')}</Button>
          <Button variant="dialogPrimary" onClick={handleSubmit} disabled={loading} className="rounded-lg">{t('knowledge.edit.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 