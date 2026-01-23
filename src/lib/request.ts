import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { useNetworkPreferences } from '@/store/networkPreferences';
import { isDevelopmentEnvironment } from '@/lib/utils/environment';

// 导入Ollama请求处理函数
import { processOllamaRequest } from './request-patches';

// 导入公共的浏览器兜底工具
import { shouldUseBrowserRequest } from '@/lib/provider/browser-fallback-utils';

// #region agent log
const DEBUG_LOG_ENDPOINT = 'http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737';
function postDebug(location: string, message: string, data?: unknown, hypothesisId?: string) {
  fetch(DEBUG_LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'http-trace',
      hypothesisId,
    }),
  }).catch(() => {});
}

function redactHeaders(headers: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!headers || typeof headers !== 'object') return headers;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk.includes('authorization') || lk.includes('cookie') || lk.includes('api-key') || lk.includes('x-api-key')) {
      out[k] = '<redacted>';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function prettyJsonMaybe(body: any): { pretty?: string; len?: number; kind: string } {
  try {
    if (body === undefined) return { kind: 'undefined' };
    if (body === null) return { kind: 'null', pretty: 'null', len: 4 };
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        const obj = JSON.parse(trimmed);
        const pretty = JSON.stringify(obj, null, 2);
        return { kind: 'json-string', pretty: pretty.slice(0, 12000), len: pretty.length };
      }
      return { kind: 'string', pretty: body.slice(0, 12000), len: body.length };
    }
    if (typeof body === 'object') {
      const pretty = JSON.stringify(body, null, 2);
      return { kind: 'object', pretty: pretty.slice(0, 12000), len: pretty.length };
    }
    const s = String(body);
    return { kind: typeof body, pretty: s.slice(0, 12000), len: s.length };
  } catch {
    return { kind: typeof body };
  }
}

function pushHttpTrace(entry: any) {
  try {
    if (typeof window !== 'undefined') {
      const w: any = window as any;
      const arr = Array.isArray(w.__CHATLESS_HTTP_TRACE__) ? w.__CHATLESS_HTTP_TRACE__ : [];
      arr.push(entry);
      w.__CHATLESS_HTTP_TRACE__ = arr.slice(-50);
    }
  } catch { /* noop */ }
}
// #endregion

// 环境检测：只在开发环境中启用调试日志
const __DEV__ = isDevelopmentEnvironment();
const __SHOULD_LOG__ = __DEV__;

/**
 * 通用HTTP请求选项
 * 支持超时、重试、代理、CORS等配置
 */
export interface RequestOptions {
  /** 请求超时时间 (ms) – 传递给 tauri fetch */
  timeout?: number;
  /** 最大重试次数 (默认 0 不重试) */
  retries?: number;
  /** 重试间隔 (ms)，每次翻倍 (默认 1000) */
  retryDelay?: number;
  /** 是否直接返回 Response 对象 */
  rawResponse?: boolean;
  /** 是否添加浏览器请求头 */
  browserHeaders?: boolean;
  /** 自定义Origin头，用于解决CORS问题 */
  origin?: string;
  /** 仅在调试时启用的更详细日志（不影响正常使用） */
  verboseDebug?: boolean;
  /** 调试标签，配合 verboseDebug 输出 */
  debugTag?: string;
  /** 是否尝试输出请求体/响应体预览（谨慎开启） */
  includeBodyInLogs?: boolean;
  /** 失败时是否回退到浏览器 fetch（仅对 GET 安全，默认 false） */
  fallbackToBrowserOnError?: boolean;
  /** Tauri客户端类型: default | browser_like | http1_only */
  tauriClientType?: "default" | "browser_like" | "http1_only";
  /** 额外透传给 tauri fetch 的任何字段 */
  [key: string]: any;
}

type RequestInterceptor = (url: string, options: RequestOptions) => Promise<{ url: string; options: RequestOptions }> | { url: string; options: RequestOptions };
type ResponseInterceptor = (response: Response) => Promise<Response> | Response;

const requestInterceptors: RequestInterceptor[] = [];
const responseInterceptors: ResponseInterceptor[] = [];



export function addRequestInterceptor(fn: RequestInterceptor) {
  requestInterceptors.push(fn);
}

export function addResponseInterceptor(fn: ResponseInterceptor) {
  responseInterceptors.push(fn);
}



