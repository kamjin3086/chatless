import { create } from 'zustand';
import StorageUtil from '@/lib/storage';

export interface ModelCheckResult {
  ok: boolean;
  durationMs: number;
  tokenEstimate?: number;
  message?: string;
  /**
   * A caveat on a successful check: the endpoint answered but the probe's own
   * output cap ended the answer before the model wrote anything (#151).
   */
  note?: string;
  timestamp: number; // epoch ms
}

type Key = string; // `${provider}:${model}`

interface ModelCheckState {
  results: Record<Key, ModelCheckResult | undefined>;
  setResult: (provider: string, model: string, data: ModelCheckResult) => void;
  getResult: (provider: string, model: string) => ModelCheckResult | undefined;
  clearProvider: (provider: string) => void;
  clearAll: () => void;
}

export const useModelCheckStore = create<ModelCheckState>((set, get) => ({
  results: {},
  setResult: (provider, model, data) =>
    set((state) => {
      const key = `${provider}:${model}`;
      const next = { ...state.results, [key]: data };
      // 异步持久化（无需阻塞）
      try { StorageUtil.setItem('model_checks', next, 'model-check.json'); } catch {}
      return { results: next };
    }),
  getResult: (provider, model) => get().results[`${provider}:${model}`],
  clearProvider: (provider) =>
    set((state) => {
      const next: Record<Key, ModelCheckResult | undefined> = { ...state.results };
      Object.keys(next).forEach((k) => { if (k.startsWith(provider + ':')) delete next[k]; });
      try { StorageUtil.setItem('model_checks', next, 'model-check.json'); } catch {}
      return { results: next };
    }),
  clearAll: () => { try { StorageUtil.setItem('model_checks', {}, 'model-check.json'); } catch {}; set({ results: {} }); },
}));

// 启动时尝试从磁盘恢复
(async () => {
  try {
    const saved = await StorageUtil.getItem<Record<Key, ModelCheckResult>>('model_checks', {}, 'model-check.json');
    if (saved) useModelCheckStore.setState({ results: saved });
  } catch {}
})();

