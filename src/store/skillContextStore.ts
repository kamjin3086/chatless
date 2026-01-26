/**
 * Skill 上下文 Store
 * 
 * 用于在工具调用间传递 skill 的上下文信息（路径、资源等）
 * 当 LLM 调用 get_skill_instructions 后，该 store 会记录最近的 skill 上下文
 * 后续的 filesystem/shell_executor 调用可以自动使用这个上下文
 */

import { create } from 'zustand';
import type { SkillContextMetadata } from '@/lib/skills/types/SkillContext';

interface SkillContextState {
  /** 当前会话的 skill 上下文（按 conversationId 索引） */
  contexts: Map<string, SkillContextMetadata>;
  
  /** 设置会话的 skill 上下文 */
  setContext: (conversationId: string, context: SkillContextMetadata) => void;
  
  /** 获取会话的 skill 上下文 */
  getContext: (conversationId: string) => SkillContextMetadata | undefined;
  
  /** 清除会话的 skill 上下文 */
  clearContext: (conversationId: string) => void;
  
  /** 清除所有上下文 */
  clearAll: () => void;
}

export const useSkillContextStore = create<SkillContextState>((set, get) => ({
  contexts: new Map(),
  
  setContext: (conversationId, context) => {
    set((state) => {
      const next = new Map(state.contexts);
      next.set(conversationId, context);
      return { contexts: next };
    });
  },
  
  getContext: (conversationId) => get().contexts.get(conversationId),
  
  clearContext: (conversationId) => {
    set((state) => {
      const next = new Map(state.contexts);
      next.delete(conversationId);
      return { contexts: next };
    });
  },
  
  clearAll: () => set({ contexts: new Map() }),
}));
