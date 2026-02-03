import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { PromptItem, PromptHistory } from '@/types/prompt';

const MAX_HISTORY_PER_PROMPT = 10;

interface PromptState {
  prompts: PromptItem[];
  /** 提示词修改历史，key 为 promptId */
  history: Record<string, PromptHistory[]>;
  ui?: {
    searchQuery: string;
    favoriteOnly: boolean;
    tagFilter: string | null;
    sortBy: 'recent' | 'frequency' | 'name';
  };
}

interface PromptActions {
  createPrompt: (data: Omit<PromptItem, 'id' | 'createdAt' | 'updatedAt' | 'stats'> & { id?: string }) => string;
  updatePrompt: (id: string, updates: Partial<PromptItem>) => void;
  deletePrompt: (id: string) => void;
  importPrompts: (items: Partial<PromptItem>[]) => { created: number; updated: number; skipped: number };
  exportPrompts: () => PromptItem[];
  toggleFavorite: (id: string) => void;
  touchUsage: (id: string) => void;
  setSearchQuery: (q: string) => void;
  setFavoriteOnly: (v: boolean) => void;
  setTagFilter: (tag: string | null) => void;
  setSortBy: (s: 'recent' | 'frequency' | 'name') => void;
  loadFromDatabase: () => Promise<void>;
  /** 获取某个提示词的修改历史 */
  getHistory: (promptId: string) => PromptHistory[];
  /** 从历史记录恢复 */
  restoreFromHistory: (historyId: string) => void;
}

