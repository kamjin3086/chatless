import { toast } from '@/components/ui/sonner';

export type SendErrorInfo = {
  title: string;
  description: string;
  isNetwork: boolean;
  openProviderSettings: boolean;
};

const NETWORK_RE =
  /failed to fetch|networkerror|network error|enotfound|econnrefused|econnreset|etimedout|连接.*失败|连接被拒绝|无法连接|无法解析|网络|服务.*不可达|eventsource connection|sse error|os error 10060|10061|10054|bad gateway|service unavailable|gateway timeout/i;

function extractHttpStatus(text: string): number | null {
  const labeled = text.match(/\bHTTP\s+(\d{3})\b/i);
  if (labeled) return Number(labeled[1]);
  if (/\bbad gateway\b/i.test(text)) return 502;
  if (/\bservice unavailable\b/i.test(text)) return 503;
  if (/\bgateway timeout\b/i.test(text)) return 504;
  const bare = text.match(/\b(401|403|404|429|500|502|503|504)\b/);
  return bare ? Number(bare[1]) : null;
}

/**
 * Pull the provider's own explanation out of an error body.
 *
 * Servers answer a rejected request with `{"error":{"message":"..."}}`.  That
 * sentence is the only actionable part — telling the user to "check the provider
 * configuration" for a request the provider explained in full sends them to the
 * wrong place.
 */
function extractProviderMessage(text: string): string | null {
  const match = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    const decoded = JSON.parse(`"${match[1]}"`) as string;
    return decoded.replace(/\s+/g, ' ').trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

export function formatSendError(error: unknown): SendErrorInfo {
  const code = (error as { code?: string } | null)?.code;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const msg = raw.replace(/\s+/g, ' ').trim();
  const status = extractHttpStatus(msg);
  const providerMessage = extractProviderMessage(msg);

  if (code === 'NO_KEY' || /NO_KEY|未配置 API 密钥/i.test(msg)) {
    return {
      title: '未配置 API 密钥',
      description: '请先为该提供商填写密钥。',
      isNetwork: false,
      openProviderSettings: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      title: '密钥无效或没有权限',
      description: '请检查该提供商的密钥。',
      isNetwork: false,
      openProviderSettings: true,
    };
  }

  if (status === 404) {
    return {
      title: '接口地址不正确',
      description: '请核对服务地址和路径。',
      isNetwork: false,
      openProviderSettings: true,
    };
  }

  if (status === 429) {
    return {
      title: '请求过于频繁',
      description: '请稍后再试。',
      isNetwork: false,
      openProviderSettings: false,
    };
  }

  if (status === 400 || (providerMessage && status === null)) {
    return {
      title: '模型拒绝了这次请求',
      description: providerMessage || '请检查这次请求的内容与所选模型是否兼容。',
      isNetwork: false,
      openProviderSettings: false,
    };
  }

  if (status === 502 || status === 503 || status === 504 || status === 500 || NETWORK_RE.test(msg)) {
    return {
      title: '模型服务访问不通',
      description: '请检查服务是否启动，以及地址和端口。',
      isNetwork: true,
      openProviderSettings: true,
    };
  }

  return {
    title: '发送失败',
    description: '请检查该提供商的配置。',
    isNetwork: false,
    openProviderSettings: true,
  };
}

export function openProviderSettings(providerName?: string): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams({ tab: 'localModels' });
  if (providerName) params.set('provider', providerName);
  window.location.assign(`/settings?${params.toString()}`);
}

export function showSendErrorToast(
  error: unknown,
  opts?: { rolledBack?: boolean; providerName?: string }
): void {
  const info = formatSendError(error);
  toast.error(info.title, {
    description: info.description,
    duration: 8000,
    action: info.openProviderSettings
      ? {
          label: '去配置',
          onClick: () => openProviderSettings(opts?.providerName),
        }
      : undefined,
  });
}
