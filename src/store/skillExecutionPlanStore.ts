/**
 * Skill 执行计划 Store
 *
 * 用于承接 instruction-only skills 的“LLM 编译计划 → 人审 → 执行”闭环。
 * 不做持久化（计划通常与会话强绑定，且可能包含敏感命令）。
 */

import { create } from 'zustand';
import type { SkillAction, SkillParameterValues } from '@/lib/skills/types';

export type SkillExecutionPlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SkillExecutionPlanDraft {
  id: string;
  skillId: string;
  goal: string;
  steps: SkillAction[];
  parameters?: SkillParameterValues;
  metadata?: Record<string, unknown>;
  conversationId?: string;
  messageId?: string;
  createdAt: number;
  status: SkillExecutionPlanStatus;
  errorMessage?: string;
}

interface SkillExecutionPlanState {
  plans: Map<string, SkillExecutionPlanDraft>;

  addPlan: (plan: SkillExecutionPlanDraft) => void;
  updatePlan: (id: string, updates: Partial<SkillExecutionPlanDraft>) => void;
  removePlan: (id: string) => void;
  getPlan: (id: string) => SkillExecutionPlanDraft | undefined;
  getAllPlans: () => SkillExecutionPlanDraft[];
  clearAll: () => void;
}

export const useSkillExecutionPlanStore = create<SkillExecutionPlanState>((set, get) => ({
  plans: new Map(),

  addPlan: (plan) => {
    set((state) => {
      const next = new Map(state.plans);
      next.set(plan.id, plan);
      return { plans: next };
    });
  },

  updatePlan: (id, updates) => {
    set((state) => {
      const next = new Map(state.plans);
      const current = next.get(id);
      if (!current) return state;
      next.set(id, { ...current, ...updates });
      return { plans: next };
    });
  },

  removePlan: (id) => {
    set((state) => {
      const next = new Map(state.plans);
      next.delete(id);
      return { plans: next };
    });
  },

  getPlan: (id) => get().plans.get(id),

  getAllPlans: () => Array.from(get().plans.values()).sort((a, b) => b.createdAt - a.createdAt),

  clearAll: () => set({ plans: new Map() }),
}));

