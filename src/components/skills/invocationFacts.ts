import type { TranslationKey } from '@/i18n/types';
import { invocableByModel, invocableByUser } from '@/lib/skills/invocation';
import type { SkillInvocationPolicy } from '@/lib/skills/types';

/**
 * 触发方式（见 `GLOSSARY.md`）在界面上的说法。
 *
 * 只读是有原因的：这个事实写在 `SKILL.md` 里，用户在 Chatless 里改不动它——要改的是
 * 包，不是开关。而且它不是权限：ADR-0004 把批准留在 `ToolPolicy` 与文件系统白名单那
 * 一侧，所以这里写的是「谁会开始」，不是「能做什么」。默认值也是从那儿来的：持久化的
 * 旧记录没有这个字段，`invocableByModel` 一律按「两者都可」处理，界面上也就跟着显示
 * 默认，而不是显示「未知」。
 */
export function invocationFacts(policy: SkillInvocationPolicy | undefined): {
  labelKey: TranslationKey;
  hintKey: TranslationKey;
} {
  if (!invocableByModel(policy)) {
    return {
      labelKey: 'skills.invocation.userOnly',
      hintKey: 'skills.invocation.hint.userOnly',
    };
  }
  if (!invocableByUser(policy)) {
    return {
      labelKey: 'skills.invocation.modelOnly',
      hintKey: 'skills.invocation.hint.modelOnly',
    };
  }
  return {
    labelKey: 'skills.invocation.modelAndUser',
    hintKey: 'skills.invocation.hint.modelAndUser',
  };
}
