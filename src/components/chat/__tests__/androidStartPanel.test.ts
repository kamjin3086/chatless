/**
 * The phone's opening screen: what a person sees in a brand-new chat before they type.
 *
 * A blank wall with a keyboard bolted to the bottom reads as unfinished, so the panel carries a
 * hint and starters whose text is exactly what gets sent. Desktop must keep the single line it
 * has always shown - this surface is additive on the phone only.
 */
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { translate } from '@/i18n';
import { ChatEmptyState } from '../ChatEmptyState';

beforeAll(() => vi.stubGlobal('React', React));

const androidNav = vi.hoisted(() => ({
  current: { openModelSettings: () => {} } as unknown,
}));
const authorized = vi.hoisted(() => ({ current: false }));

vi.mock('../androidChatNavigation', () => ({
  useAndroidChatNavigation: () => androidNav.current,
}));
vi.mock('@/lib/documents/android/androidAuthorizedRoots', () => ({
  hasAndroidAuthorizedFolders: () => Promise.resolve(authorized.current),
}));
vi.mock('../ModelSelector', () => ({ ModelSelector: () => null }));

const zh = (key: Parameters<typeof translate>[1]) => translate('zh', key);
const en = (key: Parameters<typeof translate>[1]) => translate('en', key);

function render(onStarter = () => {}) {
  return renderToStaticMarkup(
    createElement(ChatEmptyState, {
      setupState: 'ready',
      modelPicker: {} as never,
      onStarter,
    }),
  );
}

describe("the phone's opening screen", () => {
  it('gives a hint and two starters that name what they send', () => {
    androidNav.current = { openModelSettings: () => {} };
    authorized.current = false;
    const html = render();
    expect(html).toContain(zh('chatStarter.title'));
    expect(html).toContain(zh('chatStarter.mobileHint'));
    expect(html).toContain(zh('chatStarter.starterTimer'));
    expect(html).toContain(zh('chatStarter.starterSearch'));
    // Readable targets, and the panel is a column of buttons, not one giant heading.
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain('min-h-11');
  });

  it('promises a folder read only once a folder is actually authorized', () => {
    // The grant list is async, so the first paint cannot know: it must not show the promise.
    androidNav.current = { openModelSettings: () => {} };
    authorized.current = true;
    expect(render()).not.toContain(zh('chatStarter.starterFolders'));
  });

  it('leaves the desktop greeting alone', () => {
    androidNav.current = null;
    const html = render();
    expect(html).toContain(zh('chatStarter.title'));
    expect(html).not.toContain('<button');
    expect(html).not.toContain(zh('chatStarter.mobileHint'));
  });

  it('names every starter in both languages', () => {
    for (const key of [
      'chatStarter.mobileHint',
      'chatStarter.starterFolders',
      'chatStarter.starterTimer',
      'chatStarter.starterSearch',
    ] as const) {
      expect(en(key)).not.toBe(key);
      expect(zh(key)).not.toBe(key);
    }
    expect(zh('chatStarter.starterTimer')).toContain('10');
  });
});
