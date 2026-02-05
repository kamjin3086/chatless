"use client";
import React, { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { tauriFetch } from "@/lib/request";
import { invoke } from "@tauri-apps/api/core";
import StorageUtil from "@/lib/storage";
import { ChevronLeft, ChevronRight, Save, Trash2, Play } from "lucide-react";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

type HeaderKV = { id: string; key: string; value: string };
type FormKV = { id: string; key: string; value: string };

type BodyMode = "json" | "form" | "none";
type RequestMode = "tauri" | "browser";
type TauriClientType = "default" | "browser_like" | "http1_only" | "stealth" | "minimal";

// 保存的请求数据结构
interface SavedRequest {
  id: string;
  name: string;
  url: string;
  method: HttpMethod;
  headers: HeaderKV[];
  bodyMode: BodyMode;
  jsonBody: string;
  formBody: FormKV[];
  requestMode: RequestMode;
  tauriClientType: TauriClientType;
  savedAt: string;
}

interface SendResultLog {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  request: {
    mode: RequestMode;
    tauriClientType?: TauriClientType;
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    bodyPreview?: string;
  };
  response?: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyText?: string;
    bodyJsonPretty?: string;
  };
  error?: string;
  clientInfo?: any;
}

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function HttpRequestDebugger() {
  const [requestMode, setRequestMode] = useState<RequestMode>("tauri");
  const [tauriClientType, setTauriClientType] = useState<TauriClientType>("browser_like");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState<string>("");
  const [headers, setHeaders] = useState<HeaderKV[]>([{ id: uuid(), key: "", value: "" }]);
  const [bodyMode, setBodyMode] = useState<BodyMode>("none");
  const [jsonBody, setJsonBody] = useState<string>(`{
  "hello": "world"
}`);
  const [formBody, setFormBody] = useState<FormKV[]>([{ id: uuid(), key: "", value: "" }]);
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<SendResultLog | null>(null);
  const [clientInfo, setClientInfo] = useState<any>(null);
  
  // 保存请求相关状态
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // 获取HTTP客户端信息
  useEffect(() => {
    const loadClientInfo = async () => {
      try {
        const info = await invoke("get_http_client_info");
        setClientInfo(info);
      } catch (error) {
        console.error("Failed to get HTTP client info:", error);
      }
    };
    loadClientInfo();
  }, []);

  // 加载保存的请求
  useEffect(() => {
    const loadSavedRequests = async () => {
      try {
        const saved = await StorageUtil.getItem<SavedRequest[]>("http_debugger_requests", []);
        setSavedRequests(saved || []);
      } catch (error) {
        console.error("Failed to load saved requests:", error);
      }
    };
    loadSavedRequests();
  }, []);

  const effectiveHeaders = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const h of headers) {
      const k = (h.key || "").trim();
      if (!k) continue;
      obj[k] = h.value ?? "";
    }
    if (bodyMode === "json" && method !== "GET" && method !== "HEAD") {
      if (!Object.keys(obj).some((k) => k.toLowerCase() === "content-type")) {
        obj["Content-Type"] = "application/json";
      }
    }
    if (bodyMode === "form" && method !== "GET" && method !== "HEAD") {
      if (!Object.keys(obj).some((k) => k.toLowerCase() === "content-type")) {
        obj["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }
    return obj;
  }, [headers, bodyMode, method]);

  const bodyPreview = useMemo(() => {
    if (method === "GET" || method === "HEAD") return undefined;
    if (bodyMode === "json") return jsonBody;
    if (bodyMode === "form") {
      const params = new URLSearchParams();
      formBody.forEach((p) => {
        if ((p.key || "").trim().length) params.append(p.key, p.value);
      });
      return params.toString();
    }
    return undefined;
  }, [bodyMode, jsonBody, formBody, method]);

  // 过滤保存的请求
  const filteredRequests = useMemo(() => {
    if (!searchTerm.trim()) return savedRequests;
    const term = searchTerm.toLowerCase();
    return savedRequests.filter(request => 
      request.name.toLowerCase().includes(term) ||
      request.url.toLowerCase().includes(term) ||
      request.method.toLowerCase().includes(term)
    );
  }, [savedRequests, searchTerm]);

  const addHeader = () => setHeaders((arr) => [...arr, { id: uuid(), key: "", value: "" }]);
  const removeHeader = (id: string) => setHeaders((arr) => (arr.length === 1 ? arr : arr.filter((h) => h.id !== id)));
  const updateHeader = (id: string, patch: Partial<HeaderKV>) =>
    setHeaders((arr) => arr.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const addForm = () => setFormBody((arr) => [...arr, { id: uuid(), key: "", value: "" }]);
  const removeForm = (id: string) => setFormBody((arr) => (arr.length === 1 ? arr : arr.filter((h) => h.id !== id)));
  const updateForm = (id: string, patch: Partial<FormKV>) =>
    setFormBody((arr) => arr.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  // 保存当前请求
  const saveCurrentRequest = async () => {
    if (!requestName.trim()) {
      alert("请输入请求名称");
      return;
    }
    
    const newRequest: SavedRequest = {
      id: uuid(),
      name: requestName.trim(),
      url,
      method,
      headers,
      bodyMode,
      jsonBody,
      formBody,
      requestMode,
      tauriClientType,
      savedAt: new Date().toISOString(),
    };
    
    try {
      const updatedRequests = [...savedRequests, newRequest];
      await StorageUtil.setItem("http_debugger_requests", updatedRequests);
      setSavedRequests(updatedRequests);
      setSaveDialogOpen(false);
      setRequestName("");
      alert("请求保存成功！");
    } catch (error) {
      console.error("Failed to save request:", error);
      alert("保存失败：" + String(error));
    }
  };

  // 加载保存的请求
  const loadSavedRequest = (request: SavedRequest) => {
    setUrl(request.url);
    setMethod(request.method);
    setHeaders(request.headers);
    setBodyMode(request.bodyMode);
    setJsonBody(request.jsonBody);
    setFormBody(request.formBody);
    setRequestMode(request.requestMode);
    setTauriClientType(request.tauriClientType);
    setIsSidebarOpen(false);
  };

  // 删除保存的请求
  const deleteSavedRequest = async (requestId: string) => {
    const request = savedRequests.find(r => r.id === requestId);
    if (!request) return;
    
    if (!confirm(`确定要删除请求 "${request.name}" 吗？`)) {
      return;
    }
    
    try {
      const updatedRequests = savedRequests.filter(r => r.id !== requestId);
      await StorageUtil.setItem("http_debugger_requests", updatedRequests);
      setSavedRequests(updatedRequests);
    } catch (error) {
      console.error("Failed to delete request:", error);
      alert("删除失败：" + String(error));
    }
  };

  // 测试客户端连接
  async function testClient() {
    if (!url.trim()) return;
    setSending(true);
    try {
      const result = await invoke("test_http_client", {
        url: url.trim(),
        client_type: tauriClientType
      });
      console.log("Client test result:", result);
      alert(`客户端测试结果: ${JSON.stringify(result, null, 2)}`);
    } catch (error) {
      console.error("Client test failed:", error);
      alert(`客户端测试失败: ${String(error)}`);
    } finally {
      setSending(false);
    }
  }

  // 对比测试所有客户端类型
  async function compareClients() {
    if (!url.trim()) return;
    setSending(true);
    try {
      const result = await invoke("compare_http_clients", {
        url: url.trim()
      });
      console.log("Client comparison result:", result);
      
      // 创建一个更友好的显示格式
      const resultText = Object.entries(result as Record<string, any>)
        .map(([clientType, data]) => {
          if (data.success) {
            return `${clientType}: ✅ ${data.status} (${data.duration_ms}ms)`;
          } else {
            return `${clientType}: ❌ ${data.error_type || 'error'} (${data.duration_ms}ms)\n  ${data.error}`;
          }
        })
        .join('\n');
      
      alert(`客户端对比测试结果:\n\n${resultText}`);
    } catch (error) {
      console.error("Client comparison failed:", error);
      alert(`客户端对比测试失败: ${error}`);
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (!url.trim()) return;
    setSending(true);
    const startedAt = new Date().toISOString();
    const reqLogBase: SendResultLog = {
      startedAt,
      request: {
        mode: requestMode,
        tauriClientType: requestMode === "tauri" ? tauriClientType : undefined,
        method,
        url,
        headers: effectiveHeaders,
        bodyPreview,
      },
      clientInfo: requestMode === "tauri" ? clientInfo : undefined,
    };
    const finalLog: SendResultLog = { ...reqLogBase };
    const start = performance.now();
    try {
      if (requestMode === "browser") {
        const init: RequestInit = {
          method,
          headers: effectiveHeaders,
        };
        if (method !== "GET" && method !== "HEAD") {
          if (bodyMode === "json") {
            init.body = jsonBody || "";
          } else if (bodyMode === "form") {
            const params = new URLSearchParams();
            formBody.forEach((p) => {
              if ((p.key || "").trim().length) params.append(p.key, p.value);
            });
            init.body = params.toString();
          }
        }
        console.groupCollapsed(`[HttpRequestDebugger][browser] ${method} ${url}`);
        console.log("init:", init);
        const resp = await fetch(url, init);
        const text = await resp.text();
        let pretty: string | undefined;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // ignore JSON parse error; keep text body
        }
        const headersObj: Record<string, string> = {};
        resp.headers.forEach((v, k) => (headersObj[k] = v));
        console.log("status:", resp.status, resp.statusText);
        console.log("headers:", headersObj);
        console.log("body:", pretty ?? text);
        console.groupEnd();
        finalLog.response = {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText || "",
          headers: headersObj,
          bodyText: text,
          bodyJsonPretty: pretty,
        };
      } else {
        // 使用自定义HTTP请求命令
        console.groupCollapsed(`[HttpRequestDebugger][tauri-${tauriClientType}] ${method} ${url}`);
        
        const requestBody = method !== "GET" && method !== "HEAD" ? (() => {
          if (bodyMode === "json") {
            try {
              const parsed = jsonBody ? JSON.parse(jsonBody) : {};
              return { type: "Json", payload: parsed };
            } catch {
              return { type: "Text", payload: jsonBody || "" };
            }
          } else if (bodyMode === "form") {
            const formObj: Record<string, string> = {};
            formBody.forEach((p) => {
              if ((p.key || "").trim().length) formObj[p.key] = p.value;
            });
            return { type: "Form", payload: formObj };
          }
          return undefined;
        })() : undefined;
        
        console.log("request params:", {
          url,
          method,
          headers: effectiveHeaders,
          body: requestBody,
          clientType: tauriClientType
        });
        
        const customResult = await invoke("send_http_request", {
          url,
          method,
          headers: effectiveHeaders,
          body: requestBody,
          client_type: tauriClientType,
          timeout_ms: 30000
        }) as any;
        
        console.log("custom result:", customResult);
        
        if (customResult.error) {
          throw new Error(customResult.error);
        }
        
        const status = customResult.status;
        const statusText = customResult.status_text;
        const ok = customResult.success;
        const headersObj = customResult.headers;
        const text = customResult.body;
        
        let pretty: string | undefined;
        try { 
          pretty = JSON.stringify(JSON.parse(text), null, 2); 
        } catch {
          // ignore JSON parse error; keep text body
        }
        
        console.log("status:", status, statusText);
        console.log("headers:", headersObj);
        console.log("body:", pretty ?? text);
        console.log("duration:", customResult.duration_ms, "ms");
        console.log("client_type:", customResult.client_type);
        console.groupEnd();
        
        finalLog.response = {
          ok,
          status,
          statusText,
          headers: headersObj,
          bodyText: text,
          bodyJsonPretty: pretty,
        };
      }
    } catch (e: any) {
      finalLog.error = e?.message || String(e);
    } finally {
      const finishedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - start);
      finalLog.finishedAt = finishedAt;
      finalLog.durationMs = durationMs;
      setLog(finalLog);
      setSending(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* 侧边栏 */}
      <div className={`bg-gray-50 dark:bg-slate-800 border-r transition-all duration-300 ${
        isSidebarOpen ? 'w-80' : 'w-0'
      } overflow-hidden`}>
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">保存的请求</h3>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsSidebarOpen(false)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
          
          {/* 搜索框 */}
          <div className="mb-4">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索请求..."
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:border-gray-600"
            />
          </div>
          
          <div className="flex-1 overflow-auto space-y-2">
            {savedRequests.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-8">
                暂无保存的请求
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-8">
                没有匹配的请求
              </div>
            ) : (
              filteredRequests.map((request) => (
                <div key={request.id} className="border rounded p-3 bg-white dark:bg-slate-700">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{request.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {request.method} {request.url}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(request.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => loadSavedRequest(request)}
                        className="p-1 h-6 w-6"
                      >
                        <Play className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSavedRequest(request.id)}
                        className="p-1 h-6 w-6 text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 max-w-[1100px] mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${isSidebarOpen ? 'rotate-180' : ''}`} />
            </Button>
            <h2 className="text-xl font-semibold">HTTP 请求调试器</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setSaveDialogOpen(true)}
              disabled={!url.trim()}
            >
              <Save className="w-4 h-4 mr-1" />
              保存请求
            </Button>
            {clientInfo && (
              <div className="text-xs text-gray-500 border rounded p-2 bg-gray-50 dark:bg-slate-800">
                <div>TLS Backend: {clientInfo.tls_backend}</div>
                <div>Available Clients: {clientInfo.available_clients?.join(", ")}</div>
              </div>
            )}
          </div>
        </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-4">
          <label className="block text-xs text-gray-500 mb-1">请求地址</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/api"
            className="h-9 w-full border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">方法</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
            className="h-9 w-full border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
          >
            {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as HttpMethod[]).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">模式</label>
          <select
            value={requestMode}
            onChange={(e) => setRequestMode(e.target.value as RequestMode)}
            className="h-9 w-full border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
          >
            <option value="tauri">Tauri HTTP</option>
            <option value="browser">浏览器 fetch</option>
          </select>
        </div>
        {requestMode === "tauri" && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">客户端类型</label>
            <select
              value={tauriClientType}
              onChange={(e) => setTauriClientType(e.target.value as TauriClientType)}
              className="h-9 w-full border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
            >
              <option value="stealth">🥷 隐秘模式（反检测）</option>
              <option value="minimal">⚡ 最小化客户端</option>
              <option value="browser_like">🌐 浏览器模拟</option>
              <option value="http1_only">🔗 HTTP/1.1 专用</option>
              <option value="default">⚙️ 默认客户端</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Body 类型</label>
          <select
            value={bodyMode}
            onChange={(e) => setBodyMode(e.target.value as BodyMode)}
            className="h-9 w-full border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
          >
            <option value="none">无</option>
            <option value="json">JSON</option>
            <option value="form">表单</option>
          </select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button disabled={sending || !url} onClick={send}>{sending ? "发送中…" : "发送"}</Button>
          {requestMode === "tauri" && (
            <>
              <Button 
                variant="outline" 
                disabled={sending || !url} 
                onClick={testClient}
                size="sm"
              >
                测试客户端
              </Button>
              <Button 
                variant="outline" 
                disabled={sending || !url} 
                onClick={compareClients}
                size="sm"
              >
                对比所有客户端
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => setLog(null)}>清空结果</Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-500">Headers</label>
          <button className="text-xs text-blue-600 hover:underline" onClick={addHeader}>添加一行</button>
        </div>
        <div className="space-y-2">
          {headers.map((h) => (
            <div key={h.id} className="grid grid-cols-12 gap-2">
              <input
                value={h.key}
                onChange={(e) => updateHeader(h.id, { key: e.target.value })}
                placeholder="Header Key"
                className="col-span-5 h-8 border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
              />
              <input
                value={h.value}
                onChange={(e) => updateHeader(h.id, { value: e.target.value })}
                placeholder="Header Value"
                className="col-span-6 h-8 border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
              />
              <div className="col-span-1 flex items-center justify-end">
                <button className="text-xs text-red-600 hover:underline" onClick={() => removeHeader(h.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {bodyMode === "json" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">JSON Body</label>
          <textarea
            value={jsonBody}
            onChange={(e) => setJsonBody(e.target.value)}
            className="min-h-[160px] w-full border border-gray-300 rounded px-2 py-1 font-mono text-[12px] bg-white dark:bg-slate-800 dark:border-gray-600"
          />
        </div>
      )}

      {bodyMode === "form" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-500">表单参数</label>
            <button className="text-xs text-blue-600 hover:underline" onClick={addForm}>添加一行</button>
          </div>
          {formBody.map((f) => (
            <div key={f.id} className="grid grid-cols-12 gap-2">
              <input
                value={f.key}
                onChange={(e) => updateForm(f.id, { key: e.target.value })}
                placeholder="字段名"
                className="col-span-5 h-8 border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
              />
              <input
                value={f.value}
                onChange={(e) => updateForm(f.id, { value: e.target.value })}
                placeholder="字段值"
                className="col-span-6 h-8 border border-gray-300 rounded px-2 text-sm bg-white dark:bg-slate-800 dark:border-gray-600"
              />
              <div className="col-span-1 flex items-center justify-end">
                <button className="text-xs text-red-600 hover:underline" onClick={() => removeForm(f.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs text-gray-500">请求与响应日志</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <textarea
            readOnly
            value={(() => {
              if (!log) return "";
              const req = log.request;
              const lines: string[] = [];
              lines.push(`# Request`);
              lines.push(`Mode: ${req.mode}`);
              if (req.tauriClientType) {
                lines.push(`Tauri Client: ${req.tauriClientType}`);
              }
              lines.push(`Method: ${req.method}`);
              lines.push(`URL: ${req.url}`);
              lines.push(`Time: ${log.startedAt}`);
              if (log.clientInfo) {
                lines.push(`\nClient Info:`);
                lines.push(`TLS Backend: ${log.clientInfo.tls_backend}`);
                lines.push(`Available Clients: ${log.clientInfo.available_clients?.join(", ")}`);
              }
              lines.push(`\nHeaders:`);
              Object.entries(req.headers || {}).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
              if (req.bodyPreview !== undefined) {
                lines.push("\nBody preview:");
                lines.push(typeof req.bodyPreview === "string" ? req.bodyPreview : String(req.bodyPreview));
              }
              return lines.join("\n");
            })()}
            className="min-h-[240px] w-full border border-gray-300 rounded px-2 py-1 font-mono text-[12px] bg-gray-50 dark:bg-slate-800 dark:border-gray-600"
          />
          <textarea
            readOnly
            value={(() => {
              if (!log) return "";
              if (log.error) {
                return [`# Error`, `Finished: ${log.finishedAt ?? ""}  (${log.durationMs ?? 0}ms)`, `Message: ${log.error}`].join("\n");
              }
              const r = log.response;
              if (!r) return "";
              const lines: string[] = [];
              lines.push(`# Response`);
              lines.push(`Finished: ${log.finishedAt ?? ""}  (${log.durationMs ?? 0}ms)`);
              lines.push(`Status: ${r.status} ${r.statusText}`);
              lines.push(`Ok: ${r.ok}`);
              lines.push(`Headers:`);
              Object.entries(r.headers || {}).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
              if (r.bodyJsonPretty) {
                lines.push("\nBody (JSON):");
                lines.push(r.bodyJsonPretty);
              } else if (r.bodyText) {
                lines.push("\nBody (text):");
                lines.push(r.bodyText);
              }
              return lines.join("\n");
            })()}
            className="min-h-[240px] w-full border border-gray-300 rounded px-2 py-1 font-mono text-[12px] bg-gray-50 dark:bg-slate-800 dark:border-gray-600"
          />
        </div>
      </div>
      </div>
      
      {/* 保存请求对话框 */}
      {saveDialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 w-96 mx-4">
            <h3 className="text-lg font-semibold mb-4">保存请求</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">请求名称</label>
                <input
                  type="text"
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && requestName.trim()) {
                      saveCurrentRequest();
                    } else if (e.key === 'Escape') {
                      setSaveDialogOpen(false);
                      setRequestName("");
                    }
                  }}
                  placeholder="输入请求名称..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:border-gray-600"
                  autoFocus
                />
              </div>
              <div className="text-sm text-gray-500">
                <div>方法: {method}</div>
                <div>URL: {url}</div>
                <div>模式: {requestMode === "tauri" ? `Tauri (${tauriClientType})` : "浏览器"}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <Button 
                onClick={saveCurrentRequest}
                disabled={!requestName.trim()}
                className="flex-1"
              >
                保存
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setSaveDialogOpen(false);
                  setRequestName("");
                }}
                className="flex-1"
              >
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

