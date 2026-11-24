import { describe, expect, it } from 'vitest';
import type { Skill } from '@/lib/skills/types';
import { takeSkillCommands, userInvocableSkills } from '../skillsSlash';

const skill = (id: string, invocation?: Skill['invocation']): Skill =>
  ({ id, name: id.toUpperCase(), invocation }) as unknown as Skill;

const installed = [skill('pdf-forms'), skill('deploy'), skill('quiet')];

describe('the `/` panel offers the user their half', () => {
  it('hides a skill written for the model alone', () => {
    const list = userInvocableSkills([
      skill('quiet', 'model-only'),
      skill('deploy', 'user-only'),
      skill('pdf-forms'),
    ]);
    expect(list.map((s) => s.id)).toEqual(['deploy', 'pdf-forms']);
  });
});

describe('naming a skill with /id', () => {
  it('reads the name out of the request', () => {
    expect(takeSkillCommands('/deploy 发布一下', installed)).toEqual({
      text: '发布一下',
      explicitIds: ['deploy'],
    });
    expect(takeSkillCommands('please /deploy now', installed).text).toBe(
      'please now',
    );
  });

  it('is case-insensitive about the name and counts each one once', () => {
    expect(takeSkillCommands('/Deploy and /deploy again', installed)).toEqual({
      text: 'and again',
      explicitIds: ['deploy'],
    });
  });

  it('leaves alone what it does not recognize', () => {
    // A path, a fraction, and a name nobody installed.
    for (const text of [
      'read src/lib/x.ts',
      'half is 1/2',
      '/nope hi',
      'http://a/b',
    ]) {
      const result = takeSkillCommands(text, installed);
      expect(result.text, text).toBe(text);
      expect(result.explicitIds, text).toEqual([]);
    }
  });

  it('keeps the policy filter, so a model-only name stays prose', () => {
    // The panel hides `user-invocable: false`, so a user typing the name has not been
    // offered it; consuming the token would claim a request the author ruled out. This
    // used to be the call site's job, and the call site passed every enabled id.
    const withPolicy = [
      skill('quiet', 'model-only'),
      skill('deploy', 'user-only'),
    ];
    expect(takeSkillCommands('/quiet what does this mean', withPolicy)).toEqual(
      {
        text: '/quiet what does this mean',
        explicitIds: [],
      },
    );
    // A skill the model may not load on its own is exactly the one naming exists for.
    expect(
      takeSkillCommands('/deploy ship it', withPolicy).explicitIds,
    ).toEqual(['deploy']);
  });
});

describe('the two token namespaces stay disjoint', () => {
  it('does not read a #shortcut as a skill name', () => {
    // `#name` is a saved prompt shortcut, `/name` is a skill. Reading one as the other
    // would make a shortcut submission silently name a skill.
    expect(takeSkillCommands('#deploy ship it', [skill('deploy')])).toEqual({
      text: '#deploy ship it',
      explicitIds: [],
    });
  });

  it('does not read an @file reference as a skill name', () => {
    expect(takeSkillCommands('@deploy look here', [skill('deploy')])).toEqual({
      text: '@deploy look here',
      explicitIds: [],
    });
  });
});
