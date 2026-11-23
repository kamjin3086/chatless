"use client";
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { validateProviderName } from '@/lib/utils/pinyin';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string; // stable key
  initialDisplayName: string;
};

export function ProviderRenameDialog({ open, onOpenChange, providerName, initialDisplayName }: Props) {
  const [value, setValue] = useState<string>(initialDisplayName);
  const [saving, setSaving] = useState(false);
  const t = useTranslation();
  const locale = useLocaleStore((state) => state.locale);

  React.useEffect(() => {
    if (open) setValue(initialDisplayName);
  }, [open, initialDisplayName]);

  const handleSave = async () => {
    const next = (value || '').trim();
    const v = validateProviderName(next, locale);
    if (!v.isValid) {
      toast.error(v.error || t('settings.providerRename.invalidName'), { description: v.suggestion });
      return;
    }
    setSaving(true);
    try {
      const { updateProviderConfigUseCase } = await import('@/lib/provider/usecases/UpdateProviderConfig');
      await updateProviderConfigUseCase.execute(providerName, { displayName: next });
      toast.success(t('settings.providerRename.updated'));
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(t('settings.providerRename.saveFailed'), { description: e?.message || String(e) });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.providerRename.title')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">{t('settings.providerRename.displayNameLabel')}</label>
            <Input
              value={value}
              maxLength={20}
              onChange={(e)=> setValue(e.target.value)}
              placeholder={t('settings.providerRename.displayNamePlaceholder')}
            />
            <div className="mt-1 text-[10px] text-slate-400">{t('settings.providerRename.displayNameHint').replace('{name}', providerName)}</div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="dialogSecondary" onClick={()=>onOpenChange(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button variant="dialogPrimary" onClick={handleSave} disabled={saving}>{saving ? t('settings.providerRename.saving') : t('settings.providerRename.save')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


