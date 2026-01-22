/**
 * Skill 动作授权状态管理
 * 
 * 独立于 MCP 授权系统，专门管理 Skill 动作的审批流程
 */

import { create } from 'zustand';
import type { 
  PendingSkillAction,
  SkillAction,
  SkillActionResult,
  SkillActionStatus,
  SkillExecutionContext,
  SkillRiskLevel,
} from '@/lib/skills/types';

/**
 * Skill 授权策略
 */
export interface SkillAuthPolicy {
  /** 需要审批的风险等级 */
  requireApprovalFor: SkillRiskLevel[];
  /** 是否记住用户选择 */
  rememberChoices: boolean;
  /** 选择记忆有效期（毫秒） */
  choiceExpiryMs: number;
  /** 审批超时时间（毫秒） */
  approvalTimeoutMs: number;
  /** 是否允许用户修改命令 */
  allowCommandModification: boolean;
}

/**
 * 用户选择记录
 */
interface UserChoice {
  /** Skill ID */
  skillId: string;
  /** 动作 ID */
  actionId: string;
  /** 用户选择 */
  action: 'allow_always' | 'deny_always';
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
}

/**
 * Skill 授权 Store 状态
 */
interface SkillAuthState {
  /** 待审批的动作列表 */
  pendingActions: Map<string, PendingSkillAction>;
  
  /** 用户选择记录 */
  userChoices: Map<string, UserChoice>;
  
  /** 授权策略 */
  policy: SkillAuthPolicy;
  
  /** 动作执行结果 */
  actionResults: Map<string, SkillActionResult>;
  
  // ========== 待审批动作管理 ==========
  
  /** 添加待审批动作 */
  addPendingAction: (action: PendingSkillAction) => void;
  
  /** 批准动作 */
  approveAction: (id: string) => void;
  
  /** 拒绝动作 */
  rejectAction: (id: string) => void;
  
  /** 修改后执行动作 */
  modifyAndApproveAction: (id: string, modifiedCommand: string) => void;
  
  /** 移除待审批动作 */
  removePendingAction: (id: string) => void;
  
  /** 获取待审批动作 */
  getPendingAction: (id: string) => PendingSkillAction | undefined;
  
  /** 检查是否有待审批动作 */
  hasPendingAction: (id: string) => boolean;
  
  /** 获取所有待审批动作 */
  getAllPendingActions: () => PendingSkillAction[];
  
  /** 清除所有待审批动作 */
  clearAllPendingActions: () => void;
  
  // ========== 用户选择管理 ==========
  
  /** 记住用户选择 */
  rememberChoice: (skillId: string, actionId: string, choice: 'allow_always' | 'deny_always') => void;
  
  /** 获取用户选择 */
  getChoice: (skillId: string, actionId: string) => UserChoice | null;
  
  /** 清除用户选择 */
  clearChoices: () => void;
  
  /** 检查动作是否需要审批 */
  needsApproval: (action: SkillAction) => boolean;
  
  // ========== 策略管理 ==========
  
  /** 更新策略 */
  updatePolicy: (policy: Partial<SkillAuthPolicy>) => void;
  
  // ========== 结果管理 ==========
  
  /** 添加执行结果 */
  addActionResult: (result: SkillActionResult) => void;
  
  /** 获取执行结果 */
  getActionResult: (actionId: string) => SkillActionResult | undefined;
  
  /** 清除所有结果 */
  clearResults: () => void;
}

/**
 * 默认授权策略
 */
const DEFAULT_POLICY: SkillAuthPolicy = {
  requireApprovalFor: ['medium', 'high', 'critical'],
  rememberChoices: true,
  choiceExpiryMs: 30 * 60 * 1000, // 30 分钟
  approvalTimeoutMs: 60 * 1000, // 60 秒
  allowCommandModification: true,
};

/**
 * 生成选择记录的键
 */
function getChoiceKey(skillId: string, actionId: string): string {
  return `${skillId}:${actionId}`;
}

/**
 * Skill 授权 Store
 */
