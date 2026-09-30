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
 * 把健康检查的技术性错误收成设置页可读的短句。
 * 已友好的文案会原样返回；HTTP 码、系统错误码不会露到界面上。
 */
export function formatConnectionCheckMessage(raw?: string | null): string | null {
  if (!raw) return null;
  const msg = raw.replace(/\s+/g, ' ').trim();
  if (!msg) return null;

  const status = extractHttpStatus(msg);

  if (status === 401 || status === 403) return '密钥无效或没有权限';
  if (status === 404) return '接口地址不正确';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status === 502 || status === 503 || status === 504 || status === 500) {
    return '请确认服务已启动';
  }

  if (/timeout|超时/i.test(msg)) return '连接超时，请稍后重试';
  if (/enotfound|getaddrinfo|无法解析/i.test(msg)) return '无法解析地址，请检查服务地址';
  if (/econnrefused|连接被拒绝|积极拒绝|10061/i.test(msg)) return '连接被拒绝，请确认服务已启动';
  if (/服务无响应|请确认后端/i.test(msg)) return '请确认服务已启动';
  if (/服务器响应错误|status code|os error|econn|enotfound|fetch failed|failed to fetch/i.test(msg)) {
    return '请确认服务已启动';
  }
  if (/HTTP\s*\d{3}/i.test(msg) || /连接错误\s*:/i.test(msg)) {
    return '请确认服务已启动';
  }

  return msg;
}
