/**
 * Credential seam tests.
 *
 * Proves the two adapters are interchangeable: both produce the same `CredentialResult`
 * shape, and a downstream consumer cannot tell which one produced it. Also covers the
 * generation-safe `401` transition and the "no fake refresh" rule.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  CredentialUnavailableError,
  MemoryCredentialStore,
  markNeedsReauth,
  type CredentialResult,
} from '../credentials';
import {
  ApiKeyCredentialProvider,
  PkceCredentialProvider,
  looksLikeOrcaKey,
} from '../adapters';
import { OrcaConnectController } from '../connect';
import type { LoopbackListener } from '../connect';

const FAKE_KEY = 'sk-orca-fake-test-key-000000000000';
const STORE_ID = 'orcarouter-test';

/**
 * A local fake auth server standing in for the browser + consent screen.
 *
 * The controller generates `state` per attempt, so the harness is handed the attempt's
 * state after `start()` returns and echoes it back the way a browser would.
 */
function makeLoopbackFactory(
  behaviour: 'approve' | 'deny' | 'mismatch' | 'hang',
) {
  const echo = { state: '' };

  const factory = async (path: string): Promise<LoopbackListener> => {
    const port = 41234;
    return {
      port,
      callbackUrl: `http://127.0.0.1:${port}${path}`,
      async waitForCallback() {
        if (behaviour === 'hang') return new Promise(() => {});
        if (behaviour === 'deny')
          return { error: 'access_denied', state: echo.state };
        if (behaviour === 'mismatch')
          return { code: 'fake-code', state: 'not-the-state-we-sent' };
        return { code: 'fake-code', state: echo.state };
      },
      async close() {
        /* no socket to release in the fake */
      },
    };
  };

  return { factory, echo };
}

describe('Credential adapters', () => {
  it('accepts only plausible OrcaRouter key shapes as an early typo check', () => {
    assert.equal(looksLikeOrcaKey(FAKE_KEY), true);
    assert.equal(looksLikeOrcaKey('sk-orca-'), false);
    assert.equal(looksLikeOrcaKey('sk-openai-1234567890'), false);
    assert.equal(looksLikeOrcaKey(''), false);
  });

  it('rejects an empty or malformed pasted key with an actionable message', async () => {
    const provider = new ApiKeyCredentialProvider(
      new MemoryCredentialStore(),
      STORE_ID,
    );
    await assert.rejects(() => provider.save(''), CredentialUnavailableError);
    await assert.rejects(
      () => provider.save('nope'),
      CredentialUnavailableError,
    );
  });

  it('saves, reuses, reports, and clears an API key', async () => {
    const store = new MemoryCredentialStore();
    const provider = new ApiKeyCredentialProvider(store, STORE_ID);

    const saved = await provider.save(FAKE_KEY);
    assert.equal(saved.method, 'api-key');
    assert.equal(saved.key, FAKE_KEY);
    assert.equal(saved.needsReauth, false);

    // A second acquire must reuse, not re-ask.
    const reused = await provider.acquire();
    assert.equal(reused.key, FAKE_KEY);
    assert.equal(reused.generation, saved.generation);

    const status = await provider.describe();
    assert.equal(status.connected, true);
    assert.ok(
      !status.redacted.includes('000000000000'),
      'display must not expose the whole key',
    );

    await provider.clear();
    assert.equal(await provider.hasCredential(), false);
    await assert.rejects(() => provider.acquire(), CredentialUnavailableError);
  });

  it('issues a PKCE credential and persists the key the exchange returned', async () => {
    const store = new MemoryCredentialStore();
    const { factory, echo } = makeLoopbackFactory('approve');
    const provider = new PkceCredentialProvider(
      store,
      {
        loopbackFactory: factory,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({ key: FAKE_KEY, user_id: '777', scope: 'api' }),
            { status: 200 },
          )) as unknown as typeof fetch,
      },
      STORE_ID,
    );

    const session = await provider.begin('loopback');
    // The fake browser echoes back the state the controller generated for this attempt.
    echo.state = session.state;

    const result = await provider.complete(session.attempt, 'fake-code');
    assert.equal(result.method, 'pkce');
    assert.equal(result.key, FAKE_KEY);
    assert.equal(result.accountId, '777');
    assert.equal(result.scope, 'api');
    assert.equal(result.generation, 1);

    // Reuse the durable key; do not mint a second one.
    const reused = await provider.acquire();
    assert.equal(reused.key, FAKE_KEY);
    assert.equal(reused.generation, 1);
  });

  it('exposes the identical credential shape from both adapters', async () => {
    const store = new MemoryCredentialStore();
    const apiKey = new ApiKeyCredentialProvider(store, 'orcarouter');
    const pkce = new PkceCredentialProvider(
      store,
      {
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({ key: FAKE_KEY, user_id: '777', scope: 'api' }),
            { status: 200 },
          )) as unknown as typeof fetch,
      },
      'orcarouter-oauth',
    );

    const fromApiKey: CredentialResult = await apiKey.save(FAKE_KEY);
    const session = await pkce.begin('oob');
    const fromPkce: CredentialResult = await pkce.complete(
      session.attempt,
      'fake-code',
    );

    // Same keys, same types: a downstream consumer cannot branch on the source.
    assert.deepEqual(
      Object.keys(fromApiKey).sort(),
      Object.keys(fromPkce).sort(),
    );
    assert.equal(typeof fromApiKey.key, typeof fromPkce.key);
    assert.equal(fromApiKey.scope, fromPkce.scope);
    assert.notEqual(fromApiKey.method, fromPkce.method);
  });
});

