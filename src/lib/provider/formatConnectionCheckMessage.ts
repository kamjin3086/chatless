import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';

// Translate exact app-owned messages at presentation time; other text can come from providers.
const connectionMessageKeys = new Map<string, TranslationKey>([
  ['接口可访问', 'provider.connection.reachable'],
  ['接口可访问，密钥请使用时再确认', 'provider.connection.reachableVerifyKey'],
  ['请检查服务是否启动以及地址和端口', 'provider.connection.checkAddressAndPort'],
  ['无法连接，请检查服务是否启动以及地址和端口', 'provider.connection.disconnectedHelp'],
  ['连接超时', 'provider.connection.timedOut'],
  ['网络连接正常', 'provider.connection.networkConnected'],
  ['网络连接失败', 'provider.connection.networkFailed'],
  ['服务无响应，请确认后端已启动', 'provider.connection.serviceUnresponsive'],
  ['该地址没有返回模型接口', 'provider.connection.noModelsEndpoint'],
  ['接口路径不正确', 'provider.connection.badPath'],
  ['服务异常', 'provider.connection.serviceError'],
  ['请确认服务已启动', 'provider.connection.checkService'],
  ['未配置服务地址', 'provider.connection.serviceUrlRequired'],
  ['未配置 API 密钥', 'provider.connection.apiKeyRequired'],
  ['未配置API密钥', 'provider.connection.apiKeyRequired'],
  ['无法连接', 'provider.connection.disconnected'],
  ['鉴权失败，请检查 API Key', 'provider.connection.authFailed'],
  ['网络异常或服务不可达', 'provider.connection.networkUnavailable'],
  ['检查失败', 'provider.connection.checkFailed'],
  ['刷新失败', 'provider.connection.checkFailed'],
  ['状态未知，请手动刷新', 'provider.connection.unknownStatus'],
  ['未知错误', 'provider.connection.unknownError'],
]);

export function translateConnectionCheckMessage(locale: Locale, message: string): string {
  if (locale === 'zh') return message;
  const key = connectionMessageKeys.get(message);
  return key ? translate(locale, key) : message;
}

function extractHttpStatus(text: string): number | null {
  const labeled = text.match(/\bHTTP\s+(\d{3})\b/i);
  if (labeled) return Number(labeled[1]);
  if (/\bbad gateway\b/i.test(text)) return 502;
  if (/\bservice unavailable\b/i.test(text)) return 503;
  if (/\bgateway timeout\b/i.test(text)) return 504;
  const bare = text.match(/\b(401|403|404|429|500|502|503|504)\b/);
  return bare ? Number(bare[1]) : null;
}

/** Summarize recognized technical errors in the connection hint without changing the stored message. */
export function formatConnectionCheckMessage(locale: Locale, raw?: string | null): string | null {
  if (!raw) return null;
  const msg = raw.replace(/\s+/g, ' ').trim();
  if (!msg) return null;

  const status = extractHttpStatus(msg);

  if (status === 401 || status === 403) return translate(locale, 'provider.connection.badKey');
  if (status === 404) return translate(locale, 'provider.connection.badAddress');
  if (status === 429) return translate(locale, 'provider.connection.rateLimited');
  if (status === 502 || status === 503 || status === 504 || status === 500) {
    return translate(locale, 'provider.connection.checkService');
  }

  if (/timeout|超时/i.test(msg)) return translate(locale, 'provider.connection.timeoutRetry');
  if (/enotfound|getaddrinfo|无法解析/i.test(msg)) return translate(locale, 'provider.connection.addressResolutionFailed');
  if (/econnrefused|连接被拒绝|积极拒绝|10061/i.test(msg)) return translate(locale, 'provider.connection.refused');
  if (/服务无响应|请确认后端/i.test(msg)) return translate(locale, 'provider.connection.checkService');
  if (/服务器响应错误|status code|os error|econn|enotfound|fetch failed|failed to fetch/i.test(msg)) {
    return translate(locale, 'provider.connection.checkService');
  }
  if (/HTTP\s*\d{3}/i.test(msg) || /连接错误\s*:/i.test(msg)) {
    return translate(locale, 'provider.connection.checkService');
  }

  return translateConnectionCheckMessage(locale, msg);
}
