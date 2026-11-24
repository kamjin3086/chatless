import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import type { Skill, SkillInvocationPolicy } from '@/lib/skills/types';
import { invocationFacts } from '../invocationFacts';
import { SkillCard } from '../SkillCard';

let locale: Locale = 'zh';
beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: () => ({
    get locale() {
      return locale;
    },
    t: (key: TranslationKey) => translate(locale, key),
  }),
}));

const KEYS: TranslationKey[] = [
  'skills.invocation',
  'skills.invocation.modelAndUser',
  'skills.invocation.userOnly',
  'skills.invocation.modelOnly',
  'skills.invocation.hint.modelAndUser',
  'skills.invocation.hint.userOnly',
  'skills.invocation.hint.modelOnly',
];

function cardFor(policy: SkillInvocationPolicy | undefined): string {
  const skill = {
    id: 'grilling',
    name: 'Grilling',
    description: 'Stress-test a plan.',
    source: 'local',
    status: 'installed',
    enabled: true,
    invocation: policy,
  } as unknown as Skill;
  return renderToStaticMarkup(createElement(SkillCard, { skill }));
}

/**
 * 触发方式 is read-only in the UI, so this test guards two things: that the three policies
 * tell each other apart (blur them and the field may as well not exist), and that an absent
 * one shows the default rather than "unknown" - older records have no such field,
 * `invocableByModel` reads absence as "both allowed", and the UI must not answer otherwise.
 */
describe('invocation policy display', () => {
  it('names the three policies apart', () => {
    expect(invocationFacts('model-and-user').labelKey).toBe(
      'skills.invocation.modelAndUser',
    );
    expect(invocationFacts('user-only').labelKey).toBe(
      'skills.invocation.userOnly',
    );
    expect(invocationFacts('model-only').labelKey).toBe(
      'skills.invocation.modelOnly',
    );
    // A mapping that collapsed two policies would still pass the three checks above.
    const keys = new Set([
      invocationFacts('model-and-user').labelKey,
      invocationFacts('user-only').labelKey,
      invocationFacts('model-only').labelKey,
    ]);
    expect(keys.size).toBe(3);
  });

  it('lives in the skills.invocation namespace that the docs claim', () => {
    // The repo convention is dot-separated namespaces (`skills.*`), which is also how
    // `flat-messages.test.ts` finds keys; a flat key would resolve and still sit wrong.
    for (const key of KEYS) {
      const inNamespace =
        key === 'skills.invocation' || key.startsWith('skills.invocation.');
      expect(inNamespace, key).toBe(true);
    }
  });

  it('shows the default for a record written before the field existed', () => {
    expect(invocationFacts(undefined).labelKey).toBe(
      'skills.invocation.modelAndUser',
    );
  });

  it('resolves in both languages, without falling back to the key', () => {
    for (const language of ['zh', 'en'] as Locale[]) {
      for (const key of KEYS) {
        const text = translate(language, key);
        expect(text, `${language} is missing ${key}`).toBeTruthy();
        expect(text).not.toBe(key);
      }
    }
  });

  it('says in words that a skill grants nothing', () => {
    // The line the user is most likely to misread as a permission list.
    expect(translate('en', 'skills.invocation.hint.modelAndUser')).toContain(
      'grants no',
    );
  });

  it('says the three labels differently, in both languages', () => {
    for (const language of ['zh', 'en'] as Locale[]) {
      const labels = [
        'skills.invocation.modelAndUser',
        'skills.invocation.userOnly',
        'skills.invocation.modelOnly',
      ].map((key) => translate(language, key as TranslationKey));
      expect(new Set(labels).size, `${language} blurs the policies`).toBe(3);
    }
  });

  it('renders the label and the explanation on the card', () => {
    locale = 'zh';
    expect(cardFor('user-only')).toContain(
      translate('zh', 'skills.invocation.userOnly'),
    );
    expect(cardFor('model-only')).toContain(
      translate('zh', 'skills.invocation.modelOnly'),
    );
    expect(cardFor('model-and-user')).toContain(
      translate('zh', 'skills.invocation.modelAndUser'),
    );

    locale = 'en';
    const html = cardFor('user-only');
    expect(html).toContain(translate('en', 'skills.invocation.userOnly'));
    expect(html).toContain(translate('en', 'skills.invocation.hint.userOnly'));
  });

  it('does not invent a fourth state for an absent policy', () => {
    locale = 'zh';
    const absent = cardFor(undefined);
    expect(absent).toContain(translate('zh', 'skills.invocation.modelAndUser'));
  });
});
