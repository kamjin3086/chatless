"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { serverManager } from '@/lib/mcp/ServerManager';
import { invoke } from '@tauri-apps/api/core';

export default function McpTestPage() {
  const [name, setName] = useState('git');
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'http'>('stdio');
  // stdio
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('-y @modelcontextprotocol/server-git');
  const [envText, setEnvText] = useState('');
  // sse/http
  const [baseUrl, setBaseUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [status, setStatus] = useState('disconnected');
  const [tools, setTools] = useState<any[]>([]);
  const [log, setLog] = useState<string>('');
  const [resources, setResources] = useState<any>(null);
  const [resourceUri, setResourceUri] = useState<string>('');
  const [resourceContent, setResourceContent] = useState<any>(null);
  const [prompts, setPrompts] = useState<any>(null);
  const [promptName, setPromptName] = useState<string>('');
  const [promptArgs, setPromptArgs] = useState<string>('{}');
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [toolArgs, setToolArgs] = useState<string>('{}');
  const [confirmTool, setConfirmTool] = useState<boolean>(true);

  useEffect(() => {
    const off = serverManager.on((e) => {
      if (e.type === 'SERVER_STATUS' && e.payload?.name === name) {
        setStatus(e.payload.status);
      }
      if (e.type === 'ERROR') {
        setLog((l) => l + `\nERROR: ${String(e.payload?.error ?? 'unknown')}`);
      }
    });
    return () => { off(); };
  }, [name]);

  const parsePairs = useCallback((text: string) => {
    const items = text.split(/\n|,/g).map(s => s.trim()).filter(Boolean);
    const pairs: [string, string][] = [];
    for (const it of items) {
      const idx = it.indexOf('=');
      if (idx > 0) pairs.push([it.slice(0, idx).trim(), it.slice(idx + 1).trim()]);
    }
    return pairs;
  }, []);

  const cfg = useMemo(() => {
    if (transport === 'stdio') {
      return {
        type: 'stdio' as const,
        command,
        args: args.trim().length ? args.split(' ').filter(Boolean) : [],
        env: parsePairs(envText),
      };
    }
    return {
      type: transport,
      baseUrl: baseUrl.trim(),
      headers: parsePairs(headersText),
    } as const;
  }, [transport, command, args, envText, baseUrl, headersText, parsePairs]);

  const useEverythingPreset = useCallback(() => {
    setTransport('stdio');
    setName('everything');
    setCommand('npx');
    setArgs('-y @modelcontextprotocol/server-everything');
    setEnvText('');
    setLog((l)=> l + `\nApplied preset: everything (stdio)`);
  }, []);

  const useGitPreset = useCallback(() => {
    setTransport('stdio');
    setName('git');
    setCommand('npx');
    setArgs('-y @modelcontextprotocol/server-git');
    setEnvText('');
    setLog((l)=> l + `\nApplied preset: git (stdio)`);
  }, []);

  const useSseTemplate = useCallback(() => {
    setTransport('sse');
    setName('sse');
    setBaseUrl('http://127.0.0.1:8789/sse');
    setHeadersText('');
    setLog((l)=> l + `\nApplied template: SSE`);
  }, []);

  const useHttpTemplate = useCallback(() => {
    setTransport('http');
    setName('http');
    setBaseUrl('http://localhost:8790/mcp');
    setHeadersText('');
    setLog((l)=> l + `\nApplied template: HTTP`);
  }, []);

  const connect = useCallback(async () => {
    try {
      if (transport !== 'stdio') {
        if (!baseUrl.trim()) {
          setLog((l)=> l + `\nERROR: baseUrl 为空，请先输入有效 URL（例：http://127.0.0.1:8787/sse）`);
          return;
        }
      }
      await serverManager.startServer(name, cfg);
      setLog((l) => l + `\nConnected ${name}`);
    } catch (e) {
      setLog((l) => l + `\nConnect failed: ${String(e)}`);
    }
  }, [name, cfg, transport, baseUrl]);

  const disconnect = useCallback(async () => {
    try {
      await serverManager.stopServer(name);
      setLog((l) => l + `\nDisconnected ${name}`);
    } catch (e) {
      setLog((l) => l + `\nDisconnect failed: ${String(e)}`);
    }
  }, [name]);

  const loadTools = useCallback(async () => {
    try {
      const list = await serverManager.listTools(name);
      setTools(list);
      if (list && list.length) setSelectedTool(list[0].name);
      setLog((l) => l + `\nLoaded tools: ${list.length}`);
    } catch (e) {
      setLog((l) => l + `\nList tools failed: ${String(e)}`);
    }
  }, [name]);

  const callSelectedTool = useCallback(async () => {
    try {
      if (!tools.length || !selectedTool) return;
      if (confirmTool && !window.confirm(`Call tool: ${selectedTool}?`)) return;
      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(toolArgs || '{}'); } catch { parsed = {}; }
      const res = await serverManager.callTool(name, selectedTool, parsed);
      setLog((l) => l + `\nCall ${selectedTool} => ${JSON.stringify(res)}`);
    } catch (e) {
      setLog((l) => l + `\nCall tool failed: ${String(e)}`);
    }
  }, [name, tools, selectedTool, toolArgs, confirmTool]);

  const listResources = useCallback(async () => {
    try {
      const res = await serverManager.listResources(name);
      setResources(res);
      setLog((l) => l + `\nListed resources`);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Method not found') || msg.includes('-32601')) {
        setLog((l) => l + `\nList resources failed: 当前服务器未实现 Resources（-32601）。可使用 everything 测试服务器预设重试。`);
      } else {
        setLog((l) => l + `\nList resources failed: ${msg}`);
      }
    }
  }, [name]);

  const readResource = useCallback(async () => {
    try {
      if (!resourceUri.trim()) return;
      const res = await serverManager.readResource(name, resourceUri.trim());
      setResourceContent(res);
      setLog((l) => l + `\nRead resource`);
    } catch (e) {
      setLog((l) => l + `\nRead resource failed: ${String(e)}`);
    }
  }, [name, resourceUri]);

  const listPrompts = useCallback(async () => {
    try {
      const res = await serverManager.listPrompts(name);
      setPrompts(res);
      setLog((l) => l + `\nListed prompts`);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Method not found') || msg.includes('-32601')) {
        setLog((l) => l + `\nList prompts failed: 当前服务器未实现 Prompts（-32601）。可使用 everything 测试服务器预设重试。`);
      } else {
        setLog((l) => l + `\nList prompts failed: ${msg}`);
      }
    }
  }, [name]);

  const getPrompt = useCallback(async () => {
    try {
      if (!promptName.trim()) return;
      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(promptArgs || '{}'); } catch { parsed = {}; }
      const res = await serverManager.getPrompt(name, promptName.trim(), parsed);
      setLog((l) => l + `\nGot prompt: ${JSON.stringify(res).slice(0, 500)}...`);
    } catch (e) {
      setLog((l) => l + `\nGet prompt failed: ${String(e)}`);
    }
  }, [name, promptName, promptArgs]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">MCP Test</h1>
      {/* 本地测试服务器控制 */}
      <div className="flex flex-wrap gap-2">
        <button
          className="px-3 py-1 rounded-md bg-teal-600 text-white"
          onClick={async ()=>{
            try {
              await invoke('start_local_sse_server', { address: '127.0.0.1:8787' });
              alert('已启动本地简单 SSE 服务：127.0.0.1:8787/sse');
            } catch(e){ alert('启动失败: '+ String(e)); }
          }}
        >启动简单 SSE 服务(事件流)</button>
        <button
          className="px-3 py-1 rounded-md bg-teal-700 text-white"
          onClick={async ()=>{
            try {
              await invoke('start_local_mcp_sse', { address: '127.0.0.1:8788' });
              alert('已启动本地最小 MCP SSE 服务：127.0.0.1:8788/sse');
            } catch(e){ alert('启动失败: '+ String(e)); }
          }}
        >启动最小 MCP SSE 服务</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <label className="flex items-center gap-2">
          <span className="w-24">Name</span>
          <input className="border px-2 py-1 rounded-md w-full" value={name} onChange={(e)=>setName(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-24">Transport</span>
          <select className="border px-2 py-1 rounded-md w-full" value={transport} onChange={(e)=>setTransport(e.target.value as any)}>
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </label>
        {transport === 'stdio' ? (
          <>
            <label className="flex items-center gap-2">
              <span className="w-24">Command</span>
              <input className="border px-2 py-1 rounded-md w-full" value={command} onChange={(e)=>setCommand(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <span className="w-24">Args</span>
              <input className="border px-2 py-1 rounded-md w-full" value={args} onChange={(e)=>setArgs(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="flex items-center gap-2 md:col-span-2">
            <span className="w-24">Base URL</span>
            <input className="border px-2 py-1 rounded-md w-full" placeholder="http(s)://..." value={baseUrl} onChange={(e)=>setBaseUrl(e.target.value)} />
          </label>
        )}
      </div>

      {transport === 'stdio' ? (
        <div className="grid grid-cols-1 md:grid-cols-1 gap-2">
          <label className="flex items-center gap-2">
            <span className="w-24">Env</span>
            <input className="border px-2 py-1 rounded-md w-full" placeholder="KEY=VALUE,KEY2=VALUE2 或换行分隔" value={envText} onChange={(e)=>setEnvText(e.target.value)} />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-1 gap-2">
          <label className="flex items-center gap-2">
            <span className="w-24">Headers</span>
            <input className="border px-2 py-1 rounded-md w-full" placeholder="Authorization=Bearer xxx, X-Api-Key=xxx" value={headersText} onChange={(e)=>setHeadersText(e.target.value)} />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-1 rounded-md bg-blue-600 text-white" onClick={connect}>Connect</button>
        <button className="px-3 py-1 rounded-md bg-slate-600 text-white" onClick={disconnect}>Disconnect</button>
        <button className="px-3 py-1 rounded-md bg-emerald-600 text-white" onClick={loadTools}>List Tools</button>
        <div className="flex items-center gap-2">
          <select className="border px-2 py-1 rounded-md" value={selectedTool} onChange={e=>setSelectedTool(e.target.value)}>
            {tools.map(t => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <input className="border px-2 py-1 rounded-md w-64" placeholder='tool args JSON' value={toolArgs} onChange={e=>setToolArgs(e.target.value)} />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={confirmTool} onChange={e=>setConfirmTool(e.target.checked)} /> Confirm
          </label>
          <button className="px-3 py-1 rounded-md bg-orange-600 text-white" onClick={callSelectedTool} disabled={!tools.length}>Call Tool</button>
        </div>
        <span className="px-2 py-1 border rounded-md">Status: {status}</span>
        <button className="px-3 py-1 rounded-md bg-fuchsia-600 text-white" onClick={useEverythingPreset}>Preset: Everything</button>
        <button className="px-3 py-1 rounded-md bg-fuchsia-600 text-white" onClick={useGitPreset}>Preset: Git</button>
        <button className="px-3 py-1 rounded-md bg-indigo-600 text-white" onClick={useSseTemplate}>Template: SSE</button>
        <button className="px-3 py-1 rounded-md bg-indigo-700 text-white" onClick={useHttpTemplate}>Template: HTTP</button>
      </div>

      <div>
        <h2 className="font-medium">Tools</h2>
        <pre className="p-2 bg-slate-100 rounded-md overflow-auto text-xs max-h-64">{JSON.stringify(tools, null, 2)}</pre>
      </div>

      <div className="space-y-2">
        <h2 className="font-medium">Resources</h2>
        <p className="text-xs text-slate-500">
          说明：并非所有 MCP Server 都实现 Resources（如 mcp-server-git 通常没有）。
          如果这里一直为空，尝试将 Command 改为 <code>uvx</code> 或 <code>npx</code>，Args 改为 <code>@modelcontextprotocol/server-everything</code>，
          连接后点击 List Resources。资源 URI 示例：<code>test://static/resource/1</code>
        </p>
        <div className="flex gap-2">
          <button className="px-3 py-1 rounded-md bg-indigo-600 text-white" onClick={listResources}>List Resources</button>
          <input className="border px-2 py-1 rounded-md w-full" placeholder="resource uri（如 test://static/resource/1）" value={resourceUri} onChange={e=>setResourceUri(e.target.value)} />
          <button className="px-3 py-1 rounded-md bg-indigo-700 text-white" onClick={readResource}>Read Resource</button>
        </div>
        {!resources && (
          <div className="text-xs text-slate-500">暂无结果：服务器可能未实现 Resources，或尚未点击 List Resources。</div>
        )}
        <pre className="p-2 bg-slate-100 rounded-md overflow-auto text-xs max-h-64">{JSON.stringify(resources, null, 2)}</pre>
        <pre className="p-2 bg-slate-100 rounded-md overflow-auto text-xs max-h-64">{JSON.stringify(resourceContent, null, 2)}</pre>
      </div>

      <div className="space-y-2">
        <h2 className="font-medium">Prompts</h2>
        <p className="text-xs text-slate-500">
          说明：若使用 <code>@modelcontextprotocol/server-everything</code>，List Prompts 会返回多个可用的提示，
          例如 <code>simple_prompt</code> / <code>complex_prompt</code> / <code>resource_prompt</code>。
          在下方输入 Prompt 名称并提供参数 JSON（如 <code>{'{'}"temperature":0.7{'}'}</code> 或 <code>{'{'}"resourceId":1{'}'}</code>），点击 Get Prompt 查看结果。
          其他服务器可能不支持该能力。
        </p>
        <div className="flex gap-2">
          <button className="px-3 py-1 rounded-md bg-purple-600 text-white" onClick={listPrompts}>List Prompts</button>
        </div>
        <div className="flex gap-2">
          <input className="border px-2 py-1 rounded-md w-1/3" placeholder="prompt name（如 simple_prompt）" value={promptName} onChange={e=>setPromptName(e.target.value)} />
          <input className="border px-2 py-1 rounded-md w-2/3" placeholder='args JSON（如 {"temperature":0.7} 或 {"resourceId":1}）' value={promptArgs} onChange={e=>setPromptArgs(e.target.value)} />
          <button className="px-3 py-1 rounded-md bg-purple-700 text-white" onClick={getPrompt}>Get Prompt</button>
        </div>
        {!prompts && (
          <div className="text-xs text-slate-500">暂无结果：服务器可能未实现 Prompts，或尚未点击 List Prompts。</div>
        )}
        <pre className="p-2 bg-slate-100 rounded-md overflow-auto text-xs max-h-64">{JSON.stringify(prompts, null, 2)}</pre>
      </div>

      <div>
        <h2 className="font-medium">Log</h2>
        <pre className="p-2 bg-slate-100 rounded-md overflow-auto text-xs max-h-64 whitespace-pre-wrap">{log}</pre>
      </div>
    </div>
  );
}

