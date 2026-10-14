import { describe, expect, it } from 'vitest';
import { createProviderInstance } from '../strategy-factory';

const LAN = 'http://192.168.1.5:8000/v1';
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
  it('honours the stored choice over the catalogue default', () => {
    // A routable address, so the local-endpoint rule cannot be what makes this pass.
    const inst = createProviderInstance(
      def(),
      'https://gateway.example.com/v1',
      null,
      {
        requiresKey: false,
      },
    );
    expect((inst as any).requiresKey).toBe(false);
  });

  it('treats a private-network address as needing no key when nobody chose', () => {
    expect((createProviderInstance(def(), LAN, null) as any).requiresKey).toBe(
      false,
    );
    expect(
      (
        createProviderInstance(
          def({ defaultUrl: 'https://api.host.example/v1' }),
          'https://api.host.example/v1',
          null,
        ) as any
      ).requiresKey,
    ).toBe(true);
  });

  it('gives the aggregate provider the same answer it hands to its delegates', () => {
    const multi = createProviderInstance(
      def({ strategy: 'multi' }),
      LAN,
      null,
      {
        requiresKey: false,
      },
    ) as any;
    expect(multi.requiresKey).toBe(false);
  });
});
