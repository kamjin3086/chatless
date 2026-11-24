import { invocableByUser } from '@/lib/skills/invocation';
import { compareById } from '@/lib/skills/skillIndex';
import type { Skill, SkillInvocationPolicy } from '@/lib/skills/types';

/**
 * The `/` panel is the user's half of 触发方式 (skill invocation policy, GLOSSARY):
 * a skill the author marked `user-invocable: false` is knowledge for the model, and a
 * user who never hears of it cannot be meant to choose it. A `disable-model-invocation`
 * skill stays here - naming it by hand is the only way it can be used at all.
 */
export function userInvocableSkills(skills: Skill[]): Skill[] {
  return skills
    .filter((skill) => invocableByUser(skill.invocation))
    .sort(compareById);
}

/**
 * `/${skill.id} ` is what picking from the panel inserts (ChatInput's
 * `pickComposerItem`), so recognising a named skill means matching that token where it
 * stands as a word - not matching the text's *topic*, which is `description`'s job.
 *
 * The token is removed from what the model is asked. A bare `/pdf-forms` carries no
 * instruction, and leaving it in makes the model guess whether it is a path, a command,
 * or noise; the id reaches the prompt as a fact instead.
 *
 * The policy filter belongs here, not at the call site: a caller that forgets it turns a
 * `model-only` skill into something the user appears to have asked for, and the panel
 * already hid it. Typing the name of a skill the author took away from the user stays
 * prose.
 */
export function takeSkillCommands(
  text: string,
  skills: readonly { id: string; invocation?: SkillInvocationPolicy }[],
): { text: string; explicitIds: string[] } {
  const known = (skills || []).filter(
    (skill) => skill?.id && invocableByUser(skill.invocation),
  );
  if (!text.trim() || known.length === 0) return { text, explicitIds: [] };
  const byLower = new Map(
    known.map((skill) => [skill.id.toLowerCase(), skill.id]),
  );
  const explicit: string[] = [];
  // A slash counts only at the start or after whitespace, so paths (`src/lib/x`) and
  // inline fractions stay untouched.
  const cleaned = text.replace(
    /(^|\s)\/([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu,
    (match, lead: string, token: string) => {
      const id = byLower.get(token.toLowerCase());
      if (!id) return match;
      if (!explicit.includes(id)) explicit.push(id);
      return lead;
    },
  );
  // Nothing was named: hand the text back exactly as typed, whitespace and all.
  if (explicit.length === 0) return { text, explicitIds: [] };
  return { text: cleaned.replace(/\s+/g, ' ').trim(), explicitIds: explicit };
}