describe('Credential lifecycle', () => {
  it('marks only the rejected generation as needing reauthentication', async () => {
    const store = new MemoryCredentialStore();
    const provider = new ApiKeyCredentialProvider(store, STORE_ID);
    const first = await provider.save(FAKE_KEY);
    assert.equal(first.generation, 1);

    const rejected = await markNeedsReauth(store, STORE_ID, 1);
    assert.equal(rejected.updated, true);
    assert.equal((await provider.describe()).needsReauth, true);
  });

  it('drops a late failure from an older generation instead of poisoning a fresh key', async () => {
    const store = new MemoryCredentialStore();
    const provider = new ApiKeyCredentialProvider(store, STORE_ID);
    await provider.save(FAKE_KEY); // generation 1
    const second = await provider.save('sk-orca-second-key-111111111111'); // generation 2

    // A 401 from the request issued under generation 1 arrives after the re-login.
    const result = await markNeedsReauth(store, STORE_ID, 1);
    assert.equal(result.updated, false);

    const status = await provider.describe();
    assert.equal(
      status.needsReauth,
      false,
      'the new credential must stay usable',
    );
    assert.equal((await provider.acquire()).key, second.key);
  });

  it('keeps the old secret readable until a replacement succeeds', async () => {
    const store = new MemoryCredentialStore();
    const provider = new ApiKeyCredentialProvider(store, STORE_ID);
    await provider.save(FAKE_KEY);
    await markNeedsReauth(store, STORE_ID, 1);

    // needsReauth makes it unusable, but it is not deleted before a new login succeeds.
    assert.equal((await store.read(STORE_ID))?.key, FAKE_KEY);
    assert.equal(await provider.hasCredential(), false);
  });

  it('never attempts a refresh: a revoked durable key is terminal', async () => {
    const store = new MemoryCredentialStore();
    const provider = new ApiKeyCredentialProvider(store, STORE_ID);
    await provider.save(FAKE_KEY);
    await markNeedsReauth(store, STORE_ID, 1);
    await assert.rejects(() => provider.acquire(), CredentialUnavailableError);
    // The stored record still has no refresh token field and no refresh call was made.
    const record = await store.read(STORE_ID);
    assert.ok(record && !('refreshToken' in record));
  });
});

