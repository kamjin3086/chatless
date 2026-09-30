import StorageUtil from '@/lib/storage';
import { generateAvatarDataUrl } from '@/lib/avatar';

// 统一的 Provider 头像缓存（内存 + Tauri Store 持久化）
// 设计目标：
// - 首帧同步返回可用 dataURL，避免空白/闪动
// - 后台持久化，不阻塞 UI
// - 去重：相同 seed/size 仅生成一次

const memoryCache = new Map<string, string>(); // key -> dataURL
const PERSIST_FILE = 'logo-cache.json';

function buildKey(seed: string, size: number): string {
  return `avatar:v2:${seed}:${size}`;
}

// 同步获取头像：优先内存，其次即时生成
export function getAvatarSync(seed: string, label: string, size: number): string {
  const key = buildKey(seed, size);
  const existed = memoryCache.get(key);
  if (existed) return existed;
  const data = generateAvatarDataUrl(seed, label, size);
  memoryCache.set(key, data);
  // 后台持久化（不 await）
  queueMicrotask(() => {
    StorageUtil.setItem(key, data, PERSIST_FILE).catch(() => {});
  });
  return data;
}

// 异步回填内存：若磁盘存在则放入内存并返回命中值
export async function ensureAvatarInMemory(seed: string, label: string, size: number): Promise<string> {
  const key = buildKey(seed, size);
  const existed = memoryCache.get(key);
  if (existed) return existed;
  try {
    const persisted = await StorageUtil.getItem<string>(key, null, PERSIST_FILE);
    if (persisted) {
      memoryCache.set(key, persisted);
      return persisted;
    }
  } catch {}
  // 未持久化：生成并持久化
  const data = generateAvatarDataUrl(seed, label, size);
  memoryCache.set(key, data);
  await StorageUtil.setItem(key, data, PERSIST_FILE);
  return data;
}

// 预热一批 provider（可在列表渲染前调用，不阻塞 UI）
export async function prewarmAvatars(items: Array<{ seed: string; label: string }>, size: number = 18): Promise<void> {
  await Promise.all(items.map(async (it) => {
    try { await ensureAvatarInMemory(it.seed, it.label, size); } catch {}
  }));
}

