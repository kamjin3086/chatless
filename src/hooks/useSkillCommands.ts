/**
 * 技能快捷命令 Hook
 * 
 * 提供 /skill 命令的解析和处理功能
 * 
 * ## 支持的命令格式
 * 
 * - `/skill` - 列出所有可用技能
 * - `/skill <name>` - 激活并注入指定技能的完整内容
 * - `/skill:list` - 列出所有可用技能
 * - `/skill:help <name>` - 显示技能帮助信息
 * 
 * ## 使用示例
 * 
 * ```tsx
 * const { parseSkillCommand, executeSkillCommand } = useSkillCommands();
 * 
 * if (input.startsWith('/skill')) {
 *   const parsed = parseSkillCommand(input);
 *   if (parsed) {
 *     const result = await executeSkillCommand(parsed);
 *   }
 * }
 * ```
 */

import { useCallback, useState } from 'react';
import { getSkillManager } from '@/lib/skills';
import { useSkillStore } from '@/store/skillStore';
import type { Skill } from '@/lib/skills/types';

/**
 * 技能命令类型
 */
export type SkillCommandType = 
  | 'list'      // 列出所有技能
  | 'activate'  // 激活技能
  | 'help'      // 显示帮助
  | 'unknown';  // 未知命令

/**
 * 解析后的技能命令
 */
export interface ParsedSkillCommand {
  type: SkillCommandType;
  skillId?: string;
  rawInput: string;
  restContent: string; // 命令后的剩余内容
}

/**
 * 技能命令执行结果
 */
export interface SkillCommandResult {
  success: boolean;
  message: string;
  skill?: Skill;
  skills?: Skill[];
  injectedContent?: string; // 要注入到消息中的内容
}

/**
 * 解析 /skill 命令
 */
function parseSkillCommand(input: string): ParsedSkillCommand | null {
  const trimmed = input.trim();
  
  // 必须以 /skill 开头
  if (!trimmed.toLowerCase().startsWith('/skill')) {
    return null;
  }
  
  // /skill:list 格式
  if (trimmed.toLowerCase().startsWith('/skill:list')) {
    const rest = trimmed.slice('/skill:list'.length).trim();
    return {
      type: 'list',
      rawInput: trimmed,
      restContent: rest,
    };
  }
  
  // /skill:help <name> 格式
  const helpMatch = trimmed.match(/^\/skill:help\s+(.+)$/i);
  if (helpMatch) {
    return {
      type: 'help',
      skillId: helpMatch[1].trim(),
      rawInput: trimmed,
      restContent: '',
    };
  }
  
  // /skill <name> 格式
  const activateMatch = trimmed.match(/^\/skill\s+([^\s]+)(?:\s+(.*))?$/i);
  if (activateMatch) {
    return {
      type: 'activate',
      skillId: activateMatch[1].trim(),
      rawInput: trimmed,
      restContent: activateMatch[2]?.trim() || '',
    };
  }
  
  // 单独的 /skill，等同于 list
  if (trimmed.toLowerCase() === '/skill') {
    return {
      type: 'list',
      rawInput: trimmed,
      restContent: '',
    };
  }
  
  return {
    type: 'unknown',
    rawInput: trimmed,
    restContent: '',
  };
}

/**
 * 技能快捷命令 Hook
 */
