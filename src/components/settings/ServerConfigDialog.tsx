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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getServerConfig, setServerConfig, type ServerConfig } from "@/lib/mcp/authorizationConfig";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  globalDefaults: {
    autoAuthorize: boolean;
    maxRecursionDepth: number;
  };
}

export default function ServerConfigDialog({ open, onOpenChange, serverName, globalDefaults }: Props) {
  const { t } = useLocaleStore();
  const depthSliderId = useId();
  const [autoAuthMode, setAutoAuthMode] = useState<'default' | 'enabled' | 'disabled'>('default');
  const [maxDepthMode, setMaxDepthMode] = useState<'default' | 'custom'>('default');
  const [customMaxDepth, setCustomMaxDepth] = useState(6);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 加载服务器配置
  useEffect(() => {
    if (open && serverName) {
      setLoading(true);
      getServerConfig(serverName)
        .then(config => {
          // 授权模式
          if (config.autoAuthorize === undefined) {
            setAutoAuthMode('default');
          } else if (config.autoAuthorize) {
            setAutoAuthMode('enabled');
          } else {
            setAutoAuthMode('disabled');
          }
          
          // 递归深度模式
          if (config.maxRecursionDepth === undefined) {
            setMaxDepthMode('default');
            setCustomMaxDepth(globalDefaults.maxRecursionDepth);
          } else {
            setMaxDepthMode('custom');
            setCustomMaxDepth(config.maxRecursionDepth);
          }
        })
        .catch(err => {
          console.error('[SERVER-CONFIG] 加载配置失败:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, serverName, globalDefaults]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: ServerConfig = {};
      
      // 授权设置
      if (autoAuthMode === 'enabled') {
        config.autoAuthorize = true;
      } else if (autoAuthMode === 'disabled') {
        config.autoAuthorize = false;
      }
      // default模式不设置，使用undefined
      
      // 递归深度设置
      if (maxDepthMode === 'custom') {
        config.maxRecursionDepth = customMaxDepth;
      }
      // default模式不设置，使用undefined
      
      await setServerConfig(serverName, config);
      onOpenChange(false);
    } catch (err) {
      console.error('[SERVER-CONFIG] 保存配置失败:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('mcpSettings.serverConfigTitle').replace('{0}', () => serverName)}</DialogTitle>
          <DialogDescription>{t('mcpSettings.serverConfigDescription')}</DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-sm text-slate-500">{t('mcpSettings.loading')}</div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* 授权设置 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('mcpSettings.toolAuthorization')}</Label>
              <Select value={autoAuthMode} onValueChange={(v: any) => setAutoAuthMode(v)}>
                <SelectTrigger aria-label={t('mcpSettings.toolAuthorization')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    {t('mcpSettings.useDefault').replace('{0}', t(globalDefaults.autoAuthorize ? 'mcpSettings.autoAuthorize' : 'mcpSettings.manualConfirmation'))}
                  </SelectItem>
                  <SelectItem value="enabled">{t('mcpSettings.autoAuthorizeOption')}</SelectItem>
                  <SelectItem value="disabled">{t('mcpSettings.manualConfirmationOption')}</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('mcpSettings.serverAuthorizationHelp')}
              </span>
            </div>

            {/* 最大递归深度 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('mcpSettings.depth')}</Label>
              <Select value={maxDepthMode} onValueChange={(v: any) => setMaxDepthMode(v)}>
                <SelectTrigger aria-label={t('mcpSettings.depth')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    {t('mcpSettings.useDefault').replace('{0}', String(globalDefaults.maxRecursionDepth))}
                  </SelectItem>
                  <SelectItem value="custom">{t('mcpSettings.customDepth')}</SelectItem>
                </SelectContent>
              </Select>
              
              {maxDepthMode === 'custom' && (
                <>
                  <div className="flex items-center gap-2">
                    <label htmlFor={depthSliderId} className="text-sm">
                      {t('mcpSettings.currentValue').replace('{0}', String(customMaxDepth))}
                    </label>
                  </div>
                  <Slider
                    id={depthSliderId}
                    min={2}
                    max={20}
                    step={1}
                    value={[customMaxDepth]}
                    onValueChange={([v]) => setCustomMaxDepth(v)}
                  />
                </>
              )}
              
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('mcpSettings.serverDepthHelp')}
              </span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            className="bg-blue-500 hover:bg-blue-600 text-white"
            disabled={saving || loading}
            onClick={handleSave}
          >
            {t(saving ? 'mcpSettings.saving' : 'mcpSettings.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

