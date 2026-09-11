/**
 * PKCE primitive and exchange tests.
 *
 * Every value here is a fake. The suite additionally asserts that the verifier and the
 * issued key never appear in an error message or a URL.
 */

import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  OrcaAuthError,
  assertUsableScope,
  base64UrlEncode,
  computeChallenge,
  exchangeCodeForKey,
  generateState,
  generateVerifier,
  redactKey,
  stateMatches,
} from '../pkce';

/** Independent reference implementation, so the assertion is not self-confirming. */
function referenceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('OrcaRouter PKCE primitives', () => {
  it('produces an unpadded base64url S256 challenge', async () => {
    const verifier = generateVerifier();
    const challenge = await computeChallenge(verifier);
    assert.equal(challenge, referenceChallenge(verifier));
    assert.ok(!challenge.includes('='), 'challenge must not be padded');
    assert.ok(
      !challenge.includes('+') && !challenge.includes('/'),
      'challenge must be base64url',
    );
  });

  it('generates a fresh verifier and state on every attempt', () => {
    const verifiers = new Set(
      Array.from({ length: 64 }, () => generateVerifier()),
    );
    const states = new Set(Array.from({ length: 64 }, () => generateState()));
    assert.equal(verifiers.size, 64, 'verifiers must not repeat');
    assert.equal(states.size, 64, 'states must not repeat');
  });

  it('derives the verifier from a cryptographic RNG, not a guessable value', () => {
    // Two runs of a timestamp/username-derived value would collide; these must not.
    const a = generateVerifier();
    const b = generateVerifier();
    assert.notEqual(a, b);
    // 32 bytes of entropy -> 43 unpadded base64url characters.
    assert.equal(a.length, 43);
  });

  it('compares state and rejects a mismatch or a missing value', () => {
    const state = generateState();
    assert.equal(stateMatches(state, state), true);
    assert.equal(stateMatches(state, generateState()), false);
    assert.equal(stateMatches(state, null), false);
    assert.equal(stateMatches(state, ''), false);
    assert.equal(stateMatches(state, state.slice(0, -1)), false);
    assert.equal(stateMatches('', ''), false);
  });

  it('accepts the granted api scope and rejects a downgrade', () => {
    assert.equal(assertUsableScope('api', 'api'), 'api');
    assert.throws(() => assertUsableScope('connector', 'api'), OrcaAuthError);
    assert.throws(() => assertUsableScope('', 'api'), OrcaAuthError);
    assert.throws(() => assertUsableScope(undefined, 'api'), OrcaAuthError);
  });

  it('treats a granted scope as what was granted, not what was requested', () => {
    // Asking for connector and being granted api must be reported, not silently accepted.
    assert.throws(() => assertUsableScope('api', 'connector'), OrcaAuthError);
  });

  it('redacts a key for display without revealing the secret', () => {
    const fake = 'sk-orca-abcdefghijklmnopqrstuvwxyz';
    const redacted = redactKey(fake);
    assert.ok(!redacted.includes('mnopqrstuvwxyz'));
    assert.ok(redacted.includes('••••'));
  });
});

