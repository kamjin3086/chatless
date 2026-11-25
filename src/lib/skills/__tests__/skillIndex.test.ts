import { describe, expect, it } from 'vitest';
import {
  buildSkillIndex,
  skillIndexBlocks,
  skillIndexUsable,
  SKILL_DESCRIPTION_MAX_CHARS,
  SKILL_INDEX_BUDGET_CHARS,
  type SkillIndexEntryView,
} from '../skillIndex';

function skill(
  id: string,
  name: string,
  description: string,
  invocation?: SkillIndexEntryView['invocation'],
): SkillIndexEntryView {
  return { id, name, description, invocation };
}

/**
 * An install of `count` skills. `name` controls the name length because the names rung is
 * about names, not descriptions; `descWords` controls the full rung.
 */
function manySkills(
  count: number,
  opts: { name?: (i: number) => string; descWords?: number } = {},
): SkillIndexEntryView[] {
  const nameOf = opts.name ?? ((i: number) => `Skill ${i}`);
  const words = opts.descWords ?? 20;
  return Array.from({ length: count }, (_, i) =>
    skill(`skill-${i}`, nameOf(i), `Description ${i} `.repeat(words)),
  );
}

const CJK = /[\u4e00-\u9fff]/;

describe('what the model is told about skills', () => {
  it('says nothing when there is nothing installed', () => {
    const view = buildSkillIndex([]);
    expect(view.availabilityLine).toBeNull();
    expect(view.indexText).toBeNull();
    expect(skillIndexBlocks(view)).toEqual([]);
  });

  it('gives a standing line and the list as two separate blocks', () => {
    const view = buildSkillIndex([
      skill(
        'pdf-forms',
        'PDF forms',
        'Fill PDF forms. Use when a PDF needs filling.',
      ),
    ]);
    expect(skillIndexBlocks(view).map((b) => [b.id, b.layer, b.order])).toEqual(
      [
        ['skill-availability', 'conversation', 75],
        ['skills-index', 'conversation', 80],
      ],
    );
    expect(view.indexText).toContain('`pdf-forms`');
    expect(view.indexText).toContain('Use when a PDF needs filling.');
    // The list is names: a model that acts on a description alone has not read the guide.
    expect(view.availabilityLine).toContain('skill__guide');
  });

  it('sorts by id, because a locale-sensitive sort drifts the cache prefix', () => {
    const view = buildSkillIndex([
      skill('zeta', 'Alpha skill', 'A'),
      skill('alpha', 'Zeta skill', 'B'),
    ]);
    expect(view.entries.map((e) => e.id)).toEqual(['alpha', 'zeta']);
    expect(view.indexText!.indexOf('alpha')).toBeLessThan(
      view.indexText!.indexOf('zeta'),
    );
  });

  it('keeps the routing half of a long description', () => {
    const long = `${'x'.repeat(SKILL_DESCRIPTION_MAX_CHARS + 100)} Use when files are involved.`;
    const view = buildSkillIndex([skill('a', 'A', long)]);
    const line = view.indexText!.split('\n').find((l) => l.includes('`a`'))!;
    expect(line.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX_CHARS + 64);
    expect(line).toContain('…');
  });

  it('drops descriptions before it drops the list', () => {
    // Past the budget the list used to vanish in one step: on this fixture the full form
    // already overflows at four skills, so anything bigger than a handful got no names at
    // all. Names without descriptions still route - `description` is the routing surface,
    // but an id the model recognises routes too.
    const many = manySkills(40);
    const view = buildSkillIndex(many);
    expect(view.rung).toBe('names');
    expect(view.indexText).not.toBeNull();
    expect(view.indexText).toContain('skill__guide');
    expect(view.indexText).not.toContain('Description 7');
    // All or nothing at every rung: the names rung keeps every skill, by name and by id.
    for (const entry of view.entries) {
      expect(view.indexText!, `missing ${entry.id}`).toContain(entry.name);
      expect(view.indexText!, `missing ${entry.id}`).toContain(
        `(\`${entry.id}\`)`,
      );
    }
    expect(view.entries).toHaveLength(40);
    expect(skillIndexBlocks(view).map((b) => b.id)).toEqual([
      'skill-availability',
      'skills-index',
    ]);
    // The standing line sits above the index block, so it must not claim the list is above.
    expect(view.availabilityLine).toContain('below');
  });

  it('falls back to search when even the names will not fit', () => {
    // 40 skills whose names are long enough that the names rung also overflows.
    const many = manySkills(40, {
      name: (i) => `very-long-skill-name-number-${i}`,
    });
    const view = buildSkillIndex(many);
    expect(view.rung).toBe('none');
    expect(view.indexText).toBeNull();
    expect(view.availabilityLine).toContain('skill__list');
    expect(view.entries).toHaveLength(40);
    expect(skillIndexBlocks(view).map((b) => b.id)).toEqual([
      'skill-availability',
    ]);
    // The budget is a budget: a rung that does not fit is not stretched to fit.
    const small = buildSkillIndex([skill('a', 'A', 'short')]);
    expect(small.indexText!.length).toBeLessThan(SKILL_INDEX_BUDGET_CHARS * 2);
  });

  it('holds the budget at every rung and stays byte-stable there', () => {
    const sets = [
      [skill('a', 'A', 'Reads notes.'), skill('b', 'B', 'Ships the app.')],
      manySkills(40),
      manySkills(40, { name: (i) => `very-long-skill-name-number-${i}` }),
      manySkills(120),
    ];
    for (const set of sets) {
      const forward = buildSkillIndex(set);
      const backward = buildSkillIndex([...set].reverse());
      expect(backward.indexText).toBe(forward.indexText);
      expect(backward.availabilityLine).toBe(forward.availabilityLine);
      if (forward.indexText) {
        expect(
          forward.indexText.length,
          `over budget on a ${set.length}-skill set`,
        ).toBeLessThanOrEqual(SKILL_INDEX_BUDGET_CHARS);
      }
    }
  });

  it('is stable even when two skills share an id', () => {
    // Rare on disk (the directory name is the id), but a sort that cannot decide between
    // two entries renders different bytes for one input, which is exactly what the cached
    // prefix cannot take.
    const pair = [
      skill('same', 'Alpha', 'First.'),
      skill('same', 'Beta', 'Second.'),
    ];
    expect(buildSkillIndex([...pair].reverse()).indexText).toBe(
      buildSkillIndex(pair).indexText,
    );
  });
});

