"use client";
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { validateProviderName } from '@/lib/utils/pinyin';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string; // stable key
  initialDisplayName: string;
};

export function ProviderRenameDialog({ open, onOpenChange, providerName, initialDisplayName }: Props) {
  const [value, setValue] = useState<string>(initialDisplayName);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) setValue(initialDisplayName);
  }, [open, initialDisplayName]);

  const handleSave = async () => {
    const next = (value || '').trim();
    const v = validateProviderName(next);
    if (!v.isValid) {
      toast.error(v.error || '名称无效', { description: v.suggestion });
      return;
    }
    setSaving(true);
    try {
      const { updateProviderConfigUseCase } = await import('@/lib/provider/usecases/UpdateProviderConfig');
      await updateProviderConfigUseCase.execute(providerName, { displayName: next });
      toast.success('已更新名称');
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error('保存失败', { description: e?.message || String(e) });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名提供商</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">显示名称（最长20个字符，不含特殊符号）</label>
            <Input
              value={value}
              maxLength={20}
              onChange={(e)=> setValue(e.target.value)}
              placeholder="新的显示名称"
            />
            <div className="mt-1 text-[10px] text-slate-400">名称仅用于展示，唯一标识仍为 {providerName}</div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="dialogSecondary" onClick={()=>onOpenChange(false)} disabled={saving}>取消</Button>
            <Button variant="dialogPrimary" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


