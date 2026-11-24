import type { SkillFrontmatter, SkillInvocationPolicy } from './types';

/**
 * 触发方式 (skill invocation policy, see `GLOSSARY.md`): who may start a Skill.
 *
 * This is one of two orthogonal questions; the other is applicability - whether this
 * machine has what the Skill needs. Both are answered by a predicate and applied in one
 * filter pass, but they must not collapse into a single boolean: a Skill can be usable
 * here and still not be the model's to start.
 *
 * The verdict comes from the SKILL.md frontmatter, never from a user preference:
 * - `disable-model-invocation: true` - the model may not load it on its own; the user can
 *   still name it explicitly.
 * - `user-invocable: false` - hidden from the `/` panel; only the model can use it.
 * When both hold, `user-only` wins: letting the model load something unasked is the more
 * dangerous side, so it is the one that gets refused.
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

/** Can the model load this on its own? True for everything except `user-only`. */
export function invocableByModel(
  policy: SkillInvocationPolicy | undefined,
): boolean {
  // Absent means undeclared, which means both may. Records persisted before the field
  // existed must not become unusable because of it.
  return (policy ?? 'model-and-user') !== 'user-only';
}

/** Can the user name it in the `/` panel? True for everything except `model-only`. */
export function invocableByUser(
  policy: SkillInvocationPolicy | undefined,
): boolean {
  return (policy ?? 'model-and-user') !== 'model-only';
}
