"use client";
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { AVAILABLE_PROVIDERS_CATALOG, CatalogStrategy } from '@/lib/provider/catalog';
import { providerRepository } from '@/lib/provider/ProviderRepository';
import { ProviderStatus } from '@/lib/provider/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import Image from 'next/image';
import { toast } from '@/components/ui/sonner';
import { syncDynamicProviders } from '@/lib/llm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateAvatarDataUrl } from '@/lib/avatar';
import { getStaticModels, type ProviderName } from '@/lib/provider/staticModels';
import { MoreVertical, Pencil, Trash2, Plus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { getAvatarSync, prewarmAvatars } from '@/lib/utils/logoService';
import { getResolvedUrlForBase, isUrlKnownMissing, markResolvedBase, markUrlMissing, ensureLogoCacheReady } from '@/lib/utils/logoService';
import StorageUtil from '@/lib/storage';

type Props = {
  trigger: React.ReactNode;
};

// 统一的小图标：优先 png → svg；利用预加载的命中映射/失败清单，避免重复 404
function ProviderIcon({ id, name, size = 18, src }: { id?: string; name: string; size?: number; src?: string }) {
  const exts = ['png', 'svg', 'webp', 'jpeg', 'jpg'] as const;
  const base = id ? `/llm-provider-icon/${id}` : null;
  const mapped = React.useMemo(() => (base ? getResolvedUrlForBase(base) : null), [base]);
  const avatarFallback = React.useMemo(() => generateAvatarDataUrl((id || name).toLowerCase(), name, size), [id, name, size]);
  const [displaySrc, setDisplaySrc] = React.useState<string>(src || mapped || avatarFallback);

  // 首次渲染即有头像，后台尝试真实图标，命中后再替换，避免“无图→有图”的闪动
  React.useEffect(() => {
    if (!base || src) return; // 自带 src 或无 base 直接使用现有
    if (mapped) { setDisplaySrc(mapped); return; }
    const run = async () => {
      await ensureLogoCacheReady();
      const all = exts.map((ext) => `${base}.${ext}`).filter((u) => !isUrlKnownMissing(u));
      const cancelled = false;
      for (const url of all) {
        try {
          const ok = await new Promise<boolean>((resolve) => {
            const img = new window.Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
          });
          if (ok) {
            if (!cancelled) setDisplaySrc(url);
            markResolvedBase(base, url);
            return;
          } else {
            markUrlMissing(url);
          }
        } catch { /* noop */ }
      }
    };
    let stop = false;
    run().catch(()=>{});
    let cancelled = false;
    return () => { cancelled = true; stop = true; };
  }, [base, mapped, src]);

  return (
    <img
      src={displaySrc}
      alt={`${name} icon`}
      width={size}
      height={size}
      className="shrink-0 rounded-sm ring-1 ring-black/5 dark:ring-white/10 bg-gray-100 w-[18px] h-[18px]"
    />
  );
}

// 生成型头像（组件形式），内部自行使用状态/副作用，避免在父组件中调用 Hook
function CachedAvatarIcon({ seed, label, size = 18 }: { seed: string; label: string; size?: number }) {
  const baseAvatar = React.useMemo(() => generateAvatarDataUrl(seed, label, size), [seed, label, size]);
  const [avatar, setAvatar] = React.useState<string>(baseAvatar);
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const key = `avatar:${seed}:${size}`;
        const existed = await StorageUtil.getItem<string>(key, null, 'logo-cache.json');
        if (existed) {
          if (mounted) setAvatar(existed);
        } else {
          await StorageUtil.setItem(key, baseAvatar, 'logo-cache.json');
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, [seed, size, baseAvatar]);
  return <ProviderIcon src={avatar} name={label} size={size} />;
}

export function AddProvidersDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
  const [customProviders, setCustomProviders] = useState<Array<{ id: string; displayName: string; url: string; strategy?: CatalogStrategy; isVisible: boolean }>>([]);
  // 自定义 Provider Modal
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [customDisplayName, setCustomDisplayName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customStrategy, setCustomStrategy] = useState<CatalogStrategy>('openai-compatible');
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);

  // 读取仓库现状，构建映射
  useEffect(() => {
    if (!open) return;
    (async () => {
      const list = await providerRepository.getAll();
      const map: Record<string, boolean> = {};
      // 目录中的项目
      AVAILABLE_PROVIDERS_CATALOG.forEach((c)=>{
        const ex = list.find(p=>p.name===c.name);
        map[c.name] = ex ? ex.isVisible !== false : false;
      });
      // 自定义（非目录）且非 Ollama
      const customs = list
        .filter(p => p.name !== 'Ollama' && !AVAILABLE_PROVIDERS_CATALOG.some(c=>c.name===p.name))
        .map(p => ({ id: p.name, displayName: (p as any).displayName || p.name, url: p.url || '', strategy: (p as any).strategy as CatalogStrategy | undefined, isVisible: p.isVisible !== false }));
      customs.forEach(cp => { map[cp.id] = cp.isVisible; });
      setCustomProviders(customs);
      // 后台预热自定义 Provider 头像（非阻塞）
      prewarmAvatars(customs.map(cp => ({ seed: cp.id || cp.displayName, label: cp.displayName })), 18).catch(()=>{});
      setVisibleMap(map);
    })().catch(console.error);
  }, [open]);

  const catalog = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return AVAILABLE_PROVIDERS_CATALOG.filter((c) => c.name.toLowerCase().includes(k));
  }, [keyword]);

  const filteredCustoms = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return customProviders.filter(cp => cp.displayName.toLowerCase().includes(k));
  }, [keyword, customProviders]);

  const toggle = async (name: string, checked: boolean) => {
    try {
      const list = await providerRepository.getAll();
      const existing = list.find((p) => p.name === name);
      if (checked) {
        if (!existing) {
          // 新增
          const def = AVAILABLE_PROVIDERS_CATALOG.find((d) => d.name === name);
          const url = def?.defaultUrl || '';
          await providerRepository.upsert({
            name,
            url,
            requiresKey: def?.requiresKey ?? true,
            status: def?.requiresKey ? ProviderStatus.NO_KEY : ProviderStatus.UNKNOWN,
            lastChecked: 0,
            apiKey: null,
            isUserAdded: true,
            isVisible: true,
            strategy: def?.strategy,
          });
          // 写入静态模型（来自统一数据源 STATIC_PROVIDER_MODELS）
          {
            const staticList = getStaticModels(name as ProviderName);
            if (staticList?.length) {
              const { modelRepository } = await import('@/lib/provider/ModelRepository');
              await modelRepository.save(
                name,
                staticList.map((m)=>({ provider: name, name: m.id, label: m.label, aliases: [m.id] }))
              );
            }
          }
        } else {
          await providerRepository.setVisibility(name, true);
        }
        await syncDynamicProviders();
      } else {
        // 隐藏
        await providerRepository.setVisibility(name, false);
      }
      setVisibleMap((m) => ({ ...m, [name]: checked }));
      // 同步 customProviders 列表（若目标为自定义项）
      setCustomProviders(prev => prev.map(cp => cp.id === name ? { ...cp, isVisible: checked } : cp));
    } catch (e: any) {
      console.error('toggle provider failed', e);
      toast.error('更新失败', { description: e?.message || String(e) });
    }
  };

  const buildCustomAvatarSeed = (name: string) => {
    // 预留：未来用此种子生成略微简约但有个性的图案
    return `prov-${name}-${Date.now()}`;
  };

  // 根据策略获取URL占位符
  const getPlaceholderUrl = (strategy: CatalogStrategy): string => {
    switch (strategy) {
      case 'openai-compatible':
        return 'https://api.example.com/v1';
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'anthropic':
        return 'https://api.anthropic.com/v1';
      case 'gemini':
        return 'https://generativelanguage.googleapis.com/v1beta';
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'ollama':
        return 'http://localhost:11434';
      default:
        return 'https://api.example.com/v1';
    }
  };

  // 根据策略获取URL提示信息
  const getUrlHint = (strategy: CatalogStrategy): string => {
    switch (strategy) {
      case 'openai-compatible':
        return '请输入支持OpenAI兼容接口的API服务地址，通常以 /v1 结尾';
      case 'openai':
        return 'OpenAI官方API地址，通常为 https://api.openai.com/v1';
      case 'anthropic':
        return 'Anthropic官方API地址，通常为 https://api.anthropic.com/v1';
      case 'gemini':
        return 'Google AI API地址，通常为 https://generativelanguage.googleapis.com/v1beta';
      case 'deepseek':
        return 'DeepSeek官方API地址，通常为 https://api.deepseek.com';
      case 'ollama':
        return '本地Ollama服务地址，默认为 http://localhost:11434';
      default:
        return '请输入API服务地址';
    }
  };

  // 更宽松的 ID 清洗：
  // - 转小写
  // - 非字母数字与 - 的字符替换为 -
  // - 多个 - 合并，一个开头/结尾的 - 去除
  // - 限制长度 [2, 64]
  const sanitizeId = (raw: string): string => {
    let s = (raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    s = s.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    if (s.length > 64) s = s.slice(0, 64);
    return s;
  };

  const saveCustomProvider = async () => {
    const displayName = customDisplayName.trim();
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
      toast.error('请填写服务地址', { description: '服务地址是必填项' });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('无效的服务地址', { description: 'URL 必须以 http:// 或 https:// 开头' });
      return;
    }
    // 验证OpenAI兼容模式的URL格式
    if (customStrategy === 'openai-compatible' && !url.includes('/v1')) {
      const shouldContinue = confirm('检测到您的URL可能不包含 /v1 路径。\n\n大多数OpenAI兼容的API服务需要 /v1 路径（如：https://api.example.com/v1）。\n\n是否继续保存当前地址？');
      if (!shouldContinue) {
        return;
      }
    }
    const baseId = sanitizeId(displayName);
    if (!baseId || baseId.length < 2) {
      toast.error('名称过短', { description: '请使用至少 2 个字符（字母/数字/连字符）' });
      return;
    }
    setIsSavingCustom(true);
    try {
      const list = await providerRepository.getAll();
      const existingNames = new Set(list.map(p=>p.name));
      let finalId = baseId;
      let n = 2;
      while (existingNames.has(finalId)) {
        finalId = `${baseId}-${n++}`;
      }
      // 预先生成并持久化头像到 store：首次渲染即可从本地读取
      const avatarKey = `avatar:${finalId}:18`;
      const avatarSmall = generateAvatarDataUrl(finalId, displayName, 18);
      await StorageUtil.setItem(avatarKey, avatarSmall, 'logo-cache.json');
      await providerRepository.upsert({
        name: finalId,
        url,
        requiresKey: customStrategy !== 'ollama',
        status: customStrategy !== 'ollama' ? ProviderStatus.NO_KEY : ProviderStatus.UNKNOWN,
        lastChecked: 0,
        apiKey: null,
        isUserAdded: true,
        isVisible: true,
        strategy: customStrategy,
        avatarSeed: buildCustomAvatarSeed(finalId),
        displayName,
      });
      await syncDynamicProviders();
      setVisibleMap(m=>({ ...m, [finalId]: true }));
      setCustomProviders(prev => ([...prev, { id: finalId, displayName, url, strategy: customStrategy, isVisible: true }]));
      toast.success('已添加自定义 Provider');
      setCustomModalOpen(false);
    } catch (e:any) {
      console.error(e);
      toast.error('保存失败', { description: e?.message || String(e) });
    }
    setIsSavingCustom(false);
  };

  // —— 编辑 ——
  const startEdit = async (name: string) => {
    try {
      const list = await providerRepository.getAll();
      const target = list.find(p=>p.name===name);
      if (!target) return;
    setCustomName(target.name);
    setCustomDisplayName((target as any).displayName || target.name);
      setCustomUrl(target.url || '');
      setCustomStrategy((target as any).strategy || 'openai-compatible');
      setIsEditMode(true);
      setEditingName(target.name);
      setCustomModalOpen(true);
    } catch(e) { console.error(e);}  
  };

  const saveEditProvider = async () => {
    if (!isEditMode || !editingName) return;
    setIsSavingCustom(true);
    try {
      const url = customUrl.trim();
      if (/[\u4e00-\u9fff]/.test(customDisplayName.trim())) {
        toast.error('名称不支持中文', { description: '请使用英文、数字、空格或连字符 (-)' });
        setIsSavingCustom(false);
        return;
      }
      if (url && !/^https?:\/\//i.test(url)) {
        toast.error('无效的服务地址', { description: 'URL 必须以 http:// 或 https:// 开头' });
        setIsSavingCustom(false);
        return;
      }
      await providerRepository.update({ name: editingName, url, strategy: customStrategy, displayName: customDisplayName.trim() || editingName } as any);
      await syncDynamicProviders();
      setCustomProviders(prev => prev.map(cp => cp.id === editingName ? { ...cp, url: customUrl.trim(), strategy: customStrategy, displayName: customDisplayName.trim() || editingName } : cp));
      toast.success('已保存修改');
      setCustomModalOpen(false);
    } catch (e:any) {
      console.error(e);
      toast.error('保存失败', { description: e?.message || String(e) });
    }
    setIsSavingCustom(false);
  };

  const confirmDelete = async (name: string) => {
    try {
      await providerRepository.deleteByName(name);
      setCustomProviders(prev => prev.filter(cp => cp.id !== name));
      setVisibleMap(prev => { const n = { ...prev }; delete n[name]; return n; });
      toast.success('已删除');
    } catch (e:any) {
      console.error(e);
      toast.error('删除失败', { description: e?.message || String(e) });
    }
  };

  // 打开新增自定义 Provider 弹窗
  const openAddModal = () => {
    setIsEditMode(false);
    setEditingName(null);
    setCustomName('');
    setCustomUrl('');
    setCustomDisplayName('');
    setCustomStrategy('openai-compatible');
    setPreviewAvatar(null);
    setCustomModalOpen(true);
    // 轻微滚动，提示底部存在自定义区
    requestAnimationFrame(()=>{
      listRef.current?.scrollBy({ top: 80, behavior: 'smooth' });
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[92vw] w-[92vw] sm:w-auto sm:max-w-xl box-border p-4 sm:p-5 overflow-hidden max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>添加/管理提供商</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          {/* 为避免在小屏宽度下出现水平溢出，强制容器与输入框不超出 */}
          <Input className="w-full max-w-full min-w-0" placeholder="搜索提供商..." value={keyword} onChange={(e)=>setKeyword(e.target.value)} />
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto rounded-md bg-white/70 dark:bg-gray-900/20 space-y-1.5 px-1">
            {/* 内置分组标签 */}
            <div className="px-2 pt-1 text-[10px] tracking-wide text-gray-400">内置</div>
            {catalog.map((c) => {
              const checked = visibleMap[c.name] ?? false;
              return (
                <label key={c.id} className="flex items-center gap-2.5 py-2 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/40 border border-transparent">
                  <Checkbox checked={checked} onCheckedChange={(v)=>toggle(c.name, !!v)} id={`chk-${c.id}`} />
                  <ProviderIcon id={c.id} name={c.name} />
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`chk-${c.id}`} className="font-medium truncate cursor-pointer select-none">{c.name}</label>
                    <div className="text-xs text-gray-500 truncate">
                      {c.strategy} {c.defaultUrl ? `· ${c.defaultUrl}` : ''} {c.requiresKey ? '· 需要密钥' : ''}
                    </div>
                  </div>
                </label>
              );
            })}
            {catalog.length === 0 && (
              <div className="py-6 text-center text-sm text-gray-500">未找到匹配的提供商</div>
            )}
            {/* 分割线（更轻） */}
            <div className="my-1 mx-2 h-px bg-gray-200/60 dark:bg-gray-700/40" />
            {/* 已添加的自定义 Provider 列表 */}
            {filteredCustoms.length > 0 && (
              <div className="px-2 pt-1 text-[10px] tracking-wide text-gray-400">自定义</div>
            )}
            {filteredCustoms.map((cp) => {
              const id = `chk-custom-${cp.id.replace(/\s+/g,'-')}`;
              const checked = visibleMap[cp.id] ?? cp.isVisible;
              return (
                <div key={cp.id} className="flex items-center gap-2.5 py-2 px-2 group rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/40 border border-transparent">
                  <Checkbox checked={checked} onCheckedChange={(v)=>toggle(cp.id, !!v)} id={id} />
                  {/* 首帧同步拿到 dataURL，避免闪动；后台已预热持久化 */}
                  <ProviderIcon src={getAvatarSync(cp.id || cp.displayName, cp.displayName, 18)} name={cp.displayName} />
                  <div className="flex-1 min-w-0">
                    <label htmlFor={id} className="font-medium truncate cursor-pointer select-none">{cp.displayName}</label>
                    <div className="text-xs text-gray-500 truncate">
                      {(cp.strategy || 'openai-compatible')} {cp.url ? `· ${cp.url}` : ''}
                    </div>
                  </div>
                  {/* 三点菜单 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"><MoreVertical className="w-4 h-4" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6} className="min-w-36">
                      <DropdownMenuItem onClick={()=>startEdit(cp.id)}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> 修改
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onSelect={(e)=>{ e.preventDefault(); }}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> 删除
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认删除该 Provider？</AlertDialogTitle>
                            <AlertDialogDescription>此操作将从当前列表移除该 Provider，但不会删除已配置的密钥和模型参数。</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={()=>confirmDelete(cp.id)}>删除</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
            {filteredCustoms.length === 0 && customProviders.length > 0 && keyword.trim() !== '' && (
              <div className="py-2 text-center text-xs text-gray-400">没有匹配的自定义提供商</div>
            )}
            {/* 自定义 Provider - 新增入口（打开子弹窗） */}
            <div className="py-2 px-1 space-y-2">
              <Button variant="soft" className="w-full" onClick={openAddModal}>
                <Plus className="w-4 h-4" /> 添加自定义 Provider
              </Button>
              <div className="text-xs text-center text-gray-500 px-2">
                支持添加任何OpenAI兼容的API服务
              </div>
            </div>
          </div>
          {/* 顶部触发器即可关闭，此处不再冗余“完成”按钮，简化界面 */}
        </div>
        {/* 二级弹窗：新增/编辑自定义 Provider */}
        {customModalOpen && (
          <Dialog open={customModalOpen} onOpenChange={setCustomModalOpen}>
      <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{isEditMode ? '修改 Provider' : '添加自定义 Provider'}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">名称</label>
                  <Input
                    value={customDisplayName}
                    onChange={(e)=>{
                      const val = e.target.value;
                      setCustomDisplayName(val);
                      const id = sanitizeId(val);
                      if (id && id.length >= 2) setPreviewAvatar(generateAvatarDataUrl(id, val, 40));
                      else setPreviewAvatar(null);
                    }}
                    placeholder="例如：My Provider"
                  />
                </div>
                {previewAvatar && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Image src={previewAvatar} alt="avatar" width={20} height={20} className="rounded-md" />
                    <span>头像预览（保存后将显示）</span>
                  </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">服务地址</label>
                  <Input 
                    value={customUrl} 
                    onChange={(e)=>setCustomUrl(e.target.value)} 
                    placeholder={getPlaceholderUrl(customStrategy)}
                  />
                  <div className="mt-1 text-xs text-gray-500">
                    {getUrlHint(customStrategy)}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">API 策略</label>
                  <Select value={customStrategy} onValueChange={(v)=>setCustomStrategy(v as CatalogStrategy)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择策略" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai-compatible">
                        <div className="flex flex-col">
                          <span>OpenAI 兼容</span>
                          <span className="text-xs text-gray-500">支持大多数第三方API服务</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="openai">
                        <div className="flex flex-col">
                          <span>OpenAI 官方</span>
                          <span className="text-xs text-gray-500">仅适用于OpenAI官方API</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="anthropic">
                        <div className="flex flex-col">
                          <span>Anthropic (Claude)</span>
                          <span className="text-xs text-gray-500">Claude系列模型专用</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini">
                        <div className="flex flex-col">
                          <span>Google AI (Gemini)</span>
                          <span className="text-xs text-gray-500">Google Gemini模型专用</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="deepseek">
                        <div className="flex flex-col">
                          <span>DeepSeek</span>
                          <span className="text-xs text-gray-500">DeepSeek模型专用</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="ollama">
                        <div className="flex flex-col">
                          <span>Ollama</span>
                          <span className="text-xs text-gray-500">本地Ollama服务</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {customStrategy === 'openai-compatible' && (
                    <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                      <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                        <div className="font-medium">OpenAI 兼容模式说明：</div>
                        <div>• 支持标准的 /v1/chat/completions 接口</div>
                        <div>• 适用于大多数第三方API服务商</div>
                        <div>• 包括但不限于：302AI、OpenRouter、Groq、Mistral等</div>
                        <div>• 如果不确定选择哪种策略，推荐使用此模式</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <div>• 头像：将基于名称生成简约图案</div>
                  <div>• 保存后可在"AI模型设置"中配置API密钥和模型</div>
                  {customStrategy === 'openai-compatible' && (
                    <div className="text-blue-600 dark:text-blue-400">
                      • OpenAI兼容模式支持大多数第三方API服务
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="dialogSecondary" onClick={()=>setCustomModalOpen(false)}>取消</Button>
                  <Button variant="dialogPrimary" onClick={isEditMode ? saveEditProvider : saveCustomProvider} disabled={isSavingCustom}>
                    {isSavingCustom ? '保存中...' : '保存'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}