export function useSkillCommands() {
  const [isProcessing, setIsProcessing] = useState(false);
  const skills = useSkillStore(state => state.skills);
  
  /**
   * 列出所有可用技能
   */
  const listSkills = useCallback(async (): Promise<SkillCommandResult> => {
    try {
      const manager = getSkillManager();
      await manager.initialize();
      
      const enabledSkills = manager.getEnabledSkills();
      
      if (enabledSkills.length === 0) {
        return {
          success: true,
          message: '当前没有启用的技能。请前往"技能管理"页面启用技能。',
          skills: [],
        };
      }
      
      const skillList = enabledSkills
        .map(s => `• **${s.name}** (\`${s.id}\`): ${s.description.slice(0, 100)}...`)
        .join('\n');
      
      return {
        success: true,
        message: `已启用的技能 (${enabledSkills.length} 个):\n\n${skillList}\n\n使用 \`/skill <名称>\` 激活特定技能。`,
        skills: enabledSkills,
      };
    } catch (error) {
      return {
        success: false,
        message: `获取技能列表失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }, []);
  
  /**
   * 激活技能并获取注入内容
   */
  const activateSkill = useCallback(async (skillId: string): Promise<SkillCommandResult> => {
    try {
      const manager = getSkillManager();
      await manager.initialize();
      
      const skill = await manager.getSkill(skillId);
      
      if (!skill) {
        // 尝试模糊匹配
        const allSkills = manager.getEnabledSkills();
        const fuzzyMatch = allSkills.find(
          s => s.name.toLowerCase().includes(skillId.toLowerCase()) ||
               s.id.toLowerCase().includes(skillId.toLowerCase())
        );
        
        if (fuzzyMatch) {
          const content = await manager.getSkillPromptContent(fuzzyMatch.id);
          return {
            success: true,
            message: `已激活技能: ${fuzzyMatch.name}`,
            skill: fuzzyMatch,
            injectedContent: content || undefined,
          };
        }
        
        return {
          success: false,
          message: `未找到技能: "${skillId}"。使用 \`/skill\` 查看可用技能列表。`,
        };
      }
      
      if (!skill.enabled) {
        return {
          success: false,
          message: `技能 "${skill.name}" 未启用。请先在技能管理页面启用它。`,
          skill,
        };
      }
      
      const content = await manager.getSkillPromptContent(skillId);
      
      return {
        success: true,
        message: `已激活技能: ${skill.name}`,
        skill,
        injectedContent: content || undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: `激活技能失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }, []);
  
  /**
   * 显示技能帮助信息
   */
  const showSkillHelp = useCallback(async (skillId: string): Promise<SkillCommandResult> => {
    try {
      const manager = getSkillManager();
      await manager.initialize();
      
      const skill = await manager.getSkill(skillId);
      
      if (!skill) {
        return {
          success: false,
          message: `未找到技能: "${skillId}"`,
        };
      }
      
      const helpContent = `## ${skill.name}

**描述**: ${skill.description}

**状态**: ${skill.enabled ? '已启用' : '未启用'}

**版本**: ${skill.version}

**来源**: ${skill.source === 'local' ? '本地' : '远程'}

${skill.dependencies && skill.dependencies.length > 0 
  ? `**依赖**: ${skill.dependencies.map(d => `${d.name}${d.version ? ` (${d.version})` : ''}`).join(', ')}`
  : ''}

使用 \`/skill ${skill.id}\` 激活此技能。`;
      
      return {
        success: true,
        message: helpContent,
        skill,
      };
    } catch (error) {
      return {
        success: false,
        message: `获取技能帮助失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }, []);
  
  /**
   * 执行技能命令
   */
  const executeSkillCommand = useCallback(async (
    parsed: ParsedSkillCommand
  ): Promise<SkillCommandResult> => {
    setIsProcessing(true);
    
    try {
      switch (parsed.type) {
        case 'list':
          return await listSkills();
        
        case 'activate':
          if (!parsed.skillId) {
            return { success: false, message: '请指定要激活的技能名称' };
          }
          return await activateSkill(parsed.skillId);
        
        case 'help':
          if (!parsed.skillId) {
            return { success: false, message: '请指定要查看帮助的技能名称' };
          }
          return await showSkillHelp(parsed.skillId);
        
        case 'unknown':
        default:
          return {
            success: false,
            message: `未知的技能命令。可用命令:\n• \`/skill\` - 列出可用技能\n• \`/skill <名称>\` - 激活技能\n• \`/skill:help <名称>\` - 查看技能帮助`,
          };
      }
    } finally {
      setIsProcessing(false);
    }
  }, [listSkills, activateSkill, showSkillHelp]);
  
  /**
   * 处理用户输入，如果是技能命令则执行并返回结果
   */
  const handleInput = useCallback(async (
    input: string
  ): Promise<{ handled: boolean; result?: SkillCommandResult; modifiedInput?: string }> => {
    const parsed = parseSkillCommand(input);
    
    if (!parsed) {
      return { handled: false };
    }
    
    const result = await executeSkillCommand(parsed);
    
    // 如果是激活命令且有剩余内容，需要将技能内容注入到消息中
    if (parsed.type === 'activate' && result.success && result.injectedContent) {
      // 构建包含技能上下文的消息
      const skillContext = `[使用技能: ${result.skill?.name}]\n\n${result.injectedContent}\n\n---\n\n`;
      const modifiedInput = parsed.restContent
        ? `${skillContext}${parsed.restContent}`
        : skillContext;
      
      return { 
        handled: true, 
        result,
        modifiedInput,
      };
    }
    
    return { handled: true, result };
  }, [executeSkillCommand]);
  
  return {
    parseSkillCommand,
    executeSkillCommand,
    handleInput,
    listSkills,
    activateSkill,
    showSkillHelp,
    isProcessing,
    enabledSkills: skills.filter(s => s.enabled),
  };
}

export type { Skill };

