"use client";
import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

export function ProviderRenameModelDialog({ providerName, modelName, currentLabel }: { providerName: string; modelName: string; currentLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentLabel || '');
  useEffect(()=>{ if(open) setValue(currentLabel || ''); }, [open, currentLabel]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <DropdownMenuItem className="cursor-pointer" onSelect={(e: any) => e?.preventDefault?.()}>
          <Pencil />
          重命名
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">重命名模型</DialogTitle>
        </DialogHeader>
        <div>
          <label className="block text-xs text-slate-500 mb-1">新名称</label>
          <input className="w-full h-9 px-3 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" value={value} onChange={e=>setValue(e.target.value)} placeholder="输入新的显示名" />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={()=>setOpen(false)}>取消</Button>
          <Button variant="outline" onClick={()=> setValue(currentLabel || '')} title="恢复为原名称" className="flex items-center gap-1">
            <RotateCcw className="w-3 h-3" />
            重置
          </Button>
          <Button 
          variant="outline"
          className="bg-blue-500 hover:bg-blue-600 text-white"
          onClick={async()=>{
            const nextLabel = (value || '').trim();
            if (!nextLabel) { toast.error('名称不可为空'); return; }
            try {
              const { modelRepository } = await import('@/lib/provider/ModelRepository');
              const { specializedStorage } = await import('@/lib/storage');
              const list = (await modelRepository.get(providerName)) || [];
              const updated = list.map((m: any) => (m.name === modelName ? { ...m, label: nextLabel } : m));
              await modelRepository.save(providerName, updated);
              await specializedStorage.models.setModelLabel(providerName, modelName, nextLabel);
              toast.success('已重命名', { description: nextLabel });
              setOpen(false);
            } catch (err) { console.error(err); toast.error('重命名失败'); }
          }}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

