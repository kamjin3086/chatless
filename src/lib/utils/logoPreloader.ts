import type { ProviderMetadata, ModelMetadata } from '@/lib/metadata/types';
import { getModelLogoKey } from '@/lib/provider/staticModels';
import { AVAILABLE_PROVIDERS_CATALOG } from '@/lib/provider/catalog';
import StorageUtil from '@/lib/storage';

// 全局已预加载与失败缓存，避免重复请求
const preloadedUrlSet = new Set<string>();
const failedUrlSet = new Set<string>();
const resolvedBaseToUrl = new Map<string, string>(); // base(去后缀) → 命中的URL

// —— 本地持久化（StorageUtil / Tauri Store）——
const STORE_FILE = 'logo-cache.json';
const MISSING_KEY = 'missingUrls';
const RESOLVED_KEY = 'resolvedMap';

let cachesLoaded = false;
let loadPromise: Promise<void> | null = null;

async function loadPersistedCaches(): Promise<void> {
  if (cachesLoaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const miss = (await StorageUtil.getItem<string[]>(MISSING_KEY, [], STORE_FILE)) || [];
      miss.forEach((u) => failedUrlSet.add(u));
    } catch {}
    try {
      const map = (await StorageUtil.getItem<Record<string, string>>(RESOLVED_KEY, {}, STORE_FILE)) || {};
      Object.entries(map).forEach(([b, u]) => { if (u) resolvedBaseToUrl.set(b, u); });
    } catch {}
    cachesLoaded = true;
  })();
  return loadPromise;
}

let persistTimer: number | null = null;
let iconsIndexMergedOnce = false; // 仅会在本次会话中合并一次
function persistCachesSoon() {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(async () => {
    try {
      await StorageUtil.setItem(MISSING_KEY, Array.from(failedUrlSet).slice(-2000), STORE_FILE);
      const obj: Record<string, string> = {};
      resolvedBaseToUrl.forEach((v, k) => (obj[k] = v));
      await StorageUtil.setItem(RESOLVED_KEY, obj, STORE_FILE);
    } catch {}
    persistTimer = null;
  }, 400);
}

// 对外辅助：等待缓存加载完毕，并合入静态存在表
export async function ensureLogoCacheReady(): Promise<void> {
  await loadPersistedCaches();
  if (iconsIndexMergedOnce) return;
  iconsIndexMergedOnce = true;
  try {
    const resp = await fetch('/llm-provider-icon/_index.json', { cache: 'no-cache' }).catch(() => null);
    if (resp && resp.ok) {
      const json: any = await resp.json().catch(() => null);
      if (json && Array.isArray(json.files)) {
        for (const f of json.files) {
          const m = f.match(/^(.*)\.(svg|png|webp|jpeg|jpg)$/i);
          if (!m) continue;
          const base = `/llm-provider-icon/${m[1]}`;
          const url = `/llm-provider-icon/${f}`;
          resolvedBaseToUrl.set(base, url);
          // 若此前被标记为缺失，则移除负缓存，允许重新尝试
          failedUrlSet.delete(url);
        }
        persistCachesSoon();
      }
    }
  } catch {}
}

// 对外辅助：标记缺失与命中，供组件在运行时更新缓存
export function markUrlMissing(url: string) {
  failedUrlSet.add(url);
  persistCachesSoon();
}

export function markResolvedBase(base: string, url: string) {
  preloadedUrlSet.add(url);
  resolvedBaseToUrl.set(base, url);
  persistCachesSoon();
}

/**
 * 返回当前内存中已知的图标“基名”列表（不含扩展名），仅限于 /llm-provider-icon 目录。
 * 该列表来自于：
 *  - 运行时命中写入（markResolvedBase）
 *  - ensureLogoCacheReady() 合并 _index.json 时的批量注入
 */
export function getKnownIconBasesSync(): string[] {
  const result: string[] = [];
  const prefix = '/llm-provider-icon/';
  resolvedBaseToUrl.forEach((_url, base) => {
    if (base.startsWith(prefix)) {
      result.push(base.slice(prefix.length));
    }
  });
  return result;
}

// 可探测的图片扩展名与候选目录（与项目资源保持一致）
// 优先尝试 png（项目中绝大多数为 png），降低首个 404 的概率
const IMAGE_EXTS = ['png', 'svg', 'webp', 'jpeg', 'jpg'] as const;
// 仅使用项目已存在的目录，避免 /logos、/images/brands 产生 404
const LOGO_DIRS = ['/llm-provider-icon'] as const;

// 预加载单个图片
function getBaseKeyFromUrl(url: string): string | null {
  const m = url.match(/^(.*)\.(svg|png|webp|jpeg|jpg)$/i);
  return m ? m[1] : null;
}

function preloadImage(url: string): Promise<boolean> {
  if (!url || preloadedUrlSet.has(url)) return Promise.resolve(true);
  if (failedUrlSet.has(url)) return Promise.resolve(false);
  // data:image 直接缓存标记即可（无需网络）
  if (url.startsWith('data:image')) { preloadedUrlSet.add(url); return Promise.resolve(true); }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.referrerPolicy = 'no-referrer';
      img.onload = async () => {
        preloadedUrlSet.add(url);
        const base = getBaseKeyFromUrl(url);
        if (base) resolvedBaseToUrl.set(base, url);
        persistCachesSoon();
        resolve(true);
      };
      img.onerror = () => {
        failedUrlSet.add(url);
        persistCachesSoon();
        resolve(false);
      };
      img.src = url;
    } catch {
      failedUrlSet.add(url);
      persistCachesSoon();
      resolve(false);
    }
  });
}

