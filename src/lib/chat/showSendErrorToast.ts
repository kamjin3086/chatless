import { toast } from '@/components/ui/sonner';
import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';

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

export function formatSendError(error: unknown, locale: Locale): SendErrorInfo {
  const t = (key: TranslationKey) => translate(locale, key);
  const code = (error as { code?: string } | null)?.code;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const msg = raw.replace(/\s+/g, ' ').trim();
  const status = extractHttpStatus(msg);
  const providerMessage = extractProviderMessage(msg);

  if (code === 'NO_KEY' || /NO_KEY|未配置 API 密钥/i.test(msg)) {
    return {
      title: t('chatSendError.noKey.title'),
      description: t('chatSendError.noKey.description'),
      isNetwork: false,
      openProviderSettings: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      title: t('chatSendError.unauthorized.title'),
      description: t('chatSendError.unauthorized.description'),
      isNetwork: false,
      openProviderSettings: true,
    };
  }

  if (status === 404) {
    return {
      title: t('chatSendError.endpoint.title'),
      description: t('chatSendError.endpoint.description'),
      isNetwork: false,
      openProviderSettings: true,
    };
  }

  if (status === 429) {
    return {
      title: t('chatSendError.rateLimited.title'),
      description: t('chatSendError.rateLimited.description'),
      isNetwork: false,
      openProviderSettings: false,
    };
  }

  if (status === 400 || (providerMessage && status === null)) {
    return {
      title: t('chatSendError.rejected.title'),
      description: providerMessage || t('chatSendError.rejected.description'),
      isNetwork: false,
      openProviderSettings: false,
    };
  }

  if (status === 502 || status === 503 || status === 504 || status === 500 || NETWORK_RE.test(msg)) {
    return {
      title: t('chatSendError.unreachable.title'),
      description: t('chatSendError.unreachable.description'),
      isNetwork: true,
      openProviderSettings: true,
    };
  }

  return {
    title: t('chatSendError.generic.title'),
    description: t('chatSendError.generic.description'),
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
  const { locale } = useLocaleStore.getState();
  const info = formatSendError(error, locale);
  toast.error(info.title, {
    description: info.description,
    duration: 8000,
    action: info.openProviderSettings
      ? {
          label: translate(locale, 'chatSendError.configureProvider'),
          onClick: () => openProviderSettings(opts?.providerName),
        }
      : undefined,
  });
}
