import { tauriFetch } from '@/lib/request';
import { isTauriEnvironment } from '@/lib/utils/environment';

export interface WebDavAuth {
  username: string;
  password: string;
}

export interface WebDavClientConfig {
  url: string;
  basePath: string;
  auth: WebDavAuth;
  timeoutMs?: number;
}

export interface WebDavResponse {
  status: number;
  statusText: string;
  etag?: string;
  text?: string;
}

function normalizeBaseUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizePathSegments(input: string): string[] {
  return (input || '')
    .trim()
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinPath(...parts: string[]): string {
  const segs = parts.flatMap(normalizePathSegments);
  return segs.join('/');
}

function buildUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const relative = joinPath(path);
  const encoded = relative
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  return new URL(encoded, base).toString();
}

function toBase64Utf8(input: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return window.btoa(binary);
  }
  throw new Error('当前环境不支持 Base64 编码');
}

function getEtag(resp: Response): string | undefined {
  const etag = resp.headers.get('etag') || resp.headers.get('ETag');
  return etag || undefined;
}

export class WebDavClient {
  private readonly baseUrl: string;
  private readonly basePath: string;
  private readonly auth: WebDavAuth;
  private readonly timeoutMs: number;

  constructor(cfg: WebDavClientConfig) {
    this.baseUrl = normalizeBaseUrl(cfg.url);
    this.basePath = joinPath(cfg.basePath || '');
    this.auth = cfg.auth;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  private assertAvailable() {
    if (!isTauriEnvironment()) {
      throw new Error('WebDAV 同步仅在 Tauri 桌面环境可用');
    }
    if (!this.baseUrl) {
      throw new Error('WebDAV URL 为空');
    }
  }

  private authHeaders(): Record<string, string> {
    const token = toBase64Utf8(`${this.auth.username}:${this.auth.password}`);
    return { Authorization: `Basic ${token}` };
  }

  private urlFor(path: string): string {
    const fullPath = this.basePath ? joinPath(this.basePath, path) : joinPath(path);
    return buildUrl(this.baseUrl, fullPath);
  }

  async request(method: string, path: string, input?: { headers?: Record<string, string>; body?: any }): Promise<WebDavResponse> {
    this.assertAvailable();

    const url = this.urlFor(path);
    const resp: any = await tauriFetch(url, {
      method,
      rawResponse: true,
      timeout: this.timeoutMs,
      headers: {
        ...this.authHeaders(),
        ...(input?.headers || {}),
      },
      ...(input?.body !== undefined ? { body: input.body } : {}),
    });

    const status = (resp?.status ?? 0) as number;
    const statusText = (resp?.statusText ?? '') as string;
    const etag = getEtag(resp as Response);
    const text = await (resp?.text?.() as Promise<string>).catch(() => undefined);

    return { status, statusText, etag, text };
  }

  async ensureCollections(paths: string[]): Promise<void> {
    this.assertAvailable();
    for (const path of paths) {
      await this.ensureCollection(path);
    }
  }

  async ensureCollection(path: string): Promise<void> {
    this.assertAvailable();
    const segs = normalizePathSegments(path);
    let cur = '';
    for (const seg of segs) {
      cur = cur ? `${cur}/${seg}` : seg;
      const r = await this.request('MKCOL', cur);
      if (r.status === 201 || r.status === 405) continue;
      if (r.status >= 200 && r.status < 400) continue;
      throw new Error(`MKCOL 失败: ${r.status} ${r.statusText || ''}`.trim());
    }
  }

  async getJson<T>(path: string): Promise<{ status: number; etag?: string; json?: T }> {
    const r = await this.request('GET', path, { headers: { Accept: 'application/json' } });
    if (r.status === 404) return { status: 404, etag: r.etag };
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`GET 失败: ${r.status} ${r.statusText || ''}`.trim());
    }
    if (!r.text) return { status: r.status, etag: r.etag, json: undefined };
    return { status: r.status, etag: r.etag, json: JSON.parse(r.text) as T };
  }

  async putJson(path: string, data: any, input?: { ifMatch?: string | null }): Promise<{ status: number; etag?: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (input?.ifMatch !== undefined) headers['If-Match'] = input.ifMatch ?? '*';
    const r = await this.request('PUT', path, { headers, body: JSON.stringify(data) });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`PUT 失败: ${r.status} ${r.statusText || ''}`.trim());
    }
    return { status: r.status, etag: r.etag };
  }

  async propfind(path: string, depth: '0' | '1' = '0'): Promise<WebDavResponse> {
    return await this.request('PROPFIND', path, {
      headers: {
        Depth: depth,
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag />
  </d:prop>
</d:propfind>`,
    });
  }
}
