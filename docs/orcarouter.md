# OrcaRouter provider

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible AI gateway built for both
models and agents, with adaptive routing, automatic failover, zero-markup inference,
observability, guardrails, and agent-tool governance. It also runs gateway-level,
zero-trust security for AI agents on the same endpoint — screening every prompt/response
and governing every tool call on a default-deny basis, with no application code changes.

chatless registers OrcaRouter as a first-class provider with **two explicit authentication
choices**, both of which end up holding the same durable OrcaRouter API key.
No client secret is involved in either one.

## Two ways to connect

| Choice | Provider entry | Credential source |
| --- | --- | --- |
| Existing key | `OrcaRouter - API` | The user pastes an `sk-orca-…` key. |
| Account login | `OrcaRouter - Auth` | OAuth 2.0 + PKCE issues an `sk-orca-…` key. |

Both entries share one inference adapter, one base URL, one model namespace, and one
catalog discovery path. Only credential acquisition differs, and the settings panel shows
both choices side by side in a single OrcaRouter card.

The key belongs to the user, not to this project: it is billed to their OrcaRouter
account, listed in their console, and revocable by them at any time.

## Origins

Authentication and inference use **different public origins**:

| Purpose | Default |
| --- | --- |
| Consent screen | `https://www.orcarouter.ai/auth` |
| Code exchange | `https://www.orcarouter.ai/api/v1/auth/keys` |
| Inference and model catalog | `https://api.orcarouter.ai/v1` |

`https://api.orcarouter.ai/v1/auth/keys` is a 404 — the relay is at `/v1`, the auth
endpoints are not.

Both origins are configurable, with explicit overrides taking precedence:

- `ORCA_BASE_URL` — shared self-hosted base for both origins;
- `ORCA_AUTH_BASE_URL`, `ORCA_API_BASE_URL` — separate per-origin overrides.

Remote origins must be HTTPS. Plain HTTP is accepted only for loopback addresses.

## Flow B — out-of-band code

chatless ships as a Tauri 2 desktop app whose front end is a Next.js **static export**
rendered inside the app webview. A webview is a sandboxed page: it cannot bind a TCP
socket, and the project ships no loopback-listener plugin. The code therefore follows the
specification's rule for software whose install address differs on every deployment and
uses the **out-of-band code** flow:

1. the app builds the authorize URL with a fresh S256 challenge and a fresh `state`, and
   opens it with the system browser;
2. the consent screen displays a one-time code, which the user pastes back;
3. the app exchanges the code plus the original verifier for a durable key.

`code_challenge_method=S256` is sent unconditionally. A displayed code is placed in human
hands — read off a screen, pasted into the wrong window — so it must be redeemable only by
the process that generated the verifier.

The loopback redirect flow is implemented behind an injectable listener factory and is
exercised end-to-end by the automated tests against a local fake auth server. Production
selects the out-of-band flow because no listener factory is supplied. The device grant is
not implemented.

### PKCE properties

- The verifier is 32 bytes from a cryptographic RNG, fresh for every attempt.
- The challenge is unpadded `base64url(sha256(verifier))`.
- The verifier never leaves the process: it is not in a URL, a log, an error message, a
  snapshot, or telemetry.
- `state` is compared in constant time **before** the authorization code is touched.
- Denial, state mismatch, timeout, expired/used code, `403`, `429`, and network errors all
  end cleanly with an actionable message instead of hanging or hot-looping.

### Cancellation

Every attempt carries a monotonically increasing id. Success, denial, exchange error,
timeout, explicit cancel, switching authentication method, closing the panel, unmount,
reload, and `pagehide` all release the attempt. `pagehide` clears the busy flag and the
authorization hint **synchronously**, because a page restored from the back-forward cache
would otherwise stay permanently busy: the generation guard on the invalidated request
correctly refuses to mutate state.

## Credential lifecycle

The flow returns a long-lived API key, **not** an access/refresh token pair. There is no
refresh endpoint to call.

- The stored key is reused until OrcaRouter revokes it.
- No proactive refresh is scheduled and no refresh grant is invented.
- A `401` from the relay is terminal: the exact account and credential generation that
  made the rejected request is marked `needsReauth` and stays unusable until a new login
  succeeds.
- A late failure from an older generation never marks a newly reauthorized credential as
  broken.
- The old secret is not deleted before a replacement succeeds.
- Keys are stored only in the project's existing secret mechanism (`llm-config.json` via
  the Tauri Store), never in a new key store, never in a URL, log, or screenshot.
- Revoking access: <https://www.orcarouter.ai/console/authorized-apps>.

There is a cap of **10 PKCE-issued keys per user per 24 hours**, which is why the app
persists and reuses the key rather than re-authorizing on every launch.

## Model catalog and capability filtering

The single source of truth is `GET /v1/models` on the configured inference origin,
requested with the user's own key so the list reflects what that workspace can actually
call. Model ids keep their `vendor/model` namespace verbatim.

Admission to a dropdown is decided by catalog metadata only — never by a model's name:

| Entry point | Filter |
| --- | --- |
| Text chat / agent | `?capability=chat`; must advertise `openai`, `anthropic`, `gemini`, or `openai-response`; image-generation / video / rerank-only models are excluded. |
| Multimodal understanding | chat first, then `architecture.input_modalities` must explicitly include the attached modality (image / audio / video / file). Undeclared means **excluded**. |
| Embedding | `?capability=embedding`. |
| Image generation | `?capability=image`. |
| Video generation | `openai-video`. |
| Rerank | `jina-rerank`. |

Changing the provider, the attachment type, or the task recomputes the option list. A
stored model that is no longer compatible is cleared with a prompt to re-select, instead
of being silently kept. The dropdown never degrades into free-text entry.

The browser never receives the API key: discovery runs in the provider layer, which holds
the credential.

### Fallback

Live discovery is authoritative. On failure a small **verified** seed is served and the UI
shows a degraded state. The seed preserves the context windows, input modalities, and the
`low`/`medium`/`high`/`xhigh` reasoning ladder read from the live catalog, so an outage
does not silently strip capability metadata. Seed entries are never mixed into a
successful live result.

## Provider evidence

| Item | Source |
| --- | --- |
| Inference endpoint (OpenAI-compatible) | `https://api.orcarouter.ai/v1` |
| Model list | `GET https://api.orcarouter.ai/v1/models` (Bearer-authenticated) |
| Authorization / exchange | `https://www.orcarouter.ai/auth`, `POST https://www.orcarouter.ai/api/v1/auth/keys` |
| Revocation / account management | `https://www.orcarouter.ai/console/authorized-apps` |
| Discovery document | `https://www.orcarouter.ai/.well-known/openid-configuration` |
| Service | <https://www.orcarouter.ai> |
| Discord | <https://discord.gg/YEubt8enRA> |
| X | <https://x.com/OrcaRouter> |

Documented OpenAI-compatible inference, a Bearer-authenticated model-list endpoint, an
authorization/exchange pair with PKCE and no client secret, and one-click key revocation.
Verification date: 2026-09-11.

**Affiliation disclosure:** this integration is contributed by an engineer on the
OrcaRouter team.