// 简易并发控制（直接对 URL 尝试加载）
async function runWithConcurrency(urls: string[], concurrency: number = 6) {
  const queue = urls.slice();
  const workers: Promise<void>[] = [];
  const next = async () => {
    const url = queue.shift();
    if (!url) return;
    await preloadImage(url);
    if (queue.length) await next();
  };
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(next());
  }
  await Promise.all(workers);
}

// 顺序尝试候选列表，命中第一个即可；全部失败则记入失败缓存
async function preloadFirstAvailable(candidates: string[]): Promise<void> {
  if (candidates.length === 0) return;
  // 若已记录 base → 命中 URL，则直接加载该 URL
  const base = getBaseKeyFromUrl(candidates[0]);
  if (base && resolvedBaseToUrl.has(base)) {
    const url = resolvedBaseToUrl.get(base)!;
    if (!preloadedUrlSet.has(url) && !failedUrlSet.has(url)) await preloadImage(url);
    return;
  }
  for (const url of candidates) {
    if (preloadedUrlSet.has(url)) return; // 已命中
    if (failedUrlSet.has(url)) continue;  // 已失败过，跳过
    const ok = await preloadImage(url);
    if (ok) return;
  }
}

// 构造 Provider 图标候选 URL 列表
function buildProviderIconCandidates(provider: Pick<ProviderMetadata, 'name' | 'icon'>): string[] {
  const list: string[] = [];
  const icon = provider.icon || '';
  if (!icon) {
    // 依据名称推导公共目录图标
    const slug = provider.name.toLowerCase().replace(/\s+/g, '-');
    for (const ext of IMAGE_EXTS) list.push(`/llm-provider-icon/${slug}.${ext}`);
    return list;
  }
  if (icon.startsWith('data:image')) return [icon];
  if (icon.startsWith('/llm-provider-icon/')) {
    const base = icon.replace(/\.(svg|png|webp|jpeg|jpg)$/i, '');
    for (const ext of IMAGE_EXTS) list.push(`${base}.${ext}`);
    return list;
  }
  // 其它 http(s)/相对路径：直接尝试一次
  list.push(icon);
  return list;
}

// 构造 Model 品牌 logo 候选 URL 列表
function buildModelLogoCandidates(model: Pick<ModelMetadata, 'name'>, providerName: string): string[] {
  const key = getModelLogoKey(model.name, { providerName });
  const list: string[] = [];
  for (const dir of LOGO_DIRS) {
    for (const ext of IMAGE_EXTS) list.push(`${dir}/${key}.${ext}`);
  }
  return list;
}

export async function preloadProviderAndModelLogos(
  providers: Array<Pick<ProviderMetadata, 'name' | 'icon' | 'models'>>,
  options?: { maxConcurrency?: number }
) {
  try {
    const tasks: Array<() => Promise<void>> = [];
    for (const p of providers) {
      const provCandidates = buildProviderIconCandidates({ name: p.name, icon: (p as any).icon });
      tasks.push(() => preloadFirstAvailable(provCandidates));
      for (const m of p.models || []) {
        const modelCandidates = buildModelLogoCandidates({ name: m.name }, p.name);
        tasks.push(() => preloadFirstAvailable(modelCandidates));
      }
    }
    // 简易并发执行任务
    const concurrency = options?.maxConcurrency ?? 8;
    let index = 0;
    const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (index < tasks.length) {
        const i = index++;
        await tasks[i]();
      }
    });
    await Promise.all(runners);
  } catch {
    // 静默失败
  }
}

export function markLogosAsPreloaded(urls: string[]) {
  urls.forEach((u) => preloadedUrlSet.add(u));
}

// —— 额外：应用启动即预加载通用 Provider 与常见品牌 Logo ——
const COMMON_BRAND_KEYS = [
  'openai','anthropic','google-ai','deepseek','qwen','mistral','groq','zhipu','moonshot','yi','llama','voyageai','cohere','perplexity','jina','stability','ideogram','flux','imagen','luma','runway','sora','veo','kling','pixverse','hunyuan','baichuan','reka','elevenlabs','topazlabs','clarity','cartesia','orpheus','playai','unreal-speech','together','openrouter','orcarouter','mixroute','novita','poe'
] as const;

export async function preloadInitialLogos() {
  try {
    // 懒启动：空闲时执行，不阻塞首屏
    const run = async () => {
      // 仅预加载目录内“存在概率最高”的 Provider 图标，避免无意义 404
      const tasks: Array<() => Promise<void>> = [];
      for (const p of AVAILABLE_PROVIDERS_CATALOG) {
        const base = `/llm-provider-icon/${p.id}`;
        const candidates = IMAGE_EXTS.map((ext) => `${base}.${ext}`);
        tasks.push(() => preloadFirstAvailable(candidates));
      }
      const concurrency = 6;
      let index = 0;
      const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
        while (index < tasks.length) {
          const i = index++;
          await tasks[i]();
        }
      });
      await Promise.all(runners);
    };

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 300);
    }
  } catch {}
}

// 初始化时加载本地缓存
// 异步预取，不阻塞主线程
loadPersistedCaches().catch(() => {});

// —— 提供给组件的查询辅助 ——
export function getResolvedUrlForBase(base: string): string | null {
  return resolvedBaseToUrl.get(base) || null;
}

export function isUrlKnownMissing(url: string): boolean {
  return failedUrlSet.has(url);
}

// —— 通用：预加载任意 URL 列表（去重、并发） ——
export async function preloadUrls(urls: string[], maxConcurrency: number = 8) {
  const uniq = Array.from(new Set(urls)).filter((u) => !!u && !preloadedUrlSet.has(u) && !failedUrlSet.has(u));
  if (uniq.length === 0) return;
  await runWithConcurrency(uniq, maxConcurrency);
}


