"use client";

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { PromptItem } from '@/types/prompt';

interface ApplyPromptModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptItem | null;
  onApply: (mode: 'permanent' | 'temporary' | 'oneOff', vars: Record<string, string>) => void;
}

export function ApplyPromptModeDialog({ open, onOpenChange, prompt, onApply }: ApplyPromptModeDialogProps) {
  const [mode, setMode] = useState<'permanent' | 'temporary' | 'oneOff'>('permanent');
  const [vars, setVars] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && prompt) {
      const init: Record<string, string> = {};
      (prompt.variables || []).forEach((v) => {
        if (v.key) init[v.key] = v.defaultValue || '';
      });
      setVars(init);
      setMode('permanent');
    }
  }, [open, prompt]);

  if (!prompt) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>应用提示词：{prompt.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-2">应用范围</div>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="apply-mode" checked={mode==='permanent'} onChange={() => setMode('permanent')} />
                <span>仅影响后续消息（永久直到更换）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="apply-mode" checked={mode==='temporary'} onChange={() => setMode('temporary')} />
                <span>临时生效（随时可清除）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="apply-mode" checked={mode==='oneOff'} onChange={() => setMode('oneOff')} />
                <span>仅下一条消息生效（一次性）</span>
              </label>
            </div>
          </div>
          {(prompt.variables && prompt.variables.length > 0) && (
            <div>
              <div className="text-sm font-medium mb-2">变量</div>
              <div className="space-y-2">
                {prompt.variables.map((v) => (
                  <div key={v.key} className="grid grid-cols-3 gap-2 items-center">
                    <Label className="text-sm text-slate-600 dark:text-slate-300">{v.label || v.key}</Label>
                    <div className="col-span-2">
                      <Input value={vars[v.key] || ''} onChange={(e) => setVars({ ...vars, [v.key]: e.target.value })} placeholder={v.defaultValue || ''} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => onApply(mode, vars)}>应用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