async function applyRequestInterceptors(initialUrl: string, initialOptions: RequestOptions): Promise<{ url: string; options: RequestOptions }> {
  let current = { url: initialUrl, options: initialOptions };
  for (const interceptor of requestInterceptors) {
    current = await interceptor(current.url, current.options);
  }
  return current;
}

async function applyResponseInterceptors(resp: Response): Promise<Response> {
  let current = resp;
  for (const interceptor of responseInterceptors) {
    current = await interceptor(current);
  }
  return current;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}



/**
 * 通用HTTP请求函数
 * 基于Tauri HTTP插件，支持拦截器、重试、代理配置等功能
 * 
 * @param inputUrl 请求URL
 * @param opts 请求选项
 * @returns 响应数据或Response对象
 */
export async function request<T = any>(inputUrl: string, opts: RequestOptions = {}): Promise<T | Response> {
  const methodUpper = (opts.method || 'GET').toUpperCase();
  const defaultedOpts: RequestOptions = {
    retries: 0,
    retryDelay: 1000,
    ...opts,
  };

  // 检查提供商偏好设置，如果应该使用浏览器请求方式，直接使用browserFetch
  if (await shouldUseBrowserRequest(inputUrl, 'request')) {
    return browserFetch<T>(inputUrl, defaultedOpts);
  }

  // 应用网络偏好设置（代理、离线模式等）
  const { proxyUrl, useSystemProxy, offline } = useNetworkPreferences.getState();
  if (offline) {
    throw new Error('离线模式已开启');
  }
  if (proxyUrl && !useSystemProxy) {
    (defaultedOpts as any).proxy = { all: proxyUrl };
  }

  // 执行请求拦截器 (可修改 url / options)
  let { url, options } = await applyRequestInterceptors(inputUrl, defaultedOpts);
  
  // 直接处理Ollama请求
  const ollamaResult = processOllamaRequest(url, options);
  url = ollamaResult.url;
  options = ollamaResult.options;

  // 添加浏览器请求头（模拟浏览器行为）
  if (options.browserHeaders) {
    const browserHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site'
    };
    
    // 设置Origin头（如果指定）
    if (options.origin) {
      browserHeaders['Origin'] = options.origin;
      if (__SHOULD_LOG__) {
        console.log(`[tauriFetch] 设置自定义Origin: "${options.origin}"`);
      }
    }

    // 注意：如果不指定origin，则不设置Origin头，让Tauri自动处理
    
    options.headers = {
      ...browserHeaders,
      ...(options.headers || {})
    };
  }

  // 避免强制设置 Host 头（可能导致代理/HTTP2 异常）；缓存控制由调用方决定

  // 添加默认的安全配置（允许自签名证书等）
  if (!options.danger) {
    options.danger = {
      acceptInvalidCerts: true,
      acceptInvalidHostnames: false
    };
  }

  // 🔧 确保 body 被正确序列化为 JSON 字符串
  // Tauri HTTP 插件的 fetch 遵循 Web Fetch API，需要 body 是字符串
  if (methodUpper !== 'GET' && methodUpper !== 'HEAD' && options.body !== undefined) {
    const body = options.body;
    // 如果 body 是对象（非字符串、非 null），需要序列化
    if (body !== null && typeof body === 'object' && typeof body !== 'string') {
      // 检查是否已经是 Tauri 特殊格式 { type: 'Json'|'Form'|'Text', payload: ... }
      if (!('type' in body && 'payload' in body)) {
        // 普通对象，需要 JSON 序列化
        try {
          options.body = JSON.stringify(body);
        } catch (e) {
          console.error('[tauriFetch] Failed to stringify body:', e);
          throw new Error(`Cannot serialize request body: ${String(e)}`);
        }
      }
    }
  }

  // #region agent log
  // 根源级请求追踪：记录最终发出的 URL / method / headers(脱敏) / body(pretty)
  // 用于证明：是否“提示词里真的包含 <use_mcp_tool>”、是否存在“隐藏渠道请求”
  try {
    const hdr = redactHeaders(options.headers as any);
    const bodyInfo = prettyJsonMaybe((options as any).body);
    const entry = {
      kind: 'tauriFetch',
      url,
      method: options.method || 'GET',
      headers: hdr,
      bodyKind: bodyInfo.kind,
      bodyLen: bodyInfo.len,
      bodyPretty: bodyInfo.pretty,
      debugTag: options.debugTag || null,
    };
    pushHttpTrace(entry);
    postDebug('request.ts:H_HTTP:req', 'HTTP request (tauriFetch root trace)', entry, 'H_HTTP');
  } catch { /* noop */ }
  // #endregion

  // --- 日志策略：默认开发环境输出极简；仅当 verboseDebug=true 时输出详细 ---
  if (__DEV__) {
    const headers = (options.headers as Record<string, string>) || {};
    const tag = options.debugTag ? `[${options.debugTag}]` : '';
    if (options.verboseDebug) {
      console.log(`${tag}[tauriFetch][request] ${options.method || 'GET'} ${url}`);
      console.log(`${tag}[tauriFetch][request] headers:`, headers);
      if ((options as any).proxy) {
        console.log(`${tag}[tauriFetch][request] proxy:`, (options as any).proxy);
      }
      if (headers['Origin']) {
        console.log(`${tag}[tauriFetch][request] origin: "${headers['Origin']}"`);
      }
      if (options.includeBodyInLogs && options.body) {
        try {
          const b = (options as any).body;
          console.log(`${tag}[tauriFetch][request] body:`, b);
        } catch {
          // ignore body log errors
        }
      }
    } else {
      console.log(`${tag}[tauriFetch] ${options.method || 'GET'} ${url}`);
    }
  }

  let attempt = 0;
  let resp: Response | null = null;
  let error: any = null;

  const maxAttempts = (options.retries ?? 0) + 1;

  while (attempt < maxAttempts) {
    try {
      resp = await httpFetch(url, options as any);

      // 兼容Tauri HTTP响应对象的状态检查
      // 如果响应对象有ok属性，说明是标准的Response对象
      let status: number | undefined;
      let statusText: string | undefined;
      let isOk: boolean;
      
      if ((resp as any).ok !== undefined) {
        isOk = (resp as any).ok;
        status = (resp as any).status;
        statusText = (resp as any).statusText;
      } else {
        // 兼容旧的响应格式
        status = (resp as any).status || (resp as any).statusCode;
        statusText = (resp as any).statusText || '';
        isOk = status ? status >= 200 && status < 300 : false;
      }
      
      if (__DEV__) {
        const tag = options.debugTag ? `[${options.debugTag}]` : '';
      if (options.verboseDebug) {
        console.log(`${tag}[tauriFetch][response] ${status || 'unknown'} ${statusText || ''}`);
        const responseHeaders: Record<string, string> = {};
        resp.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        console.log(`${tag}[tauriFetch][response] headers:`, responseHeaders);
        if (options.includeBodyInLogs) {
          try {
            const enc = (resp.headers.get?.('content-encoding') || '').toLowerCase();
            if (enc && /(gzip|br|deflate)/.test(enc)) {
              console.log(`${tag}[tauriFetch][response] body: <compressed: ${enc}>`);
            } else {
              const clone = (resp as any).clone ? (resp as any).clone() : resp;
              const text = await (clone as any).text();
              console.log(`${tag}[tauriFetch][response] body:`, text);
            }
          } catch (e) {
            console.warn(`${tag}[tauriFetch][response] body log failed`, e);
          }
        }
      } else {
          console.log(`${tag}[tauriFetch] <- ${status || 'unknown'} ${statusText || ''}`);
        }
      }

      // #region agent log
      try {
        const ct = (resp.headers.get?.('content-type') || '').toLowerCase();
        const entry = {
          kind: 'tauriFetch',
          url,
          status: (resp as any).status ?? (resp as any).statusCode,
          contentType: ct,
        };
        pushHttpTrace({ ...entry, phase: 'response' });
        postDebug('request.ts:H_HTTP:resp', 'HTTP response meta (tauriFetch)', entry, 'H_HTTP');
      } catch { /* noop */ }
      // #endregion
      
      // 如果 status >= 500 且还有重试机会，进行重试
      if (!isOk && status && status >= 500 && attempt < maxAttempts - 1) {
        await sleep(options.retryDelay! * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      // 成功或客户端错误，跳出循环
      break;
    } catch (err) {
      error = err;
      if (attempt < maxAttempts - 1) {
        await sleep(options.retryDelay! * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      // exhausted retries
      if (defaultedOpts.fallbackToBrowserOnError && methodUpper === 'GET') {
        if (__DEV__) console.warn(`${options.debugTag ? `[${options.debugTag}]` : ''}[tauriFetch->browser] exception fallback`, err);
        return browserFetch<T>(url, defaultedOpts);
      }
      throw error;
    }
  }

  if (!resp) {
    if (defaultedOpts.fallbackToBrowserOnError && methodUpper === 'GET') {
      if (__DEV__) console.warn(`${options.debugTag ? `[${options.debugTag}]` : ''}[tauriFetch->browser] no response fallback`);
      return browserFetch<T>(url, defaultedOpts);
    }
    throw error ?? new Error('Unknown network error');
  }

  // 响应拦截器
  resp = await applyResponseInterceptors(resp);

  // 若调用方需要原始 Response，则直接返回
  if (options.rawResponse) return resp;

  // 非 2xx 状态时抛出包含正文的错误，方便上层捕获并展示
  if (!resp.ok) {
    if (defaultedOpts.fallbackToBrowserOnError && methodUpper === 'GET') {
      if (__DEV__) console.warn(`${options.debugTag ? `[${options.debugTag}]` : ''}[tauriFetch->browser] non-2xx fallback: ${resp.status}`);
      return browserFetch<T>(url, defaultedOpts);
    }
    let errorBody: string | undefined;
    try {
      errorBody = await (resp.clone() as any).text();
    } catch {
      errorBody = undefined;
    }
    const errMsg = `HTTP ${resp.status} ${resp.statusText}` + (errorBody ? `\nBody: ${errorBody}` : '');
    throw new Error(errMsg);
  }

  // 默认按 JSON 解析
  try {
    return await (resp as any).json();
  } catch {
    return resp as unknown as T;
  }
}

export { request as tauriFetch }; // 兼容旧引用 

/**
 * 网络连通性检查函数
 * 只检查网络是否可达，不抛出异常，返回检查结果
 * 根据Provider的浏览器请求模式配置决定使用Tauri HTTP还是浏览器fetch
 * 
 * @param url 要检查的URL
 * @param options 请求选项
 * @returns 连通性检查结果
 */
export async function checkConnectivity(url: string, options: RequestOptions = {}): Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  reason: 'SUCCESS' | 'TIMEOUT' | 'NETWORK' | 'HTTP_ERROR' | 'UNKNOWN';
}> {
  const defaultedOpts: RequestOptions = {
    timeout: 5000,
    method: 'HEAD',
    verboseDebug: false,
    ...options
  };

  try {
    if (__DEV__) {
      const tag = defaultedOpts.debugTag ? `[${defaultedOpts.debugTag}]` : '';
      console.log(`${tag}[checkConnectivity] 开始检查: ${url}`);
    }

    // 检查是否应该使用浏览器请求方式
    let resp: any;
    if (await shouldUseBrowserRequest(url, defaultedOpts.debugTag || 'checkConnectivity')) {
      if (__DEV__) {
        const tag = defaultedOpts.debugTag ? `[${defaultedOpts.debugTag}]` : '';
        console.log(`${tag}[checkConnectivity] 使用浏览器fetch检查连通性`);
      }
      
      // 使用浏览器fetch检查连通性
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), defaultedOpts.timeout || 5000);
      
      try {
        resp = await fetch(url, {
          method: defaultedOpts.method || 'HEAD',
          signal: controller.signal,
          headers: defaultedOpts.headers
        });
        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } else {
      if (__DEV__) {
        const tag = defaultedOpts.debugTag ? `[${defaultedOpts.debugTag}]` : '';
        console.log(`${tag}[checkConnectivity] 使用Tauri HTTP检查连通性`);
      }
      
      // 使用Tauri HTTP检查连通性
      resp = await httpFetch(url, {
        method: defaultedOpts.method || 'HEAD',
        timeout: defaultedOpts.timeout,
        headers: defaultedOpts.headers,
        ...defaultedOpts
      } as any);
    }

    // 获取响应状态
    let status: number | undefined;
    let statusText: string | undefined;
    
    if ((resp as any).ok !== undefined) {
      status = (resp as any).status;
      statusText = (resp as any).statusText;
    } else {
      status = (resp as any).status || (resp as any).statusCode;
      statusText = (resp as any).statusText || '';
    }

    if (__DEV__) {
      const tag = defaultedOpts.debugTag ? `[${defaultedOpts.debugTag}]` : '';
      console.log(`${tag}[checkConnectivity] 检查完成: ${status || 'unknown'} ${statusText || ''}`);
    }

    // 任何 HTTP 响应都表示网络连通
    // 即使是 404、403 等错误状态码，也说明网络是通的
    return {
      ok: true,
      status,
      statusText,
      reason: 'SUCCESS'
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    
    if (__DEV__) {
      const tag = defaultedOpts.debugTag ? `[${defaultedOpts.debugTag}]` : '';
      console.error(`${tag}[checkConnectivity] 检查失败:`, error);
    }

    // 根据错误类型分类
    if (msg.includes('TIMEOUT') || msg.toLowerCase().includes('timeout')) {
      return {
        ok: false,
        error: msg,
        reason: 'TIMEOUT'
      };
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ENOTFOUND')) {
      return {
        ok: false,
        error: msg,
        reason: 'NETWORK'
      };
    } else if (msg.includes('HTTP') && msg.includes('Not Found')) {
      // 404 等 HTTP 错误实际上表示网络是通的
      return {
        ok: true,
        status: 404,
        statusText: 'Not Found',
        reason: 'SUCCESS'
      };
    } else {
      return {
        ok: false,
        error: msg,
        reason: 'UNKNOWN'
      };
    }
  }
}

// Browser fetch 实现（通用，便于外部控制直接使用）
export async function browserFetch<T = any>(url: string, options: RequestOptions = {}): Promise<T | Response> {
  const method = (options.method || 'GET').toUpperCase();
  const init: RequestInit = {
    method,
    headers: options.headers as HeadersInit | undefined,
  };
  // 适配 body
  if (method !== 'GET' && method !== 'HEAD') {
    const body: any = (options as any).body;
    if (body && typeof body === 'object' && typeof body.type === 'string' && 'payload' in body) {
      // Tauri 特殊格式：{ type: 'Json'|'Form'|'Text', payload: ... }
      if (body.type === 'Json') {
        init.body = JSON.stringify(body.payload ?? {});
        init.headers = { ...((init.headers as Record<string, string>) || {}), 'Content-Type': 'application/json' };
      } else if (body.type === 'Form') {
        const p = new URLSearchParams();
        const data = body.payload || {};
        Object.keys(data).forEach((k) => p.append(k, String(data[k])));
        init.body = p.toString();
        init.headers = { ...((init.headers as Record<string, string>) || {}), 'Content-Type': 'application/x-www-form-urlencoded' };
      } else if (body.type === 'Text') {
        init.body = String(body.payload ?? '');
      }
    } else if (typeof body === 'string') {
      init.body = body;
    } else if (body && typeof body === 'object') {
      // 🔧 普通对象，需要 JSON 序列化
      try {
        init.body = JSON.stringify(body);
        // 如果没有设置 Content-Type，添加 application/json
        const headers = init.headers as Record<string, string> || {};
        if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
          init.headers = { ...headers, 'Content-Type': 'application/json' };
        }
      } catch (e) {
        console.error('[browserFetch] Failed to stringify body:', e);
        throw new Error(`Cannot serialize request body: ${String(e)}`);
      }
    }
  }

  // #region agent log
  try {
    const hdr = redactHeaders(init.headers as any);
    const bodyInfo = prettyJsonMaybe((init as any).body);
    const entry = {
      kind: 'browserFetch',
      url,
      method,
      headers: hdr,
      bodyKind: bodyInfo.kind,
      bodyLen: bodyInfo.len,
      bodyPretty: bodyInfo.pretty,
      debugTag: (options as any).debugTag || null,
    };
    pushHttpTrace(entry);
    postDebug('request.ts:H_HTTP:req', 'HTTP request (browserFetch root trace)', entry, 'H_HTTP');
  } catch { /* noop */ }
  // #endregion

  if (__DEV__ && options.verboseDebug) {
    const tag = options.debugTag ? `[${options.debugTag}]` : '';
    console.log(`${tag}[browserFetch][request] ${method} ${url}`);
  }

  const resp = await fetch(url, init);
  if (options.rawResponse) return resp as any;

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => undefined);
    throw new Error(`HTTP ${resp.status} ${resp.statusText}` + (bodyText ? `\nBody: ${bodyText}` : ''));
  }
  try {
    return (await resp.json()) as T;
  } catch {
    return resp as any as T;
  }
}