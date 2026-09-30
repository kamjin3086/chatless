/**
 * Which providers the chat model picker offers.
 *
 * The picker used to hide every provider that "requires a key" but has no key
 * recorded, which also hid providers the user had just added by hand: a local
 * OpenAI-compatible endpoint usually needs no key at all, so it never appeared
 * in the picker even though it was configured and its models had been fetched.
 * Whether a provider needs a key is a static guess (`strategy !== 'ollama'`),
 * so it cannot be the only signal that makes a configured provider reachable.
 */

export interface ModelPickerProvider {
  /** Provider key as stored in the repository (stable identifier). */
  name: string;
  /** Explicit user decision to hide the provider from the UI. */
  isVisible?: boolean;
  /** True when the user created the provider themselves. */
  isUserAdded?: boolean;
  /** Static guess: does this provider need an API key? */
  requiresApiKey?: boolean;
  /** Provider-level key copy kept in the repository for display. */
  default_api_key?: string | null;
  /** Per-model key copies (model-level overrides). */
  models?: Array<{ api_key?: string | null }>;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * A provider is offered when the user has not hidden it and there is a reason
 * to believe it can answer: it needs no key, a key is configured, or the user
 * added it deliberately and can still fix its configuration from the picker.
 */
export function isProviderSelectable(provider: ModelPickerProvider | undefined | null): boolean {
  if (!provider) return false;
  if (provider.isVisible === false) return false;
  if (provider.isUserAdded) return true;
  if (provider.requiresApiKey === false) return true;
  if (hasText(provider.default_api_key)) return true;
  return Array.isArray(provider.models)
    && provider.models.some((model) => hasText(model?.api_key));
}

export function selectSelectableProviders<T extends ModelPickerProvider>(providers: T[] | undefined): T[] {
  return (providers || []).filter((provider) => isProviderSelectable(provider));
}