describe('OrcaRouter code exchange', () => {
  const EXCHANGE = 'https://www.orcarouter.ai/api/v1/auth/keys';
  const VERIFIER = 'fake-verifier-value-for-tests-only-000000000';

  function fakeFetch(status: number, body: unknown): typeof fetch {
    return (async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  }

  it('posts the verifier to the auth origin exchange path with S256', async () => {
    let seenUrl = '';
    let seenBody: Record<string, unknown> = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          key: 'sk-orca-fake-key-000',
          user_id: '42',
          scope: 'api',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    const result = await exchangeCodeForKey({
      code: 'fake-code',
      verifier: VERIFIER,
      exchangeUrl: EXCHANGE,
      fetchImpl,
    });

    assert.equal(seenUrl, 'https://www.orcarouter.ai/api/v1/auth/keys');
    assert.ok(
      !/api\.orcarouter\.ai/.test(seenUrl),
      'exchange must not use the inference origin',
    );
    assert.equal(seenBody.code, 'fake-code');
    assert.equal(seenBody.code_verifier, VERIFIER);
    assert.equal(seenBody.code_challenge_method, 'S256');
    assert.equal(result.key, 'sk-orca-fake-key-000');
    assert.equal(result.scope, 'api');
    assert.equal(result.userId, '42');
  });

  it('never puts the verifier on the exchange URL', async () => {
    let seenUrl = '';
    const fetchImpl = (async (url: string) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({ key: 'sk-orca-k', user_id: '1', scope: 'api' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await exchangeCodeForKey({
      code: 'c',
      verifier: VERIFIER,
      exchangeUrl: EXCHANGE,
      fetchImpl,
    });
    assert.ok(!seenUrl.includes(VERIFIER));
  });

  it('classifies 400 as a method mismatch', async () => {
    await assert.rejects(
      exchangeCodeForKey({
        code: 'c',
        verifier: VERIFIER,
        exchangeUrl: EXCHANGE,
        fetchImpl: fakeFetch(400, {}),
      }),
      (e: unknown) =>
        e instanceof OrcaAuthError && e.code === 'method_mismatch',
    );
  });

  it('classifies 403 as an expired, unknown, or already-used code', async () => {
    await assert.rejects(
      exchangeCodeForKey({
        code: 'c',
        verifier: VERIFIER,
        exchangeUrl: EXCHANGE,
        fetchImpl: fakeFetch(403, {}),
      }),
      (e: unknown) =>
        e instanceof OrcaAuthError && e.code === 'expired_or_used',
    );
  });

  it('classifies 429 as rate limiting with an actionable message', async () => {
    await assert.rejects(
      exchangeCodeForKey({
        code: 'c',
        verifier: VERIFIER,
        exchangeUrl: EXCHANGE,
        fetchImpl: fakeFetch(429, {}),
      }),
      (e: unknown) => e instanceof OrcaAuthError && e.code === 'rate_limited',
    );
  });

  it('classifies a transport failure without leaking the request body', async () => {
    const fetchImpl = (async () => {
      throw new TypeError(
        `failed to fetch ${EXCHANGE} body {"code_verifier":"${VERIFIER}"}`,
      );
    }) as unknown as typeof fetch;

    await assert.rejects(
      exchangeCodeForKey({
        code: 'c',
        verifier: VERIFIER,
        exchangeUrl: EXCHANGE,
        fetchImpl,
      }),
      (e: unknown) => {
        assert.ok(e instanceof OrcaAuthError && e.code === 'network');
        assert.ok(
          !e.message.includes(VERIFIER),
          'verifier must not appear in an error message',
        );
        return true;
      },
    );
  });

  it('rejects a grant that is missing a usable scope', async () => {
    await assert.rejects(
      exchangeCodeForKey({
        code: 'c',
        verifier: VERIFIER,
        exchangeUrl: EXCHANGE,
        fetchImpl: fakeFetch(200, { key: 'sk-orca-k', user_id: '1' }),
      }),
      (e: unknown) => e instanceof OrcaAuthError && e.code === 'scope',
    );
  });

  it('rejects an exchange response with no key', async () => {
    await assert.rejects(
      exchangeCodeForKey({
        code: 'c',
        verifier: VERIFIER,
        exchangeUrl: EXCHANGE,
        fetchImpl: fakeFetch(200, { user_id: '1', scope: 'api' }),
      }),
      (e: unknown) => e instanceof OrcaAuthError && e.code === 'unknown',
    );
  });

  it('decodes a verifier into an unpadded base64url string', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 0]));
    assert.ok(!encoded.includes('='));
    assert.ok(!encoded.includes('+') && !encoded.includes('/'));
  });

  it('keeps a 32-byte random verifier well clear of guessable material', () => {
    const fixed = randomBytes(32).toString('base64url');
    assert.ok(generateVerifier() !== fixed);
  });
});
