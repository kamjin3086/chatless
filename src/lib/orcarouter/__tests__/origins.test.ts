/**
 * Origin policy tests.
 *
 * Proves that authentication and inference never share a derived origin, and that a
 * non-loopback origin cannot be downgraded to plain HTTP.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ORCA_DEFAULT_API_BASE,
  ORCA_DEFAULT_AUTH_BASE,
  OrcaOriginError,
  buildAuthorizeUrl,
  buildExchangeUrl,
  resolveOrcaOrigins,
} from '../origins';

describe('OrcaRouter origins', () => {
  it('defaults auth to www and inference to the api /v1 relay', () => {
    const o = resolveOrcaOrigins({});
    assert.equal(o.authBase, ORCA_DEFAULT_AUTH_BASE);
    assert.equal(o.apiBase, ORCA_DEFAULT_API_BASE);
    assert.equal(o.authBase, 'https://www.orcarouter.ai');
    assert.equal(o.apiBase, 'https://api.orcarouter.ai/v1');
  });

  it('never derives the auth origin from the inference origin', () => {
    const o = resolveOrcaOrigins({});
    assert.notEqual(new URL(o.authBase).hostname, new URL(o.apiBase).hostname);
    // The relay is at /v1; the auth endpoints are not.
    assert.ok(!buildExchangeUrl(o).includes('api.orcarouter.ai'));
    assert.ok(
      !buildAuthorizeUrl(o, {
        callbackUrl: 'oob',
        codeChallenge: 'c',
        state: 's',
        appName: 'a',
      }).includes('api.orcarouter.ai'),
    );
  });

  it('exchanges at /api/v1/auth/keys and never at /v1/auth/keys', () => {
    const url = buildExchangeUrl(resolveOrcaOrigins({}));
    assert.equal(url, 'https://www.orcarouter.ai/api/v1/auth/keys');
    assert.ok(!/api\.orcarouter\.ai\/v1\/auth\/keys/.test(url));
  });

  it('authorizes at the fixed /auth path', () => {
    const url = buildAuthorizeUrl(resolveOrcaOrigins({}), {
      callbackUrl: 'oob',
      codeChallenge: 'CHALLENGE',
      state: 'STATE',
      appName: 'Chatless',
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.orcarouter.ai');
    assert.equal(parsed.pathname, '/auth');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('callback_url'), 'oob');
    assert.equal(parsed.searchParams.get('scope'), 'api');
  });

  it('lets a shared self-hosted base override both origins', () => {
    const o = resolveOrcaOrigins({
      ORCA_BASE_URL: 'https://orca.internal.example',
    });
    assert.equal(o.authBase, 'https://orca.internal.example');
    assert.equal(o.apiBase, 'https://orca.internal.example');
  });

  it('lets explicit per-origin overrides win over the shared base', () => {
    const o = resolveOrcaOrigins({
      ORCA_BASE_URL: 'https://orca.internal.example',
      ORCA_AUTH_BASE_URL: 'https://login.internal.example',
      ORCA_API_BASE_URL: 'https://relay.internal.example/v1',
    });
    assert.equal(o.authBase, 'https://login.internal.example');
    assert.equal(o.apiBase, 'https://relay.internal.example/v1');
  });

  it('rejects plain HTTP on a remote origin', () => {
    assert.throws(
      () => resolveOrcaOrigins({ ORCA_AUTH_BASE_URL: 'http://orcarouter.ai' }),
      OrcaOriginError,
    );
  });

  it('permits plain HTTP for loopback development', () => {
    const o = resolveOrcaOrigins({
      ORCA_AUTH_BASE_URL: 'http://127.0.0.1:8080',
    });
    assert.equal(o.authBase, 'http://127.0.0.1:8080');
  });

  it('rejects an unparseable origin', () => {
    assert.throws(
      () => resolveOrcaOrigins({ ORCA_API_BASE_URL: 'not-a-url' }),
      OrcaOriginError,
    );
  });
});
