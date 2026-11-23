"use client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useState, useEffect, useId } from "react";
import { useLocaleStore } from "@/store/localeStore";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getAuthorizationConfig, setDefaultAutoAuthorize } from "@/lib/mcp/authorizationConfig";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxDepth: number;
  onSave: (val: number) => Promise<void>;
}

export default function AdvancedMcpSettingsDialog({ open, onOpenChange, maxDepth, onSave }: Props) {
  const { t } = useLocaleStore();
  const autoAuthorizeId = useId();
  const [val, setVal] = useState(maxDepth);
  const [saving, setSaving] = useState(false);
  const [defaultAutoAuth, setDefaultAutoAuth] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  
  // 加载授权配置
  useEffect(() => {
    if (open) {
      setLoadingAuth(true);
      getAuthorizationConfig()
        .then(config => {
          setDefaultAutoAuth(config.defaultAutoAuthorize);
        })
        .catch(err => {
          console.error('[MCP-SETTINGS] 加载授权配置失败:', err);
        })
        .finally(() => {
          setLoadingAuth(false);
        });
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('mcpSettings.advancedTitle')}</DialogTitle>
          <DialogDescription>{t('mcpSettings.advancedDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label className="flex flex-col gap-2 text-sm">
            {t('mcpSettings.depthValue').replace('{0}', String(val))}
            <Slider min={3} max={20} step={1} value={[val]} onValueChange={([v]) => setVal(v)} />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('mcpSettings.depthHelp')}
            </span>
          </label>
          
          <div className="flex items-center justify-between space-x-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={autoAuthorizeId} className="text-sm font-medium">
                {t('mcpSettings.defaultAutoAuthorize')}
              </Label>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('mcpSettings.defaultAutoAuthorizeHelp')}
              </span>
            </div>
            <Switch
              id={autoAuthorizeId}
              checked={defaultAutoAuth}
              onCheckedChange={setDefaultAutoAuth}
              disabled={loadingAuth}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button 
            size="sm" 
            className="bg-blue-500 hover:bg-blue-600 text-white" 
            disabled={saving} 
            onClick={async () => { 
              setSaving(true); 
              try {
                await onSave(val); 
                await setDefaultAutoAuthorize(defaultAutoAuth);
              } catch (err) {
                console.error('[MCP-SETTINGS] 保存设置失败:', err);
              }
              setSaving(false); 
              onOpenChange(false); 
            }}
          >
            {t('mcpSettings.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
