"use client";
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/sonner';
import { providerRepository } from '@/lib/provider/ProviderRepository';
import { ProviderStatus } from '@/lib/provider/types';
import { syncDynamicProviders } from '@/lib/llm';
import { generateAvatarDataUrl } from '@/lib/avatar';
import StorageUtil from '@/lib/storage';
import { Plus, ExternalLink } from 'lucide-react';

// 常见的OpenAI兼容服务预设
const OPENAI_COMPATIBLE_PRESETS = [
  {
    id: '302ai',
    name: '302.AI',
    displayName: '302.AI',
    url: 'https://api.302.ai/v1',
    description: '支持多种AI模型的API服务平台',
    website: 'https://302.ai',
    requiresKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    displayName: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    description: '统一访问多个AI模型的路由服务',
    website: 'https://openrouter.ai',
    requiresKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    displayName: 'Groq',
    url: 'https://api.groq.com/openai/v1',
    description: '高速推理的AI计算平台',
    website: 'https://groq.com',
    requiresKey: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    displayName: 'Together AI',
    url: 'https://api.together.xyz/v1',
    description: '开源模型推理平台',
    website: 'https://together.ai',
    requiresKey: true,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    displayName: 'Perplexity',
    url: 'https://api.perplexity.ai',
    description: '搜索增强的AI对话服务',
    website: 'https://perplexity.ai',
    requiresKey: true,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    displayName: 'Mistral AI',
    url: 'https://api.mistral.ai/v1',
    description: 'Mistral开源模型官方API',
    website: 'https://mistral.ai',
    requiresKey: true,
  },
];

type Props = {
  trigger: React.ReactNode;
  onProviderAdded?: () => void;
};

export function OpenAICompatibleProviders({ trigger, onProviderAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 清洗ID的函数
  const sanitizeId = (raw: string): string => {
    let s = (raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    s = s.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    if (s.length > 64) s = s.slice(0, 64);
    return s;
  };

  // 添加预设提供商
  const addPresetProvider = async (preset: typeof OPENAI_COMPATIBLE_PRESETS[0]) => {
    setIsSaving(true);
    try {
      const list = await providerRepository.getAll();
      const existingNames = new Set(list.map(p => p.name));
      
      let finalId = preset.id;
      let n = 2;
      while (existingNames.has(finalId)) {
        finalId = `${preset.id}-${n++}`;
      }

      // 生成并持久化头像
      const avatarKey = `avatar:${finalId}:18`;
      const avatarSmall = generateAvatarDataUrl(finalId, preset.displayName, 18);
      await StorageUtil.setItem(avatarKey, avatarSmall, 'logo-cache.json');

      await providerRepository.upsert({
        name: finalId,
        url: preset.url,
        requiresKey: preset.requiresKey,
        status: preset.requiresKey ? ProviderStatus.NO_KEY : ProviderStatus.UNKNOWN,
        lastChecked: 0,
        apiKey: null,
        isUserAdded: true,
        isVisible: true,
        strategy: 'openai-compatible',
        displayName: preset.displayName,
      });

      await syncDynamicProviders();
      toast.success(`已添加 ${preset.displayName}`);
      onProviderAdded?.();
      setOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error('添加失败', { description: e?.message || String(e) });
    }
    setIsSaving(false);
  };

  // 添加自定义提供商
  const addCustomProvider = async () => {
    const displayName = customName.trim();
    const url = customUrl.trim();
    
    if (!displayName) {
      toast.error('请填写名称');
      return;
    }
    if (/[\u4e00-\u9fff]/.test(displayName)) {
      toast.error('名称不支持中文', { description: '请使用英文、数字、空格或连字符 (-)' });
      return;
    }
    if (!url) {
      toast.error('请填写服务地址');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('无效的服务地址', { description: 'URL 必须以 http:// 或 https:// 开头' });
      return;
    }

    setIsSaving(true);
    try {
      const list = await providerRepository.getAll();
      const existingNames = new Set(list.map(p => p.name));
      
      const baseId = sanitizeId(displayName);
      if (!baseId || baseId.length < 2) {
        toast.error('名称过短', { description: '请使用至少 2 个字符（字母/数字/连字符）' });
        setIsSaving(false);
        return;
      }

      let finalId = baseId;
      let n = 2;
      while (existingNames.has(finalId)) {
        finalId = `${baseId}-${n++}`;
      }

      // 生成并持久化头像
      const avatarKey = `avatar:${finalId}:18`;
      const avatarSmall = generateAvatarDataUrl(finalId, displayName, 18);
      await StorageUtil.setItem(avatarKey, avatarSmall, 'logo-cache.json');

      await providerRepository.upsert({
        name: finalId,
        url,
        requiresKey: true,
        status: ProviderStatus.NO_KEY,
        lastChecked: 0,
        apiKey: null,
        isUserAdded: true,
        isVisible: true,
        strategy: 'openai-compatible',
        displayName,
      });

      await syncDynamicProviders();
      toast.success(`已添加自定义提供商 ${displayName}`);
      onProviderAdded?.();
      setCustomModalOpen(false);
      setOpen(false);
      setCustomName('');
      setCustomUrl('');
    } catch (e: any) {
      console.error(e);
      toast.error('添加失败', { description: e?.message || String(e) });
    }
    setIsSaving(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>添加 OpenAI 兼容服务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              选择常用的OpenAI兼容API服务，或添加自定义服务地址
            </div>
            
            {/* 预设服务列表 */}
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              <div className="text-xs font-medium text-gray-500 mb-3">常用服务</div>
              {OPENAI_COMPATIBLE_PRESETS.map((preset) => (
                <div key={preset.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{preset.displayName}</div>
                      <a 
                        href={preset.website} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{preset.description}</div>
                    <div className="text-xs text-gray-400 mt-1 font-mono">{preset.url}</div>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => addPresetProvider(preset)}
                    disabled={isSaving}
                  >
                    添加
                  </Button>
                </div>
              ))}
            </div>

            {/* 自定义服务入口 */}
            <div className="border-t pt-4">
              <Button 
                variant="outline" 
                className="w-full" 
                onClick={() => setCustomModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                添加自定义 OpenAI 兼容服务
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 自定义服务弹窗 */}
      <Dialog open={customModalOpen} onOpenChange={setCustomModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加自定义 OpenAI 兼容服务</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">服务名称</label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：My API Service"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">API 地址</label>
              <Input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <div className="text-xs text-gray-500 mt-1">
                请确保地址支持 OpenAI 兼容的 /chat/completions 接口
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setCustomModalOpen(false)}>
                取消
              </Button>
              <Button onClick={addCustomProvider} disabled={isSaving}>
                {isSaving ? '添加中...' : '添加'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}