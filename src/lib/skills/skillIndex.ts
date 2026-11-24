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
  /**
   * Skills the user named in this message that resolve to something installed (sorted).
   * A name that resolves to nothing is dropped rather than reported: better to say nothing
   * than to send the model off to guess at an id that does not exist.
   */
  requested: SkillIndexEntryView[];
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

function indexLine(entry: SkillIndexEntryView): string {
  const name = String(entry.name || entry.id).trim();
  return `- ${name} (\`${entry.id}\`): ${descriptionOf(entry)}`;
}

/**
 * How a named skill is written. The mark is not decoration: when the name already appears
 * in the index, the model needs to know this turn *asked for it*, rather than it being one
 * more thing the model may pick up on its own.
 */
function requestedLine(entry: SkillIndexEntryView): string {
  const name = String(entry.name || entry.id).trim();
  return `- ${name} (\`${entry.id}\`) [user requested - read this guide first]: ${descriptionOf(entry)}`;
}

/**
 * Build the index the model sees from the enabled skills.
 */
export function buildSkillIndex(
  skills: readonly SkillIndexEntryView[],
  facts: SkillIndexFacts = {},
): SkillIndexView {
  const wanted = new Set(
    (facts.explicitIds || []).map((id) => String(id).trim()).filter(Boolean),
  );
  const byId = new Map<string, SkillIndexEntryView>();
  for (const skill of skills) {
    if (skill?.id) byId.set(skill.id, skill);
  }

  // The standing list is only what the model may load by itself; what the user named goes
  // in its own block.
  const sorted = (skills || [])
    .filter((skill) => skill?.id && invocableByModel(skill.invocation))
    .sort(compareById);

  // A named skill must reach the model even if its policy keeps it out of the model's own
  // reach. Only names that resolve count: a name nobody installed is dropped whole, rather
  // than handing the model an id that would return nothing.
  const requested: SkillIndexEntryView[] = [...wanted]
    .map((id) => byId.get(id))
    .filter((entry): entry is SkillIndexEntryView => !!entry)
    .sort(compareById);

  const userOnlyIds = (skills || [])
    .filter(
      (skill) =>
        skill?.id &&
        !invocableByModel(skill.invocation) &&
        invocableByUser(skill.invocation),
    )
    .map((skill) => skill.id)
    .sort();

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

  if (sorted.length === 0) {
    // Nothing here that the model may load by itself. "Read one with skill__guide before
    // acting on it" two lines before "do not load one unasked" is a contradiction left for
    // the model to resolve, so the user-only case gets its own wording.
    const userOnlyLine =
      userOnlyIds.length > 0
        ? [
            '[Skills]',
            `Only the user may start a skill here: ${userOnlyIds.map((id) => `/${id}`).join(', ')}. Do not load one unasked.`,
            'A guide says how to combine the tools you already have, and it grants nothing - approval works as usual.',
          ].join('\n')
        : null;
    return {
      entries: [],
      availabilityLine: userOnlyLine,
      indexText: null,
      overflowed: false,
      userOnlyIds,
      requested,
    };
  }

  const body = [
    '[Skills installed here]',
    'Names only - the instructions are not here.',
    ...sorted.map(indexLine),
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
      requested,
    };
  }

  return {
    entries: sorted,
    availabilityLine: availabilityLines.join('\n'),
    indexText: body,
    overflowed: false,
    userOnlyIds,
    requested,
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
 *
 * A skill the user named goes to the turn layer: that is this turn's fact, and the
 * conversation layer sits inside the cacheable prefix - rewriting a conversation block
 * because "the user named one this turn" drifts the whole system prompt on every
 * rewording. So one call carries both halves: the conversation blocks are decided purely
 * by who may load skills (they never read `explicitIds`), and the named part is its own
 * block. One call is the whole run - two views would be two worlds, and a run must not
 * live between worlds.
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
  if (view.requested.length > 0) {
    blocks.push({
      id: 'skills-requested',
      layer: 'turn',
      order: 15,
      content: [
        '[Skill the user named for this turn]',
        'skill__guide(id) before acting on it:',
        ...view.requested.map(requestedLine),
      ].join('\n'),
    });
  }
  return blocks;
}
