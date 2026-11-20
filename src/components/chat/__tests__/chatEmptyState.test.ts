import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProviderMetadata } from '@/lib/metadata/types';
import { ChatEmptyState, type ChatSetupState } from '../ChatEmptyState';

vi.mock('../ModelSelector', () => ({
  ModelSelector: ({ setupLabel }: { setupLabel: string }) =>
    createElement('button', {}, setupLabel),
}));

beforeAll(() => vi.stubGlobal('React', React));

const provider: ProviderMetadata = {
  name: 'local',
  api_base_url: 'http://localhost',
  requiresApiKey: false,
  models: [{ name: 'local-model', aliases: [] }],
};

function render(
  setupState: ChatSetupState,
  allMetadata: ProviderMetadata[] = [],
) {
  return renderToStaticMarkup(
    createElement(ChatEmptyState, {
      setupState,
      modelPicker: {
        allMetadata,
        currentModelId: null,
        onModelChange: vi.fn(),
      },
    }),
  );
}

describe('new conversation setup', () => {
  it('shows a loading status without suggesting a setup action before initialization', () => {
    const html = render('initializing');
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/<button|<a /u);
  });

  it('links directly to adding a provider when none exist', () => {
    expect(render('no_provider')).toContain(
      'href="/settings?tab=localModels&amp;action=addProvider"',
    );
  });

  it('surfaces the real model-picker entry when a model is available', () => {
    const html = render('no_model', [provider]);
    expect(html).toContain('<button>');
    expect(html).not.toContain('href=');
  });

  it('sends users to model settings rather than an empty picker when no models are selectable', () => {
    const html = render('no_model', [{ ...provider, requiresApiKey: true }]);
    expect(html).toContain('href="/settings?tab=localModels"');
    expect(html).not.toContain('<button');
  });

  it('leaves the actual composer as the only ready-state entry', () => {
    const html = render('ready', [provider]);
    expect(html).toContain('<h2');
    expect(html).not.toMatch(/<button|<a /u);
  });
});
