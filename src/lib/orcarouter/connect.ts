/**
 * PKCE connect controller.
 *
 * Orchestrates authorize → callback (Flow A) or pasted code (Flow B) → exchange → persist.
 * Every attempt carries a monotonically increasing id; async completions that no longer
 * belong to the current attempt are discarded so a late response can never overwrite a
 * newer login. Cancellation is complete: success, denial, exchange error, timeout, explicit
 * cancel, switching auth method, unmount, and `pagehide` all release the attempt.
 */

import {
  buildAuthorizeUrl,
  buildExchangeUrl,
  resolveOrcaOrigins,
  type OrcaOrigins,
} from './origins';
import {
  OrcaAuthError,
  computeChallenge,
  exchangeCodeForKey,
  generateState,
  generateVerifier,
  stateMatches,
} from './pkce';

export type OrcaFlow = 'loopback' | 'oob';

/** A bound loopback listener. Production supplies one only where the host can bind a socket. */
export interface LoopbackListener {
  readonly port: number;
  readonly callbackUrl: string;
  /** Resolve with the query string params delivered to the callback. */
  waitForCallback(
    timeoutMs: number,
  ): Promise<{ code?: string; error?: string; state?: string }>;
  close(): Promise<void>;
}

export type LoopbackFactory = (path: string) => Promise<LoopbackListener>;

export interface ConnectSession {
  attempt: number;
  flow: OrcaFlow;
  authorizeUrl: string;
  state: string;
  /** Kept in-process only. Never serialized, logged, or put on a URL. */
  verifier: string;
}

export interface ConnectOptions {
  appName?: string;
  scope?: string;
  loginHint?: string;
  workspaceHint?: string;
  /** Injected for tests: a fake local auth server. */
  loopbackFactory?: LoopbackFactory;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  openUrl?: (url: string) => Promise<void> | void;
  origins?: OrcaOrigins;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class OrcaConnectController {
  private attemptCounter = 0;
  private current: ConnectSession | null = null;
  private listener: LoopbackListener | null = null;
  private active = false;

  constructor(private readonly options: ConnectOptions = {}) {}

  private origins(): OrcaOrigins {
    return this.options.origins ?? resolveOrcaOrigins();
  }

  /** True while an authorization attempt is live. */
  isBusy(): boolean {
    return this.active;
  }

  currentAttempt(): number {
    return this.attemptCounter;
  }

  isCurrent(attempt: number): boolean {
    return this.active && this.attemptCounter === attempt;
  }

  /**
   * Begin an authorization attempt. Returns the URL the user must approve.
   * A fresh S256 verifier and state are generated for every call.
   */
  async start(flow: OrcaFlow = 'oob'): Promise<ConnectSession> {
    await this.cancel();

    this.attemptCounter += 1;
    const attempt = this.attemptCounter;
    const origins = this.origins();

    const verifier = generateVerifier();
    const state = generateState();
    const challenge = await computeChallenge(verifier);

    let callbackUrl = 'oob';
    if (flow === 'loopback') {
      if (!this.options.loopbackFactory) {
        throw new OrcaAuthError(
          'unknown',
          'Loopback redirect is not available in this environment.',
        );
      }
      this.listener = await this.options.loopbackFactory('/cb');
      callbackUrl = this.listener.callbackUrl;
    } else {
      this.listener = null;
    }

    const authorizeUrl = buildAuthorizeUrl(origins, {
      callbackUrl,
      codeChallenge: challenge,
      state,
      appName: this.options.appName || 'Chatless',
      scope: this.options.scope || 'api',
      loginHint: this.options.loginHint,
      workspaceHint: this.options.workspaceHint,
    });

    this.current = { attempt, flow, authorizeUrl, state, verifier };
    this.active = true;

    if (this.options.openUrl) await this.options.openUrl(authorizeUrl);
    return this.current;
  }

  /**
   * Flow A: wait for the browser to deliver the code, comparing `state` in constant time
   * before the code is touched.
   */
  async awaitCallback(attempt: number): Promise<string> {
    const session = this.requireCurrent(attempt);
    if (session.flow !== 'loopback' || !this.listener) {
      throw new OrcaAuthError(
        'unknown',
        'This attempt is not using a loopback callback.',
      );
    }
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let delivered: { code?: string; error?: string; state?: string };
    try {
      delivered = await this.listener.waitForCallback(timeoutMs);
    } catch {
      throw new OrcaAuthError(
        'timeout',
        'Timed out waiting for the browser to return the authorization code.',
      );
    }

    // Compare state before doing anything else with the payload.
    if (!stateMatches(session.state, delivered.state ?? null)) {
      throw new OrcaAuthError(
        'state_mismatch',
        'The authorization response did not match this request. Ignored.',
      );
    }
    if (delivered.error) {
      throw new OrcaAuthError(
        'denied',
        'Authorization was denied. No key was issued.',
      );
    }
    if (!delivered.code) {
      throw new OrcaAuthError(
        'unknown',
        'The authorization response did not include a code.',
      );
    }
    return delivered.code;
  }

  /**
   * Exchange a code (from Flow A or pasted by the user in Flow B) for a durable key and
   * return it to the caller for persistence. The verifier never leaves this process.
   */
  async complete(attempt: number, code: string) {
    const session = this.requireCurrent(attempt);
    const trimmed = String(code || '').trim();
    if (!trimmed)
      throw new OrcaAuthError(
        'unknown',
        'Enter the authorization code shown by OrcaRouter.',
      );

    const result = await exchangeCodeForKey({
      code: trimmed,
      verifier: session.verifier,
      exchangeUrl: buildExchangeUrl(this.origins()),
      fetchImpl: this.options.fetchImpl,
    });

    if (!this.isCurrent(attempt)) {
      // A newer attempt started while we were exchanging; drop this result.
      throw new OrcaAuthError(
        'cancelled',
        'This authorization was superseded by a newer attempt.',
      );
    }
    await this.releaseListener();
    this.active = false;
    this.current = null;
    return result;
  }

  /** Release a single attempt without disturbing a newer one. */
  async cancel(attempt?: number): Promise<void> {
    if (attempt !== undefined && attempt !== this.attemptCounter) return;
    this.active = false;
    this.current = null;
    await this.releaseListener();
  }

  /**
   * Synchronous cleanup for `pagehide`. The page may be restored from the back-forward
   * cache, so busy/hint state must be cleared here rather than left to a guarded `finally`
   * that will correctly refuse to mutate state.
   */
  cancelSync(): void {
    this.active = false;
    this.current = null;
    const listener = this.listener;
    this.listener = null;
    if (listener) void listener.close().catch(() => {});
  }

  private requireCurrent(attempt: number): ConnectSession {
    if (!this.isCurrent(attempt) || !this.current) {
      throw new OrcaAuthError(
        'cancelled',
        'This authorization attempt is no longer active.',
      );
    }
    return this.current;
  }

  private async releaseListener(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      try {
        await listener.close();
      } catch {
        // Closing an already-closed listener is not an error worth surfacing.
      }
    }
  }
}

/** Where the user manages and revokes keys issued to this app. */
export const ORCA_AUTHORIZED_APPS_URL =
  'https://www.orcarouter.ai/console/authorized-apps';
