import type { SkillFrontmatter, SkillInvocationPolicy } from './types';

/**
 * 触发方式（skill invocation policy）：谁能启动一个 Skill。
 *
 * 这是两件不同的事之一，另一件是「适用性」（这个 Skill 在这台机器上能不能用）：
 * 触发方式讲的是谁可以按下开始键，适用性讲的是这台机器有没有它需要的东西。
 * 两者都用一个谓词表达、一次过滤完成，但判据不同，不能合成一个布尔。
 *
 * 判据来自 SKILL.md 的 frontmatter，而不是用户偏好：
 * - `disable-model-invocation: true` → 模型不能自动加载（用户仍可显式指定）；
 * - `user-invocable: false` → 从 `/` 面板隐藏（只有模型能用）。
 * 两个开关同时成立时取 `user-only`：让模型自动加载是更危险的那一侧，先否掉它。
 */
export function invocationPolicyOf(
  frontmatter:
    | Pick<SkillFrontmatter, 'disable-model-invocation' | 'user-invocable'>
    | null
    | undefined,
): SkillInvocationPolicy {
  if (!frontmatter) return 'model-and-user';
  if (frontmatter['disable-model-invocation'] === true) return 'user-only';
  if (frontmatter['user-invocable'] === false) return 'model-only';
  return 'model-and-user';
}

/** 模型能否自己加载这个 Skill。`user-only` 之外的策略都为真。 */
export function invocableByModel(
  policy: SkillInvocationPolicy | undefined,
): boolean {
  // 缺席 = 未声明 = 默认两者都可。持久化过的旧记录没有这个字段，不能因此变得不可用。
  return (policy ?? 'model-and-user') !== 'user-only';
}

/** 用户能否在 `/` 面板里点名它。`model-only` 之外都为真。 */
export function invocableByUser(
  policy: SkillInvocationPolicy | undefined,
): boolean {
  return (policy ?? 'model-and-user') !== 'model-only';
}