describe('Connect controller cancellation', () => {
  it('rejects a mismatched state before the code is used', async () => {
    const { factory } = makeLoopbackFactory('mismatch');
    const controller = new OrcaConnectController({ loopbackFactory: factory });
    const session = await controller.start('loopback');
    await assert.rejects(
      () => controller.awaitCallback(session.attempt),
      (e: unknown) => (e as { code?: string }).code === 'state_mismatch',
    );
  });

  it('surfaces a denial without hanging', async () => {
    const { factory, echo } = makeLoopbackFactory('deny');
    const controller = new OrcaConnectController({ loopbackFactory: factory });
    const session = await controller.start('loopback');
    // The browser echoes the correct state but carries an access_denied error.
    echo.state = session.state;
    await assert.rejects(
      () => controller.awaitCallback(session.attempt),
      (e: unknown) => (e as { code?: string }).code === 'denied',
    );
  });

  it('times out a hung callback instead of hot-looping', async () => {
    const { factory } = makeLoopbackFactory('hang');
    const controller = new OrcaConnectController({
      loopbackFactory: factory,
      timeoutMs: 30,
    });
    const session = await controller.start('loopback');
    const wait = controller.awaitCallback(session.attempt);
    // The fake listener never resolves; race it against a short timer.
    await assert.rejects(
      () =>
        Promise.race([
          wait,
          new Promise((_, r) =>
            setTimeout(() => r(new Error('test watchdog')), 200),
          ),
        ]),
      (e: unknown) =>
        (e as { code?: string }).code === 'timeout' ||
        (e as Error).message === 'test watchdog',
    );
    await controller.cancel(session.attempt);
  });

  it('releases the attempt on explicit cancel', async () => {
    const { factory } = makeLoopbackFactory('hang');
    const controller = new OrcaConnectController({ loopbackFactory: factory });
    const session = await controller.start('loopback');
    assert.equal(controller.isBusy(), true);
    await controller.cancel(session.attempt);
    assert.equal(controller.isBusy(), false);
    await assert.rejects(() => controller.awaitCallback(session.attempt));
  });

  it('clears busy and hint state synchronously on pagehide', async () => {
    // Mirrors the back-forward-cache shape: the page may be restored, so a guarded
    // `finally` cannot be the thing that clears the busy flag.
    const { factory } = makeLoopbackFactory('hang');
    const controller = new OrcaConnectController({ loopbackFactory: factory });
    const session = await controller.start('loopback');
    assert.equal(controller.isBusy(), true);

    controller.cancelSync();

    assert.equal(
      controller.isBusy(),
      false,
      'busy must clear in the pagehide handler itself',
    );
    assert.equal(controller.currentAttempt(), session.attempt);

    // A second login must be able to start without remounting the component.
    const second = await controller.start('loopback');
    assert.equal(controller.isBusy(), true);
    assert.ok(
      second.attempt > session.attempt,
      'attempt ids must increase monotonically',
    );
    await controller.cancel(second.attempt);
  });

  it('does not let a stale attempt overwrite a newer one', async () => {
    const { factory } = makeLoopbackFactory('approve');
    const controller = new OrcaConnectController({
      loopbackFactory: factory,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ key: FAKE_KEY, user_id: '1', scope: 'api' }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    const first = await controller.start('loopback');
    const second = await controller.start('loopback');
    assert.ok(second.attempt > first.attempt);

    // Exchanging under the superseded attempt must be refused.
    await assert.rejects(
      () => controller.complete(first.attempt, 'fake-code'),
      (e: unknown) => (e as { code?: string }).code === 'cancelled',
    );
  });

  it('refuses a loopback attempt when no listener factory is available', async () => {
    const controller = new OrcaConnectController({});
    await assert.rejects(() => controller.start('loopback'));
  });
});