export const usePromptStore = create<PromptState & PromptActions>()(
  persist(
    (set, get) => ({
      prompts: [],
      history: {},
      ui: { searchQuery: '', favoriteOnly: false, tagFilter: null, sortBy: 'recent' },
      // 从数据库加载
      loadFromDatabase: async () => {
        try {
          const repo = DatabaseService.getInstance().getPromptRepository();
          const rows: any[] = await repo.findAll();
          const mapped: PromptItem[] = rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description || '',
            content: r.content,
            tags: JSON.parse(r.tags || '[]'),
            languages: JSON.parse(r.languages || '[]'),
            modelHints: JSON.parse(r.model_hints || '[]'),
            variables: JSON.parse(r.variables || '[]'),
            shortcuts: JSON.parse(r.shortcuts || '[]'),
            favorite: !!r.favorite,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            externalId: r.external_id || undefined,
            stats: JSON.parse(r.stats || '{"uses":0}')
          }));
          set({ prompts: mapped });
        } catch (e) {
          // 忽略加载失败，保持内存数据
        }
      },

      createPrompt: (data) => {
        const normalizeShortcuts = (arr?: string[]) => Array.from(new Set((arr || []).map((s) => String(s).trim().replace(/^\//, '').toLowerCase()).filter(Boolean)));
        const now = Date.now();
        const id = data.id || uuidv4();
        const prompt: PromptItem = {
          id,
          name: data.name,
          description: data.description || '',
          content: data.content,
          tags: data.tags || [],
          languages: data.languages || [],
          modelHints: data.modelHints || [],
          variables: data.variables || [],
          shortcuts: normalizeShortcuts((data as any).shortcuts),
          favorite: !!data.favorite,
          createdAt: now,
          updatedAt: now,
          externalId: data.externalId,
          stats: { uses: 0 },
        };
        set((state) => ({ prompts: [prompt, ...state.prompts] }));
        // 异步持久化到数据库
        try {
          const repo = DatabaseService.getInstance().getPromptRepository();
          repo.create({
            id: prompt.id,
            name: prompt.name,
            description: prompt.description,
            content: prompt.content,
            tags: JSON.stringify(prompt.tags || []),
            languages: JSON.stringify(prompt.languages || []),
            model_hints: JSON.stringify(prompt.modelHints || []),
            variables: JSON.stringify(prompt.variables || []),
            shortcuts: JSON.stringify(prompt.shortcuts || []),
            favorite: prompt.favorite ? 1 : 0,
            created_at: prompt.createdAt,
            updated_at: prompt.updatedAt,
            external_id: prompt.externalId || null,
            stats: JSON.stringify(prompt.stats || { uses: 0 }),
          } as any).catch(()=>{});
        } catch {}
        return id;
      },

      updatePrompt: (id, updates) => {
        const currentPrompt = get().prompts.find(p => p.id === id);
        
        // 检查内容是否有变化，有变化则保存历史
        if (currentPrompt && (
          ('content' in updates && updates.content !== currentPrompt.content) ||
          ('name' in updates && updates.name !== currentPrompt.name) ||
          ('description' in updates && updates.description !== currentPrompt.description)
        )) {
          const historyEntry: PromptHistory = {
            id: uuidv4(),
            promptId: id,
            name: currentPrompt.name,
            content: currentPrompt.content,
            description: currentPrompt.description,
            tags: currentPrompt.tags,
            shortcuts: currentPrompt.shortcuts,
            savedAt: Date.now(),
          };
          
          set((state) => {
            const existing = state.history[id] || [];
            // 保持最多 MAX_HISTORY_PER_PROMPT 条记录
            const updated = [historyEntry, ...existing].slice(0, MAX_HISTORY_PER_PROMPT);
            return { history: { ...state.history, [id]: updated } };
          });
        }
        
        set((state) => ({
          prompts: state.prompts.map((p) => (p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p)),
        }));
        try {
          const repo = DatabaseService.getInstance().getPromptRepository();
          const normalizeShortcuts = (arr?: string[]) => Array.from(new Set((arr || []).map((s) => String(s).trim().replace(/^\//, '').toLowerCase()).filter(Boolean)));
          const toUpdate: any = { ...updates };
          // 注意：必须使用 `in` 判断并删除驼峰字段，避免生成无效列名
          if ('tags' in toUpdate) { toUpdate.tags = JSON.stringify(toUpdate.tags || []); }
          if ('languages' in toUpdate) { toUpdate.languages = JSON.stringify(toUpdate.languages || []); }
          if ('modelHints' in toUpdate) { toUpdate.model_hints = JSON.stringify(toUpdate.modelHints || []); delete toUpdate.modelHints; }
          if ('variables' in toUpdate) { toUpdate.variables = JSON.stringify(toUpdate.variables || []); }
          if ('shortcuts' in toUpdate) { toUpdate.shortcuts = JSON.stringify(normalizeShortcuts(toUpdate.shortcuts)); }
          if (typeof toUpdate.favorite === 'boolean') { toUpdate.favorite = toUpdate.favorite ? 1 : 0; }
          if ('stats' in toUpdate) { toUpdate.stats = JSON.stringify(toUpdate.stats || {}); }
          repo.update(id, toUpdate).catch(()=>{});
        } catch {}
      },

      deletePrompt: (id) => {
        set((state) => ({ prompts: state.prompts.filter((p) => p.id !== id) }));
         try { DatabaseService.getInstance().getPromptRepository().delete(id).catch(()=>{});} catch {}
      },

      importPrompts: (items) => {
        let created = 0;
        let updated = 0;
        let skipped = 0;
        set((state) => {
          const byKey = new Map<string, number>();
          state.prompts.forEach((p, idx) => byKey.set((p.externalId || `${p.name}|${p.languages?.join(',') || ''}`).toLowerCase(), idx));

          const newPrompts = [...state.prompts];
          for (const raw of items) {
            if (!raw || !raw.name || !raw.content) { skipped++; continue; }
            const key = (raw.externalId || `${raw.name}|${(raw.languages || []).join(',')}`).toLowerCase();
            const existsIdx = byKey.get(key);
            if (existsIdx != null) {
              // 覆盖更新策略
              const merged = {
                ...newPrompts[existsIdx],
                ...raw,
                updatedAt: Date.now(),
              } as PromptItem;
              newPrompts[existsIdx] = merged;
              updated++;
            } else {
              const now = Date.now();
              const prompt: PromptItem = {
                id: raw.id || uuidv4(),
                name: raw.name,
                description: raw.description || '',
                content: raw.content,
                tags: raw.tags || [],
                languages: raw.languages || [],
                modelHints: raw.modelHints || [],
                variables: raw.variables || [],
                shortcuts: (raw as any).shortcuts || [],
                favorite: !!raw.favorite,
                createdAt: now,
                updatedAt: now,
                externalId: raw.externalId,
                stats: raw.stats || { uses: 0 },
              };
              newPrompts.unshift(prompt);
              created++;
              try {
                const repo = DatabaseService.getInstance().getPromptRepository();
                repo.create({
                  id: prompt.id,
                  name: prompt.name,
                  description: prompt.description,
                  content: prompt.content,
                  tags: JSON.stringify(prompt.tags || []),
                  languages: JSON.stringify(prompt.languages || []),
                  model_hints: JSON.stringify(prompt.modelHints || []),
                  variables: JSON.stringify(prompt.variables || []),
                shortcuts: JSON.stringify(prompt.shortcuts || []),
                  favorite: prompt.favorite ? 1 : 0,
                  created_at: prompt.createdAt,
                  updated_at: prompt.updatedAt,
                  external_id: prompt.externalId || null,
                  stats: JSON.stringify(prompt.stats || { uses: 0 }),
                } as any).catch(()=>{});
              } catch {}
            }
          }
          return { prompts: newPrompts };
        });
        return { created, updated, skipped };
      },

      exportPrompts: () => get().prompts,

      toggleFavorite: (id) => {
        set((state) => ({
          prompts: state.prompts.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
        }));
        try {
          const cur = get().prompts.find(p=>p.id===id);
          if (cur) {
            DatabaseService.getInstance().getPromptRepository().update(id, { favorite: cur.favorite ? 1 : 0 } as any).catch(()=>{});
          }
        } catch {}
      },

      touchUsage: (id) => {
        set((state) => ({
          prompts: state.prompts.map((p) => (p.id === id ? { ...p, stats: { uses: (p.stats?.uses || 0) + 1, lastUsedAt: Date.now() } } : p)),
        }));
        try {
          const cur = get().prompts.find(p=>p.id===id);
          if (cur) {
            DatabaseService.getInstance().getPromptRepository().update(id, { stats: JSON.stringify(cur.stats || { uses: 0 }) } as any).catch(()=>{});
          }
        } catch {}
      },

      setSearchQuery: (q) => set((state) => ({ ui: { ...(state.ui || { searchQuery: '', favoriteOnly: false, tagFilter: null, sortBy: 'recent' }), searchQuery: q } })),
      setFavoriteOnly: (v) => set((state) => ({ ui: { ...(state.ui || { searchQuery: '', favoriteOnly: false, tagFilter: null, sortBy: 'recent' }), favoriteOnly: v } })),
      setTagFilter: (tag) => set((state) => ({ ui: { ...(state.ui || { searchQuery: '', favoriteOnly: false, tagFilter: null, sortBy: 'recent' }), tagFilter: tag } })),
      setSortBy: (s) => set((state) => ({ ui: { ...(state.ui || { searchQuery: '', favoriteOnly: false, tagFilter: null, sortBy: 'recent' }), sortBy: s } })),
      
      getHistory: (promptId) => {
        return get().history[promptId] || [];
      },
      
      restoreFromHistory: (historyId) => {
        const state = get();
        // 找到历史记录
        let targetHistory: PromptHistory | null = null;
        for (const histories of Object.values(state.history)) {
          const found = histories.find(h => h.id === historyId);
          if (found) {
            targetHistory = found;
            break;
          }
        }
        if (!targetHistory) return;
        
        // 更新提示词
        const { updatePrompt } = get();
        updatePrompt(targetHistory.promptId, {
          name: targetHistory.name,
          content: targetHistory.content,
          description: targetHistory.description,
          tags: targetHistory.tags,
          shortcuts: targetHistory.shortcuts,
        });
      },
    }),
    { name: 'prompt-store' }
  )
);