export const useSkillAuthStore = create<SkillAuthState>((set, get) => ({
  pendingActions: new Map(),
  userChoices: new Map(),
  policy: DEFAULT_POLICY,
  actionResults: new Map(),

  // ========== 待审批动作管理 ==========

  addPendingAction: (action) => {
    set((state) => {
      const newMap = new Map(state.pendingActions);
      newMap.set(action.id, action);
      return { pendingActions: newMap };
    });
  },

  approveAction: (id) => {
    const action = get().getPendingAction(id);
    if (action) {
      // 调用批准回调
      action.onApprove();
      get().removePendingAction(id);
    }
  },

  rejectAction: (id) => {
    const action = get().getPendingAction(id);
    if (action) {
      // 调用拒绝回调
      action.onReject();
      get().removePendingAction(id);
    }
  },

  modifyAndApproveAction: (id, modifiedCommand) => {
    const action = get().getPendingAction(id);
    if (action && action.onModify) {
      // 调用修改回调
      action.onModify(modifiedCommand);
      get().removePendingAction(id);
    } else if (action) {
      // 如果没有修改回调，直接批准
      action.onApprove();
      get().removePendingAction(id);
    }
  },

  removePendingAction: (id) => {
    set((state) => {
      const newMap = new Map(state.pendingActions);
      newMap.delete(id);
      return { pendingActions: newMap };
    });
  },

  getPendingAction: (id) => {
    return get().pendingActions.get(id);
  },

  hasPendingAction: (id) => {
    return get().pendingActions.has(id);
  },

  getAllPendingActions: () => {
    return Array.from(get().pendingActions.values());
  },

  clearAllPendingActions: () => {
    // 拒绝所有待审批动作
    const actions = get().getAllPendingActions();
    for (const action of actions) {
      action.onReject();
    }
    set({ pendingActions: new Map() });
  },

  // ========== 用户选择管理 ==========

  rememberChoice: (skillId, actionId, choice) => {
    const { policy } = get();
    if (!policy.rememberChoices) return;

    const key = getChoiceKey(skillId, actionId);
    const now = Date.now();
    
    set((state) => {
      const newMap = new Map(state.userChoices);
      newMap.set(key, {
        skillId,
        actionId,
        action: choice,
        createdAt: now,
        expiresAt: now + policy.choiceExpiryMs,
      });
      return { userChoices: newMap };
    });
  },

  getChoice: (skillId, actionId) => {
    const key = getChoiceKey(skillId, actionId);
    const choice = get().userChoices.get(key);
    
    if (!choice) return null;
    
    // 检查是否过期
    if (Date.now() > choice.expiresAt) {
      // 移除过期选择
      set((state) => {
        const newMap = new Map(state.userChoices);
        newMap.delete(key);
        return { userChoices: newMap };
      });
      return null;
    }
    
    return choice;
  },

  clearChoices: () => {
    set({ userChoices: new Map() });
  },

  needsApproval: (action) => {
    const { policy, getChoice } = get();
    
    // 检查动作本身是否配置了不需要审批
    if (action.requiresApproval === false) {
      return false;
    }
    
    // 检查是否有"始终允许"的用户选择
    // 注意：这里需要 skillId，但 action 中没有，需要在调用时传入
    // 暂时只检查策略
    
    const riskLevel = action.riskLevel || 'medium';
    return policy.requireApprovalFor.includes(riskLevel);
  },

  // ========== 策略管理 ==========

  updatePolicy: (newPolicy) => {
    set((state) => ({
      policy: { ...state.policy, ...newPolicy },
    }));
  },

  // ========== 结果管理 ==========

  addActionResult: (result) => {
    set((state) => {
      const newMap = new Map(state.actionResults);
      newMap.set(result.actionId, result);
      return { actionResults: newMap };
    });
  },

  getActionResult: (actionId) => {
    return get().actionResults.get(actionId);
  },

  clearResults: () => {
    set({ actionResults: new Map() });
  },
}));

/**
 * 创建待审批动作
 */
export function createPendingSkillAction(
  skillId: string,
  skillName: string,
  action: SkillAction,
  context: SkillExecutionContext,
  options: {
    resolvedCommand?: string;
    resolvedArgs?: string[];
    timeoutMs?: number;
    onApprove: () => void;
    onReject: () => void;
    onModify?: (modifiedCommand: string) => void;
  }
): PendingSkillAction {
  return {
    id: `pending-${skillId}-${action.id}-${Date.now()}`,
    skillId,
    skillName,
    action,
    resolvedCommand: options.resolvedCommand,
    resolvedArgs: options.resolvedArgs,
    context,
    createdAt: Date.now(),
    timeoutMs: options.timeoutMs || DEFAULT_POLICY.approvalTimeoutMs,
    onApprove: options.onApprove,
    onReject: options.onReject,
    onModify: options.onModify,
  };
}

/**
 * 获取风险等级显示信息
 */
export function getRiskLevelInfo(level: SkillRiskLevel): {
  label: string;
  color: string;
  bgColor: string;
  description: string;
} {
  switch (level) {
    case 'safe':
      return {
        label: '安全',
        color: 'text-green-600 dark:text-green-400',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
        description: '此操作是安全的，不会对系统造成影响',
      };
    case 'low':
      return {
        label: '低风险',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
        description: '此操作风险较低，通常是读取操作',
      };
    case 'medium':
      return {
        label: '中等风险',
        color: 'text-yellow-600 dark:text-yellow-400',
        bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
        description: '此操作可能修改文件或安装软件包',
      };
    case 'high':
      return {
        label: '高风险',
        color: 'text-orange-600 dark:text-orange-400',
        bgColor: 'bg-orange-100 dark:bg-orange-900/30',
        description: '此操作需要管理员权限或可能影响系统配置',
      };
    case 'critical':
      return {
        label: '关键风险',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-100 dark:bg-red-900/30',
        description: '此操作可能导致不可逆的系统更改',
      };
  }
}

