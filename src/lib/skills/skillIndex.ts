import type { PromptBlock } from '@/lib/mcp/prompt/composition';
import type { SkillInvocationPolicy } from './types';
import { invocableByModel, invocableByUser } from './invocation';

/**
 * 技能索引 (Skill index, see `GLOSSARY.md`): the list of skills the model can see on this
 * machine.
 *
 * This is the pure side of a seam; the other side is the provider (`SkillManager`, which
 * owns disk, sources and enabled state). Nothing here reads the store, touches the
 * filesystem or imports Tauri: the input is a narrow view of already-loaded entries, the
 * output is the text that goes into the system prompt, which is what lets the index be
 * tested without an application. That testability is the whole reason it is a seam - the
 * paths into this area that never worked (`PR #230` deleted them: the keyword matcher, the
 * switched-off injection branch, the dead command hook, the stale adapter aliases) each
 * died of being untestable in place.
 *
 * Two orthogonal questions stay separate:
 * - who may start a skill: `invocableByModel`, derived from frontmatter (`invocation.ts`);
 * - whether this machine can run one: applicability (platform, capabilities). No need
 *   exists for it yet, so no idle parameter slot is reserved for it here.
 */

/** Per-description cap. Shorter cuts "Use when …", which is the routing half of the line. */
export const SKILL_DESCRIPTION_MAX_CHARS = 320;

/**
 * Budget for the index body, counted in UTF-16 code units (JS string length), not bytes:
 * a CJK description costs more than one byte per character, so the wire size of a
 * Chinese-heavy index is above this figure. Over budget is not a truncation - the whole
 * list falls back to the standing line, because a half list invites wrong picks.
 */
export const SKILL_INDEX_BUDGET_CHARS = 1200;

/** The narrow view the seam sees - not the 23-field persisted record. */
export interface SkillIndexEntryView {
  id: string;
  name: string;
  description: string;
  invocation?: SkillInvocationPolicy;
}

export interface SkillIndexFacts {
  /** Skills the user named in this message (a named skill lives only as long as the send). */
  explicitIds?: string[];
}

export interface SkillIndexView {
  /** What the model may see (filtered, sorted). */
  entries: SkillIndexEntryView[];
  /** The standing line: only present when skills are available at all. */
  availabilityLine: string | null;
  /** The index body; null when it is over budget, in which case only the line remains. */
  indexText: string | null;
  /** Why there is no index body. */
  overflowed: boolean;
  /** Ids the user may name but the model must not load on its own. */
  userOnlyIds: string[];
}

/**
 * Sort by id: locale-independent and byte-stable, so two machines with the same skills
 * send the same bytes and the cached prompt prefix does not drift. `localeCompare` on
 * `name` does neither.
 */
export function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Can a run act on the index at all? The standing line tells the model to call
 * `skill__guide`, so it must not appear on a track where nothing can be called
 * (`disabled`): that is the same failure #160 guards for the knowledge line.
 */
export function skillIndexUsable(track: string, hasIndex: boolean): boolean {
  return hasIndex && track !== 'disabled';
}

function descriptionOf(entry: SkillIndexEntryView): string {
  const raw = String(entry.description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '(no description)';
  if (raw.length <= SKILL_DESCRIPTION_MAX_CHARS) return raw;
  return `${raw.slice(0, SKILL_DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`;
}

function lineFor(entry: SkillIndexEntryView, requested: Set<string>): string {
  const name = String(entry.name || entry.id).trim();
  const mark = requested.has(entry.id)
    ? ' [user requested - read this guide first]'
    : '';
  return `- ${name} (\`${entry.id}\`)${mark}: ${descriptionOf(entry)}`;
}

/**
 * Build the index the model sees from the enabled skills.
 */
export function buildSkillIndex(
  skills: readonly SkillIndexEntryView[],
  facts: SkillIndexFacts = {},
): SkillIndexView {
  const requested = new Set(
    (facts.explicitIds || []).map((id) => String(id).trim()).filter(Boolean),
  );
  // A skill the user named has to reach the model even if its policy keeps it out of the
  // model's own reach.
  const visible = (skills || []).filter(
    (skill) =>
      skill?.id &&
      (invocableByModel(skill.invocation) || requested.has(skill.id)),
  );
  const sorted = [...visible].sort(compareById);

  const userOnlyIds = (skills || [])
    .filter(
      (skill) =>
        skill?.id &&
        !invocableByModel(skill.invocation) &&
        invocableByUser(skill.invocation),
    )
    .map((skill) => skill.id)
    .sort();

  if (sorted.length === 0) {
    return {
      entries: [],
      availabilityLine: null,
      indexText: null,
      overflowed: false,
      userOnlyIds: [],
    };
  }

  const availabilityLines = [
    '[Skills]',
    'Skills are installed on this device. Read one with skill__guide(id) before acting on it:',
    'a guide says how to combine the tools you already have, and it grants nothing - approval works as usual.',
  ];
  if (userOnlyIds.length > 0) {
    availabilityLines.push(
      `User-invoked only, the user names them: ${userOnlyIds.map((id) => `/${id}`).join(', ')}. Do not load one unasked.`,
    );
  }

  const body = [
    '[Skills installed here]',
    'Names only - the instructions are not here.',
    ...sorted.map((entry) => lineFor(entry, requested)),
  ].join('\n');

  const overflowed = body.length > SKILL_INDEX_BUDGET_CHARS;
  if (overflowed) {
    availabilityLines.push(
      `The list is long (${sorted.length} skills): skill__list(query) searches it.`,
    );
    return {
      entries: sorted,
      availabilityLine: availabilityLines.join('\n'),
      indexText: null,
      overflowed: true,
      userOnlyIds,
    };
  }

  return {
    entries: sorted,
    availabilityLine: availabilityLines.join('\n'),
    indexText: body,
    overflowed: false,
    userOnlyIds,
  };
}

/**
 * Which prompt blocks the index becomes.
 *
 * Two blocks rather than one is not about two pieces of important text: it lets
 * `changedBlockIds` say which part moved. Merged, any change reports the same single
 * block, while these two change at different rates (the line only flips between "skills
 * exist" and "none do"; the body follows the list). Both live in the conversation layer:
 * neither depends on this turn's wording, and putting them in the turn layer would break
 * the cached prefix on every turn for nothing.
 */
export function skillIndexBlocks(view: SkillIndexView): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  if (view.availabilityLine) {
    blocks.push({
      id: 'skill-availability',
      layer: 'conversation',
      order: 75,
      content: view.availabilityLine,
    });
  }
  if (view.indexText) {
    blocks.push({
      id: 'skills-index',
      layer: 'conversation',
      order: 80,
      content: view.indexText,
    });
  }
  return blocks;
}
