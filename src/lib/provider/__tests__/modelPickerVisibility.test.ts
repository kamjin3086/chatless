import { describe, expect, it } from 'vitest';
import { isProviderSelectable, selectSelectableProviders } from '../modelPickerVisibility';

const base = { name: 'Provider' };

describe('model picker provider visibility', () => {
  it('offers a user-added provider that needs a key but has none', () => {
    // A local OpenAI-compatible endpoint is created with requiresKey=true and
    // no key; it must still be reachable from the picker.
    expect(isProviderSelectable({
      ...base, name: 'homelab', isUserAdded: true, requiresApiKey: true, default_api_key: null, models: [],
    })).toBe(true);
  });

  it('offers providers that need no key', () => {
    expect(isProviderSelectable({ ...base, requiresApiKey: false })).toBe(true);
  });

  it('offers providers with a provider-level or model-level key', () => {
    expect(isProviderSelectable({ ...base, requiresApiKey: true, default_api_key: 'sk-live' })).toBe(true);
    expect(isProviderSelectable({
      ...base, requiresApiKey: true, default_api_key: '   ',
      models: [{ api_key: 'model-key' }],
    })).toBe(true);
  });

  it('keeps unconfigured key-requiring built-ins out of the picker', () => {
    expect(isProviderSelectable({
      ...base, requiresApiKey: true, default_api_key: null, models: [{ api_key: null }],
    })).toBe(false);
  });

  it('respects an explicit hide flag even for user-added providers', () => {
    expect(isProviderSelectable({ ...base, isUserAdded: true, requiresApiKey: false, isVisible: false })).toBe(false);
  });

  it('filters a mixed provider list without reordering it', () => {
    const providers = [
      { name: 'Hidden', isVisible: false, requiresApiKey: false },
      { name: 'LM Studio', requiresApiKey: false },
      { name: 'DeepSeek', requiresApiKey: true, default_api_key: null, models: [] },
      { name: 'homelab', isUserAdded: true, requiresApiKey: true, models: [] },
      { name: 'OpenAI', requiresApiKey: true, default_api_key: 'sk-set' },
    ];
    expect(selectSelectableProviders(providers).map((p) => p.name))
      .toEqual(['LM Studio', 'homelab', 'OpenAI']);
  });

  it('tolerates missing input', () => {
    expect(selectSelectableProviders(undefined)).toEqual([]);
    expect(isProviderSelectable(null)).toBe(false);
  });
});