describe('invocation policy at the index', () => {
  it('hides a user-invoked skill from the model and names it on the standing line', () => {
    const view = buildSkillIndex([
      skill('deploy', 'Deploy', 'Deploys the app.', 'user-only'),
      skill('notes', 'Notes', 'Read notes.'),
    ]);
    expect(view.entries.map((e) => e.id)).toEqual(['notes']);
    expect(view.userOnlyIds).toEqual(['deploy']);
    expect(view.availabilityLine).toContain('/deploy');
    expect(view.availabilityLine).toContain('Do not load one unasked');
  });

  it('does not order the model to read what it may not load', () => {
    // Only user-startable skills: "read one with skill__guide before acting" two lines
    // before "do not load one unasked" left the model to resolve a contradiction.
    const view = buildSkillIndex([
      skill('deploy', 'Deploy', 'Deploys the app.', 'user-only'),
    ]);
    expect(view.indexText).toBeNull();
    expect(view.availabilityLine).toContain('/deploy');
    expect(view.availabilityLine).not.toMatch(/before acting on it/);
  });

  it('lets the user name a user-invoked skill through it', () => {
    const view = buildSkillIndex(
      [skill('deploy', 'Deploy', 'Deploys the app.', 'user-only')],
      { explicitIds: ['deploy'] },
    );
    // The standing list stays the model's own half: naming is this turn's business and
    // must not rewrite the list.
    expect(view.entries).toEqual([]);
    expect(view.requested.map((e) => e.id)).toEqual(['deploy']);
    const turn = skillIndexBlocks(view).find(
      (b) => b.id === 'skills-requested',
    );
    expect(turn?.layer).toBe('turn');
    expect(turn?.content).toContain('[user requested - read this guide first]');
  });

  it('leaves a model-only skill in the index', () => {
    const view = buildSkillIndex([
      skill('background', 'Background', 'Quiet knowledge.', 'model-only'),
    ]);
    expect(view.entries.map((e) => e.id)).toEqual(['background']);
    expect(view.userOnlyIds).toEqual([]);
  });
});

describe('what the user asked for this turn', () => {
  const entries = [
    skill('deploy', 'Deploy', 'Deploys the app.', 'user-only'),
    skill('notes', 'Notes', 'Read notes.'),
  ];

  it('is its own turn block, never a rewrite of the index', () => {
    const blocks = skillIndexBlocks(
      buildSkillIndex(entries, { explicitIds: ['deploy'] }),
    );
    const turn = blocks.find((b) => b.id === 'skills-requested');
    expect(turn?.layer).toBe('turn');
    expect(turn?.content).toContain('`deploy`');
    // A turn's facts may not push the cacheable prefix: same entries plus one name must
    // leave the two conversation blocks byte-for-byte identical.
    expect(blocks.filter((b) => b.layer === 'conversation')).toEqual(
      skillIndexBlocks(buildSkillIndex(entries)),
    );
  });

  it('one call is the whole run', () => {
    // An earlier shape made the caller read twice (once without this turn's facts, once
    // with); two reads are two worlds where the blocks came from. One call is the fix.
    const view = buildSkillIndex(entries, { explicitIds: ['deploy'] });
    expect(skillIndexBlocks(view).map((b) => [b.id, b.layer])).toEqual([
      ['skill-availability', 'conversation'],
      ['skills-index', 'conversation'],
      ['skills-requested', 'turn'],
    ]);
  });

  it('says nothing about a name that matches no skill', () => {
    const view = buildSkillIndex([skill('notes', 'Notes', 'Read notes.')], {
      explicitIds: ['ghost'],
    });
    expect(view.requested).toEqual([]);
    expect(skillIndexBlocks(view).map((b) => b.id)).toEqual([
      'skill-availability',
      'skills-index',
    ]);
  });
});

describe('the text is a prompt', () => {
  it('is English and byte-stable for the same set', () => {
    const set = [skill('b', 'B', 'Second.'), skill('a', 'A', 'First.')];
    const first = buildSkillIndex(set);
    const second = buildSkillIndex([...set].reverse());
    expect(first.indexText).toBe(second.indexText);
    expect(first.availabilityLine).toBe(second.availabilityLine);
    expect(first.indexText).not.toMatch(CJK);
    expect(first.availabilityLine).not.toMatch(CJK);
  });
});

describe('whether a run may be told about skills at all', () => {
  // The standing line tells the model to call `skill__guide`. On a track with no way to
  // call anything, that is an instruction pointing at nothing - the same failure #160
  // guards for the knowledge line.
  it('appears on the tracks that can call a tool', () => {
    expect(skillIndexUsable('native', true)).toBe(true);
    expect(skillIndexUsable('prompt', true)).toBe(true);
  });

  it('stays silent on the track with nothing to call', () => {
    expect(skillIndexUsable('disabled', true)).toBe(false);
  });

  it('stays silent when there is no index to point at', () => {
    expect(skillIndexUsable('native', false)).toBe(false);
    expect(skillIndexUsable('disabled', false)).toBe(false);
  });
});
