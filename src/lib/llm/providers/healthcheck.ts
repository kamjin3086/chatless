import type { CheckResult } from './BaseProvider';

export type HealthJudge = {
  ok: boolean;
  reason?: CheckResult['reason'];
  message?: string;
  status: number;
  parsed?: unknown;
};

function looksLikeHtml(text: string, contentType?: string): boolean {
  if (contentType && /text\/html/i.test(contentType)) return true;
  const head = text.trim().slice(0, 256).toLowerCase();
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body')
  );
}

function parseJson(text: string): any | null {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function looksLikeLlmApiJson(parsed: any): boolean {
  if (Array.isArray(parsed)) {
    return parsed.length === 0 || (parsed[0] && typeof parsed[0] === 'object');
  }
  if (!parsed || typeof parsed !== 'object') return false;
  if (Array.isArray(parsed.data) || Array.isArray(parsed.models) || Array.isArray(parsed.choices)) return true;
  if (parsed.object === 'list' || parsed.object === 'chat.completion' || parsed.object === 'model') return true;
  if (parsed.error || parsed.errors || parsed.error_code || parsed.errorCode) return true;
  if (parsed.status === 'error' || parsed.ok === false) return true;
  if (typeof parsed.code === 'string' || typeof parsed.type === 'string') return true;
  return false;
}

/**
 * 判定「模型接口是否真的可用」，而不是「这个端口有没有回 HTTP」。
 * 502/503/504、HTML 网关页、空状态码都不算连通。
 * 401/403/429 以及带 LLM JSON 错误体的 4xx，说明对上了 API，算可达。
 */
export function judgeApiReachable(
  status: number,
  bodyText: string | null | undefined,
  contentType?: string,
): HealthJudge {
  const text = String(bodyText || '');
  const parsed = parseJson(text.trim());

  if (!status || status < 100) {
    return { ok: false, reason: 'NETWORK', message: '请检查服务是否启动以及地址和端口', status, parsed };
  }

  if (status === 502 || status === 503 || status === 504) {
    return { ok: false, reason: 'NETWORK', message: '服务无响应，请确认后端已启动', status, parsed };
  }

  if (looksLikeHtml(text, contentType)) {
    return { ok: false, reason: 'UNKNOWN', message: '该地址没有返回模型接口', status, parsed };
  }

  if (status === 401 || status === 403) {
    return { ok: true, reason: 'AUTH', message: '接口可访问，密钥请使用时再确认', status, parsed };
  }

  if (status === 429) {
    return { ok: true, message: '接口可访问', status, parsed };
  }

  if (status >= 200 && status < 300) {
    if (status === 204 || !text.trim() || looksLikeLlmApiJson(parsed)) {
      return { ok: true, message: '接口可访问', status, parsed };
    }
    return { ok: false, reason: 'UNKNOWN', message: '该地址没有返回模型接口', status, parsed };
  }

  if (status >= 400 && status < 500) {
    if (looksLikeLlmApiJson(parsed)) {
      return { ok: true, message: '接口可访问', status, parsed };
    }
    if (status === 404 || status === 405) {
      return { ok: false, reason: 'UNKNOWN', message: '接口路径不正确', status, parsed };
    }
    return { ok: false, reason: 'UNKNOWN', message: `HTTP ${status}`, status, parsed };
  }

  if (status >= 500) {
    return { ok: false, reason: 'NETWORK', message: '服务异常', status, parsed };
  }

  return { ok: false, reason: 'UNKNOWN', message: `HTTP ${status}`, status, parsed };
}

export function classifyNetworkError(error: unknown): CheckResult {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (/timeout|abort|10060|timed out/i.test(msg)) {
    return { ok: false, reason: 'TIMEOUT', message: '连接超时' };
  }
  if (
    /network|fetch|enotfound|econn|tcp connect|10061|10065|refused|unreachable|dns|reset|connection failed|积极拒绝|无法连接/i.test(
      msg,
    )
  ) {
    return { ok: false, reason: 'NETWORK', message: '请检查服务是否启动以及地址和端口' };
  }
  return { ok: false, reason: 'UNKNOWN', message: msg || '无法连接' };
}

export async function probeOpenAICompatibleBase(
  baseUrl: string,
  options: { apiKey?: string | null; timeout?: number; debugTag?: string } = {},
): Promise<CheckResult> {
  const base = baseUrl.replace(/\/$/, '');
  const { tauriFetch } = await import('@/lib/request');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  const request = async (url: string, init: Record<string, unknown>) => {
    const resp: any = await tauriFetch(url, {
      ...init,
      rawResponse: true,
      timeout: options.timeout ?? 8000,
      fallbackToBrowserOnError: false,
      debugTag: options.debugTag || 'Provider-HealthCheck',
    });
    const status = (resp?.status ?? 0) as number;
    const contentType = resp?.headers?.get?.('content-type') || '';
    const text = (await resp.text?.()) || '';
    return { status, text, contentType };
  };

  try {
    const models = await request(`${base}/models`, { method: 'GET', headers });
    const judged = judgeApiReachable(models.status, models.text, models.contentType);
    if (judged.ok) {
      return { ok: true, message: judged.message, meta: { status: models.status, probe: 'models' } };
    }
    if (models.status === 404 || models.status === 405) {
      const chat = await request(`${base}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: {
          model: 'healthcheck',
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          max_tokens: 1,
        },
      });
      const fallback = judgeApiReachable(chat.status, chat.text, chat.contentType);
      if (fallback.ok) {
        return { ok: true, message: fallback.message, meta: { status: chat.status, probe: 'chat' } };
      }
      return {
        ok: false,
        reason: fallback.reason || 'UNKNOWN',
        message: fallback.message || `HTTP ${chat.status}`,
        meta: { status: chat.status, probe: 'chat' },
      };
    }
    return {
      ok: false,
      reason: judged.reason || 'UNKNOWN',
      message: judged.message || `HTTP ${models.status}`,
      meta: { status: models.status, probe: 'models' },
    };
  } catch (error) {
    return classifyNetworkError(error);
  }
}
