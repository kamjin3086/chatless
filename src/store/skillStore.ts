import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Skill, SkillFilterOptions, SkillStatus } from '@/lib/skills/types';

/**
 * Skills Store 状态接口
 */
interface SkillState {
  // 数据
  skills: Skill[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
  
  // 筛选
  filterOptions: SkillFilterOptions;
  
  // UI 状态
  selectedSkillId: string | null;
  drawerOpen: boolean;
  
  // Actions - 数据操作
  setSkills: (skills: Skill[]) => void;
  addSkill: (skill: Skill) => void;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  removeSkill: (id: string) => void;
  
  // Actions - 状态操作
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Actions - 筛选操作
  setFilterOptions: (options: Partial<SkillFilterOptions>) => void;
  resetFilters: () => void;
  
  // Actions - UI 操作
  selectSkill: (id: string | null) => void;
  openDrawer: (skillId: string) => void;
  closeDrawer: () => void;
  
  // Actions - 技能操作
  enableSkill: (id: string) => void;
  disableSkill: (id: string) => void;
  toggleSkill: (id: string) => void;
  
  // Computed - 获取筛选后的技能列表
  getFilteredSkills: () => Skill[];
  
  // 重置
  reset: () => void;
}

const initialFilterOptions: SkillFilterOptions = {
  search: '',
  source: 'all',
  status: 'all',
  enabledOnly: false,
  category: undefined,
};

const initialState = {
  skills: [],
  isLoading: false,
  error: null,
  lastUpdated: null,
  filterOptions: initialFilterOptions,
  selectedSkillId: null,
  drawerOpen: false,
};

export const useSkillStore = create<SkillState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // 数据操作
        setSkills: (skills: Skill[]) => {
          set({ 
            skills, 
            lastUpdated: Date.now(),
            error: null 
          });
        },

        addSkill: (skill: Skill) => {
          set((state) => ({
            skills: [...state.skills, skill]
          }));
        },

        updateSkill: (id: string, updates: Partial<Skill>) => {
          set((state) => ({
            skills: state.skills.map(s => 
              s.id === id ? { ...s, ...updates } : s
            )
          }));
        },

        removeSkill: (id: string) => {
          set((state) => ({
            skills: state.skills.filter(s => s.id !== id),
            selectedSkillId: state.selectedSkillId === id ? null : state.selectedSkillId,
            drawerOpen: state.selectedSkillId === id ? false : state.drawerOpen,
          }));
        },

        // 状态操作
        setLoading: (isLoading: boolean) => {
          set({ isLoading });
        },

        setError: (error: string | null) => {
          set({ error, isLoading: false });
        },

        // 筛选操作
        setFilterOptions: (options: Partial<SkillFilterOptions>) => {
          set((state) => ({
            filterOptions: { ...state.filterOptions, ...options }
          }));
        },

        resetFilters: () => {
          set({ filterOptions: initialFilterOptions });
        },

        // UI 操作
        selectSkill: (id: string | null) => {
          set({ selectedSkillId: id });
        },

        openDrawer: (skillId: string) => {
          set({ 
            selectedSkillId: skillId, 
            drawerOpen: true 
          });
        },

        closeDrawer: () => {
          set({ drawerOpen: false });
        },

        // 技能操作
        enableSkill: (id: string) => {
          set((state) => ({
            skills: state.skills.map(s => 
              s.id === id ? { ...s, enabled: true } : s
            )
          }));
        },

        disableSkill: (id: string) => {
          set((state) => ({
            skills: state.skills.map(s => 
              s.id === id ? { ...s, enabled: false } : s
            )
          }));
        },

        toggleSkill: (id: string) => {
          set((state) => ({
            skills: state.skills.map(s => 
              s.id === id ? { ...s, enabled: !s.enabled } : s
            )
          }));
        },

        // 获取筛选后的技能列表
        getFilteredSkills: () => {
          const { skills, filterOptions } = get();
          let filtered = [...skills];

          // 搜索过滤
          if (filterOptions.search) {
            const searchLower = filterOptions.search.toLowerCase();
            filtered = filtered.filter(s => 
              s.name.toLowerCase().includes(searchLower) ||
              s.description.toLowerCase().includes(searchLower) ||
              s.tags?.some(t => t.toLowerCase().includes(searchLower))
            );
          }

          // 来源过滤
          if (filterOptions.source && filterOptions.source !== 'all') {
            filtered = filtered.filter(s => s.source === filterOptions.source);
          }

          // 状态过滤
          if (filterOptions.status && filterOptions.status !== 'all') {
            filtered = filtered.filter(s => s.status === filterOptions.status);
          }

          // 仅启用过滤
          if (filterOptions.enabledOnly) {
            filtered = filtered.filter(s => s.enabled);
          }

          // 分类过滤
          if (filterOptions.category) {
            filtered = filtered.filter(s => s.category === filterOptions.category);
          }

          return filtered;
        },

        // 重置
        reset: () => {
          set(initialState);
        },
      }),
      {
        name: 'skill-store',
        partialize: (state) => ({
          // 只持久化启用状态和筛选选项
          skills: state.skills.map(s => ({ 
            id: s.id, 
            enabled: s.enabled,
            installedAt: s.installedAt,
          })),
          filterOptions: state.filterOptions,
        }),
      }
    ),
    { name: 'SkillStore' }
  )
);

/**
 * 获取特定技能
 */
export function getSkillById(id: string): Skill | undefined {
  return useSkillStore.getState().skills.find(s => s.id === id);
}

/**
 * 获取选中的技能
 */
export function getSelectedSkill(): Skill | undefined {
  const { skills, selectedSkillId } = useSkillStore.getState();
  return skills.find(s => s.id === selectedSkillId);
}

/**
 * 获取已启用的技能列表
 */
export function getEnabledSkills(): Skill[] {
  return useSkillStore.getState().skills.filter(s => s.enabled);
}

/**
 * 获取特定状态的技能数量
 */
export function getSkillCountByStatus(status: SkillStatus): number {
  return useSkillStore.getState().skills.filter(s => s.status === status).length;
}

