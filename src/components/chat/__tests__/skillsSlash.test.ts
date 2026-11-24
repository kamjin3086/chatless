import { describe, expect, it } from 'vitest';
import type { Skill } from '@/lib/skills/types';
import { takeSkillCommands, userInvocableSkills } from '../skillsSlash';

const skill = (id: string, invocation?: Skill['invocation']): Skill =>
  ({ id, name: id.toUpperCase(), invocation }) as unknown as Skill;

const ids = ['pdf-forms', 'deploy', 'quiet'];

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
    expect(takeSkillCommands('/deploy 发布一下', ids)).toEqual({
      text: '发布一下',
      explicitIds: ['deploy'],
    });
    expect(takeSkillCommands('please /deploy now', ids).text).toBe(
      'please now',
    );
  });

  it('is case-insensitive about the name and counts each one once', () => {
    expect(takeSkillCommands('/Deploy and /deploy again', ids)).toEqual({
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
      const result = takeSkillCommands(text, ids);
      expect(result.text, text).toBe(text);
      expect(result.explicitIds, text).toEqual([]);
    }
  });
});

describe('the two token namespaces stay disjoint', () => {
  it('does not read a #shortcut as a skill name', () => {
    // `#name` is a saved prompt shortcut, `/name` is a skill. Reading one as the other
    // would make a shortcut submission silently name a skill.
    expect(takeSkillCommands('#deploy ship it', ['deploy'])).toEqual({
      text: '#deploy ship it',
      explicitIds: [],
    });
  });

  it('does not read an @file reference as a skill name', () => {
    expect(takeSkillCommands('@deploy look here', ['deploy'])).toEqual({
      text: '@deploy look here',
      explicitIds: [],
    });
  });
});
