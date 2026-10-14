import { describe, expect, it } from 'vitest';
import { createProviderInstance } from '../strategy-factory';

const LAN = 'http://192.168.1.5:8000/v1';
const HOSTED = 'https://api.host.example/v1';
const def = (over: Record<string, unknown> = {}) =>
  ({
    id: 'lan-gateway',
    name: 'LAN Gateway',
    strategy: 'openai-compatible',
    requiresKey: true,
    defaultUrl: LAN,
    ...over,
  }) as any;

describe('the key requirement travels with the provider', () => {
  it('reads a private-network address as needing no key', () => {
    expect((createProviderInstance(def(), LAN, null) as any).requiresKey).toBe(
      false,
    );
  });

  it('requires a key of a hosted catalogue entry left at its address', () => {
    // What #118 must not do: switch off the requirement for Azure, OpenRouter and the
    // rest, which the user enabled from that same catalogue.
    const inst = createProviderInstance(
      def({ defaultUrl: HOSTED }),
      HOSTED,
      null,
    ) as any;
    expect(inst.requiresKey).toBe(true);
  });

  it('treats a provider the catalogue does not know as the user own', () => {
    // The stored flag on a synthesised definition must not be mistaken for the
    // catalogue's answer, or an endpoint added before the rule existed stays blocked.
    const inst = createProviderInstance(
      def({ defaultUrl: HOSTED }),
      HOSTED,
      null,
      { knownToCatalogue: false },
    ) as any;
    expect(inst.requiresKey).toBe(false);
  });

  it('gives the aggregate provider the same answer it hands to its delegates', async () => {
    // The aggregate gates on the flag before touching the network, so this shows the flag
    // really arrived rather than merely naming the field.
    const hosted = createProviderInstance(
      def({ strategy: 'multi', defaultUrl: HOSTED }),
      HOSTED,
      null,
    ) as any;
    expect(await hosted.checkConnection()).toMatchObject({ reason: 'NO_KEY' });

    const keyless = createProviderInstance(
      def({ strategy: 'multi', defaultUrl: LAN }),
      LAN,
      null,
    ) as any;
    expect(keyless.requiresKey).toBe(false);
  });
});
