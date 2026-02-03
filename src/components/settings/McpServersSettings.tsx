"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { McpServerConfig } from "@/lib/mcp/McpClient";
import { serverManager } from "@/lib/mcp/ServerManager";
import { useMcpServerStatuses, useMcpStore } from "@/store/mcpStore";
import { normalizeSavedServers, resolveNonConflictingServerName } from "@/lib/mcp/serverNamePolicy";
import { toast, trimToastDescription } from "@/components/ui/sonner";
import { downloadService } from "@/lib/utils/downloadService";
import { detectTauriEnvironment } from "@/lib/utils/environment";
import StorageUtil from "@/lib/storage";
import { cn } from "@/lib/utils";
import { Select, SelectItem, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

import { 
  Plus, 
  Upload, 
  Download, 
  RotateCcw,
  MoreVertical,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Settings
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { McpToolListTip } from '@/components/mcp/McpToolListTip';
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { McpEnvironmentStatus } from "./McpEnvironmentStatus";
import AdvancedMcpSettingsDialog from "./AdvancedMcpSettingsDialog";
import ServerConfigDialog from "./ServerConfigDialog";
import { getAuthorizationConfig } from "@/lib/mcp/authorizationConfig";


type TransportType = "stdio" | "sse" | "http";

type SavedServer = {
  name: string;
  config: McpServerConfig;
  enabled?: boolean; // 新增：是否在聊天中默认可用（全局开关）
};

export function McpServersSettings() {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [editing, setEditing] = useState<SavedServer | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // 按服务器粒度管理加载态，避免一个操作影响全部按钮
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [exportText, setExportText] = useState("");
  const importNumsRef = React.useRef<HTMLPreElement | null>(null);
  const importAreaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [editingJsonMode, setEditingJsonMode] = useState(false);
  const [editingJsonText, setEditingJsonText] = useState("");
  const [editingJsonError, setEditingJsonError] = useState("");
  const [addingJsonText, setAddingJsonText] = useState("");
  
  // 使用zustand store管理MCP状态
  const serverStatuses = useMcpServerStatuses();
  const { setServerStatuses } = useMcpStore();

  // —— 删除确认对话框 ——
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);

  // —— 三点菜单状态管理 ——
  const [openMenuServer, setOpenMenuServer] = useState<string | null>(null);

  // —— 高级设置弹窗 ——
  const [advDialogOpen, setAdvDialogOpen] = useState(false);
  const [maxDepthValue, setMaxDepthValue] = useState<number>(6);
  const [defaultAutoAuth, setDefaultAutoAuth] = useState<boolean>(false);

  const loadAdvanced = useCallback(async () => {
    try {
      const val = await StorageUtil.getItem<number|"infinite">('max_tool_recursion_depth', 6, 'mcp-settings.json');
      setMaxDepthValue(val === 'infinite' ? 20 : (val ?? 6));
      
      const authConfig = await getAuthorizationConfig();
      setDefaultAutoAuth(authConfig.defaultAutoAuthorize);
    } catch {
      setMaxDepthValue(6);
      setDefaultAutoAuth(true);
    }
  }, []);
  useEffect(() => { void loadAdvanced(); }, [loadAdvanced]);

  // —— 服务器配置对话框 ——
  const [serverConfigDialogOpen, setServerConfigDialogOpen] = useState(false);
  const [configServerName, setConfigServerName] = useState<string>('');



  const saveAdvanced = useCallback(async (value: number) => {
    try {
      const toSave: number|"infinite" = value >= 20 ? 'infinite' : value;
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('mcp-settings.json');
      await store.set('max_tool_recursion_depth', toSave);
      await store.save();
    } catch (e) {
      console.error('保存高级设置失败:', e);
    }
  }, []);

  // load/save via plugin-store if available, fallback to memory
  const loadServers = useCallback(async () => {
    try {
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("mcp_servers.json");
      const list = (await store.get<SavedServer[]>("servers")) || [];
      
      // 如果没有配置，记录日志但不自动创建
      if (list.length === 0) {
        console.log('[MCP] 未找到MCP服务配置，请手动配置MCP服务');
      }
      
      // 默认启用 + 保留名冲突自动改名（例如 filesystem → filesystem_external）
      const withEnabled = Array.isArray(list) ? list.map((s) => ({ ...s, enabled: s.enabled !== false })) : [];
      const { list: normalized, renames } = normalizeSavedServers(withEnabled);
      setServers(normalized);

      if (renames.length) {
        // best-effort：写回存储，避免后续逻辑仍读取到冲突名
        try {
          await store.set("servers", normalized);
          await store.save();
        } catch {
          // ignore
        }
        // best-effort：避免旧名字的“已连接”假象（状态与工具缓存清理）
        try {
          for (const r of renames) {
            useMcpStore.getState().setServerStatus(r.from, "disconnected");
            useMcpStore.getState().clearToolsCache(r.from);
          }
        } catch {
          // ignore
        }
        toast.info("已自动规避 MCP 保留名冲突", {
          description: renames.map((r) => `${r.from} → ${r.to}`).join("，"),
        });
      }
    } catch {
      // ignore; use memory default
    }
  }, []);

  const saveServers = useCallback(async (list: SavedServer[]) => {
    setServers(list);
    try {
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("mcp_servers.json");
      await store.set("servers", list);
      await store.save();
    } catch {
      // ignore
    }
  }, []);

  // —— JSON Import/Export ——
  const parseServersFromRaw = useCallback((raw: any): SavedServer[] => {
    const imported: SavedServer[] = [];
    // Format A: Continue/Cursor 风格 { mcpServers: { name: { command, args, url, env } } }
    if (raw && raw.mcpServers && typeof raw.mcpServers === 'object') {
      for (const [name, cfg] of Object.entries<any>(raw.mcpServers)) {
        if (cfg && typeof cfg === 'object') {
          if ((cfg as any).url) {
            const urlStr = String((cfg as any).url);
            const isSse = urlStr.includes('/sse');
            imported.push({ name, config: { type: isSse ? 'sse' : 'http', baseUrl: urlStr, headers: [] } });
          } else {
            const args: string[] = Array.isArray((cfg as any).args) ? (cfg as any).args : [];
            const envPairs: [string,string][] = (cfg as any).env ? Object.entries((cfg as any).env).map(([k,v])=>[String(k), String(v)]) : [];
            imported.push({ name, config: { type: 'stdio', command: (cfg as any).command || 'npx', args, env: envPairs } });
          }
        }
      }
    }
    // Format B1: 通用数组 { servers: [ { name, type, command, args, env, url } ] }
    if (raw && Array.isArray(raw.servers)) {
      for (const item of raw.servers) {
        const name = item.name || 'mcp';
        if (item.type === 'stdio' || (!item.type && (item.command || item.args))) {
          const envObj = item.env || {};
          const envPairs: [string,string][] = Object.entries(envObj).map(([k,v]) => [String(k), String(v)]);
          imported.push({ name, config: { type: 'stdio', command: item.command || 'npx', args: item.args || [], env: envPairs } });
        } else if (item.type === 'sse' || item.type === 'http' || item.url || item.baseUrl) {
          const url = item.url || item.baseUrl;
          const type = item.type ? item.type : (String(url||'').includes('/sse') ? 'sse' : 'http');
          imported.push({ name, config: { type, baseUrl: url, headers: [] } });
        }
      }
    }
    // Format B2: 通用对象 { servers: { name: { type, ... } } }
    if (raw && raw.servers && typeof raw.servers === 'object' && !Array.isArray(raw.servers)) {
      for (const [name, item] of Object.entries<any>(raw.servers)) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'stdio' || (!item.type && (item.command || item.args))) {
          const envObj = item.env || {};
          const envPairs: [string,string][] = Object.entries(envObj).map(([k,v]) => [String(k), String(v)]);
          imported.push({ name, config: { type: 'stdio', command: item.command || 'npx', args: item.args || [], env: envPairs } });
        } else if (item.type === 'sse' || item.type === 'http' || item.url || item.baseUrl) {
          const url = item.url || item.baseUrl;
          const type = item.type ? item.type : (String(url||'').includes('/sse') ? 'sse' : 'http');
          imported.push({ name, config: { type, baseUrl: url, headers: [] } });
        }
      }
    }
    // 统一做一次保留名/重名修正
    const { list: normalized } = normalizeSavedServers(imported);
    return normalized;
  }, []);

  const importFromJson = async () => {
    setError("");
    setImportError("");
    try {
      const raw = JSON.parse(importText);
      const imported: SavedServer[] = parseServersFromRaw(raw);
      if (imported.length === 0) throw new Error('无法识别的 JSON 格式');
      const byName = new Map(servers.map(s => [s.name, s] as const));
      for (const s of imported) byName.set(s.name, { ...s, enabled: true });
      const merged = Array.from(byName.values());
      const { list: next, renames } = normalizeSavedServers(merged);
      await saveServers(next);
      // 再次读取存储，确保不同运行环境（Tauri/浏览器）下列表立即刷新
      await loadServers();
      setImportOpen(false);
      setImportText("");
      toast.success("导入成功", { description: `共 ${imported.length} 条` });
      if (renames.length) {
        toast.info("已自动规避 MCP 保留名/重名", {
          description: renames.map((r) => `${r.from} → ${r.to}`).join("，"),
        });
      }
    } catch (e) {
      setImportError('导入失败: ' + String(e));
    }
  };

  const buildExportJson = () => {
    // 构建符合MCP标准的配置
    const mcpConfig: any = { mcpServers: {} };
    
    for (const s of servers) {
      if (s.config.type === 'stdio') {
        // 过滤掉硬编码的路径参数，只保留包名
        const filteredArgs = (s.config.args || []).filter(arg => {
          // 过滤掉绝对路径和用户目录路径
          return !arg.startsWith('/') && 
                 !arg.startsWith('C:') && 
                 !arg.startsWith('D:') && 
                 !arg.includes('Users/') &&
                 !arg.includes('kamjin') &&
                 !arg.includes('home/');
        });
        
        mcpConfig.mcpServers[s.name] = {
          command: s.config.command || 'npx',
          args: filteredArgs,
          env: {}
        };
      } else if (s.config.type === 'sse' || s.config.type === 'http') {
        mcpConfig.mcpServers[s.name] = {
          url: (s.config as any).baseUrl
        };
      }
    }
    
    // 同时提供兼容格式
    const continueStyle: any = { mcpServers: {} as any };
    for (const s of servers) {
      if (s.config.type === 'stdio') {
        (continueStyle.mcpServers)[s.name] = { 
          command: s.config.command, 
          args: s.config.args 
        };
      } else {
        (continueStyle.mcpServers)[s.name] = { 
          url: (s.config as any).baseUrl 
        };
      }
    }
    
    const generic = {
      servers: servers.map(s => {
        if (s.config.type === 'stdio') {
          const envObj: Record<string,string> = {};
          (s.config.env || []).forEach(([k,v]) => { envObj[k] = v; });
          return { 
            name: s.name, 
            type: 'stdio', 
            command: s.config.command, 
            args: s.config.args, 
            env: envObj 
          };
        }
        return { 
          name: s.name, 
          type: s.config.type, 
          url: (s.config as any).baseUrl 
        };
      })
    };
    
    // 主要导出MCP标准格式，同时提供兼容格式
    setExportText(JSON.stringify({
      // MCP标准格式（主要）
      ...mcpConfig,
      // 兼容格式
      continueStyle,
      generic
    }, null, 2));
  };

  useEffect(() => {
    loadServers();
    // 取消历史状态验证逻辑：状态由 ServerManager.init() 在应用启动时负责
    
    const off = serverManager.on((e) => {
      if (e.type === "SERVER_STATUS") {
        // 状态变化时更新store（store会自动处理本地存储）
        // store 内部已更新，这里无需再调用
      }
      if (e.type === "ERROR") {
        setError(String(e.payload?.error ?? "未知错误"));
      }
    });

    // validateStatus removed（状态一致性由单一来源保证）

    return () => { off(); };
  }, [loadServers, setServerStatuses]);



  // 点击外部关闭三点菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('details')) {
        setOpenMenuServer(null);
      }
    };

    if (openMenuServer) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuServer]);

  const emptyConfig: McpServerConfig = useMemo(() => ({
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    env: [],
  }), []);

  const beginAdd = () => {
    setEditing({ name: "", config: emptyConfig });
    setIsAdding(true);
    setError("");
  };

  const beginEdit = (s: SavedServer) => {
    setEditing(JSON.parse(JSON.stringify(s)));
    setIsAdding(false);
    setError("");
    setEditingJsonMode(false);
    setEditingJsonText("");
    setEditingJsonError("");
  };

  const cancelEdit = () => setEditing(null);

  const persistEdit = async () => {
    if (!editing) return;
    const desiredName = editing.name.trim();
    if (!desiredName) { setError("请输入名称"); return; }

    const existingNames = servers
      .map((s) => s.name)
      .filter((n) => n && n !== desiredName);
    const { name } = resolveNonConflictingServerName({ desiredName, existingNames });
    if (name !== desiredName) {
      setEditing({ ...editing, name });
      toast.info("已自动规避 MCP 保留名/重名", { description: `${desiredName} → ${name}` });
    }

    const exists = servers.find((s) => s.name === name);
    let next = servers.slice();
    if (exists) {
      next = next.map((s) => (s.name === name ? { ...editing, name } : s));
    } else {
      next.unshift({ ...editing, name });
    }
    await saveServers(next);
    setEditing(null);
    setIsAdding(false);
    // 新增或更新后自动连接一次（降低心智负担）
    try {
      const s = next.find(x=>x.name===name);
      if (s) {
        // 首次配置为 npx/stdio 时，提示可能需要下载
        if (s.config.type === 'stdio' && (s.config.command||'') === 'npx') {
          toast.info('正在连接（可能需要首次下载）', { description: 'npx 将自动下载 MCP 服务器依赖，这可能需要 1-3 分钟，请耐心等待…' });
        }
        await serverManager.startServer(s.name, s.config);
        setError("");
        // 状态由 ServerManager 事件更新
        toast.success("已保存并连接", { description: `${s.name} · 连接成功` });
      }
    } catch (e) {
      setError(String(e));
      // 失败时状态由 ServerManager 更新
      toast.error("保存成功但连接失败", { description: trimToastDescription(e) });
    }
  };

  const remove = async (name: string) => {
    setServerToDelete(name);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!serverToDelete) return;
    const list = servers.filter((s) => s.name !== serverToDelete);
    await saveServers(list);
    setDeleteDialogOpen(false);
    setServerToDelete(null);
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setServerToDelete(null);
  };

  const connect = async (s: SavedServer) => {
    setLoadingMap(prev => ({ ...prev, [s.name]: true }));
    setError("");
    // 状态由 ServerManager.updateStatus 控制
    try {
      if (s.config.type === 'stdio' && (s.config.command||'') === 'npx') {
        toast.info('正在连接（可能需要首次下载）', { description: 'npx 将自动下载 MCP 服务器依赖，这可能需要 1-3 分钟，请耐心等待…' });
      }
      await serverManager.startServer(s.name, s.config);
      setError("");
      toast.success("连接成功", { description: `${s.name} · 连接成功` });
    } catch (e) {
      setError(String(e));
      // 失败时状态由 ServerManager 更新
      toast.error("连接失败", { description: trimToastDescription(e) });
    }
    setLoadingMap(prev => ({ ...prev, [s.name]: false }));
  };

  const disconnect = async (name: string) => {
    setLoadingMap(prev => ({ ...prev, [name]: true }));
    setError("");
    try { await serverManager.stopServer(name); setError(""); toast.success("已断开", { description: name }); }
    catch (e) { setError(String(e)); toast.error("断开失败", { description: trimToastDescription(e) }); }
    // 状态和工具缓存清理由 ServerManager.stopServer 处理
    setLoadingMap(prev => ({ ...prev, [name]: false }));
  };

  const renderEditor = () => {
    if (!editing) return null;
    const { name, config } = editing;
    const type = config.type as TransportType;
    const setConfig = (next: Partial<McpServerConfig>) => setEditing({ name, config: { ...config, ...next } as McpServerConfig });
    const buildEditingJson = () => {
      const obj: any = { name, type };
      if (type === 'stdio') {
        const envObj: Record<string,string> = {};
        (config.env||[]).forEach(([k,v])=>{ envObj[k]=v; });
        obj.command = config.command; obj.args = config.args; if (Object.keys(envObj).length) obj.env = envObj;
      } else {
        obj.baseUrl = (config as any).baseUrl || (config as any).url;
        if ((config as any).headers) {
          const h: Record<string,string> = {}; (config as any).headers.forEach(([k,v]: any)=>{ h[k]=v; }); obj.headers = h;
        }
      }
      setEditingJsonText(JSON.stringify(obj, null, 2));
      setEditingJsonError("");
    };
    const applyEditingJson = () => {
      try {
        const raw = JSON.parse(editingJsonText || "{}");
        if (raw.name) (editing as any).name = String(raw.name);
        if (raw.type === 'stdio' || raw.command || raw.args) {
          const envPairs: [string,string][] = raw.env ? Object.entries(raw.env).map(([k,v])=>[String(k), String(v)]) : (config.env||[]);
          setEditing({ name: raw.name || name, config: { type: 'stdio', command: raw.command || config.command, args: raw.args || config.args, env: envPairs } as any });
        } else if (raw.type === 'sse' || raw.type === 'http' || raw.baseUrl || raw.url) {
          const url = raw.baseUrl || raw.url || (config as any).baseUrl;
          setEditing({ name: raw.name || name, config: { type: raw.type || type, baseUrl: url, headers: [] } as any });
        }
        setEditingJsonError("");
      } catch (e) {
        setEditingJsonError('JSON 解析失败: ' + String(e));
      }
    };
    const isCmdWrap = config.type === 'stdio' && config.command === 'cmd' && Array.isArray(config.args) && config.args[0] === '/c';
    const toggleCmdWrap = () => {
      if (config.type !== 'stdio') return;
      if (isCmdWrap) {
        // unwrap: cmd /c <cmd> <args...>
        const innerCmd = (config.args||[])[1] || 'npx';
        const innerArgs = (config.args||[]).slice(2);
        setConfig({ command: innerCmd as any, args: innerArgs as any });
      } else {
        const innerCmd = config.command || 'npx';
        const innerArgs = (config.args||[]);
        setConfig({ command: 'cmd' as any, args: ['/c', innerCmd, ...innerArgs] as any });
      }
    };
    const testConnect = async () => {
      try {
        await serverManager.startServer(name || 'mcp-test', config);
        const tools = await serverManager.listTools(name || 'mcp-test').catch(()=>[]);
        setError("");
        toast.success("测试连接成功", { description: `Tools: ${Array.isArray(tools)?tools.length:0}` });
      } catch (e) {
        setError(String(e));
        toast.error("测试连接失败", { description: trimToastDescription(e) });
      }
    };
    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4 bg-white dark:bg-gray-900 shadow-sm">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-50 dark:border-slate-700 pb-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{isAdding ? '新增服务器' : '编辑服务器'}</h3>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 text-sm" 
                  onClick={()=>{ if (!editingJsonMode) buildEditingJson(); setEditingJsonMode(!editingJsonMode); }}
                >
                  {editingJsonMode ? '切换到表单' : '切换到 JSON'}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{editingJsonMode ? '切换到表单编辑模式' : '切换到 JSON 编辑模式'}</p>
              </TooltipContent>
            </Tooltip>
            {/* 统一右上角关闭样式 */}
            <button
              onClick={cancelEdit}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
              aria-label="关闭"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 表单内容 */}
        {!editingJsonMode ? (
          <div className="space-y-4">
            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">名称</label>
                <input 
                  className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200 text-sm bg-white dark:bg-slate-800/70 text-slate-900 dark:text-slate-100" 
                  value={name} 
                  onChange={(e)=>setEditing({ name: e.target.value, config })} 
                  placeholder="输入服务器名称"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">传输类型</label>
                <Select
                
                  value={type}
                  onValueChange={(value) => setEditing({ name, config: { ...config, type: value as TransportType } })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择传输类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">stdio</SelectItem>
                    <SelectItem value="sse">sse</SelectItem>
                    <SelectItem value="http">http</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 配置详情 */}
            {type === "stdio" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">命令</label>
                    <input 
                      className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200 text-sm bg-white dark:bg-slate-800/70 text-slate-900 dark:text-slate-100" 
                      value={config.command || ""} 
                      onChange={(e)=>setConfig({ command: e.target.value })} 
                      placeholder="例如: npx"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">参数</label>
                    <input 
                      className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200 text-sm bg-white dark:bg-slate-800/70 text-slate-900 dark:text-slate-100" 
                      placeholder="以空格分隔" 
                      value={(config.args||[]).join(" ")} 
                      onChange={(e)=>setConfig({ args: e.target.value.trim() ? e.target.value.split(/\s+/g) : [] })} 
                    />
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">环境变量</label>
                  <input 
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200 text-sm bg-white dark:bg-slate-800/70 text-slate-900 dark:text-slate-100" 
                    placeholder="KEY=VALUE,KEY2=VALUE2" 
                    value={(config.env||[]).map(([k,v])=>`${k}=${v}`).join(", ")} 
                    onChange={(e)=>{
                      const items = e.target.value.split(/,|\n/g).map(s=>s.trim()).filter(Boolean);
                      const pairs: [string,string][] = [];
                      for (const it of items){ const i = it.indexOf("="); if(i>0) pairs.push([it.slice(0,i).trim(), it.slice(i+1).trim()]); }
                      setConfig({ env: pairs });
                    }} 
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    checked={isCmdWrap} 
                    onChange={toggleCmdWrap}
                    className="w-4 h-4 text-blue-600 border-gray-300 dark:border-slate-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">Windows 兼容（cmd /c 包装）</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Base URL</label>
                  <input 
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200 text-sm bg-white dark:bg-slate-800/70 text-slate-900 dark:text-slate-100" 
                    placeholder="http(s)://..." 
                    value={config.baseUrl || ""} 
                    onChange={(e)=>setConfig({ baseUrl: e.target.value })} 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">请求头</label>
                  <input 
                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500/40 focus:border-transparent transition-all duration-200 text-sm bg-white dark:bg-slate-800/70 text-slate-900 dark:text-slate-100" 
                    placeholder="Authorization=Bearer xxx, X-Api-Key=xxx" 
                    value={(config.headers||[]).map(([k,v])=>`${k}=${v}`).join(", ")} 
                    onChange={(e)=>{
                      const items = e.target.value.split(/,|\n/g).map(s=>s.trim()).filter(Boolean);
                      const pairs: [string,string][] = [];
                      for (const it of items){ const i = it.indexOf("="); if(i>0) pairs.push([it.slice(0,i).trim(), it.slice(i+1).trim()]); }
                      setConfig({ headers: pairs });
                    }} 
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {!isAdding ? (
              <>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  JSON 编辑（可直接粘贴配置，支持 name/type/command/args/env 或 baseUrl/headers）
                </div>
                <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="flex">
                    <pre ref={importNumsRef} className="select-none text-right text-xs leading-6 px-1.5 py-2 w-8 bg-gray-50 dark:bg-gray-800 text-gray-400 overflow-hidden" style={{maxHeight: 200}}>
                      {editingJsonText.split('\n').map((_,i)=>String(i+1)).join('\n')}
                    </pre>
                    <textarea 
                      value={editingJsonText} 
                      onChange={(e)=>setEditingJsonText(e.target.value)} 
                      onScroll={(e)=>{ if(importNumsRef.current){ importNumsRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; } }} 
                      className="flex-1 font-mono text-sm p-2 leading-6 bg-white dark:bg-gray-900 outline-none resize-none" 
                      style={{maxHeight:200}} 
                      placeholder="在此粘贴 JSON 配置..."
                    />
                  </div>
                </div>
                {editingJsonError && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                    {editingJsonError}
                  </div>
                )}
                <div className="flex justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button 
                        className="px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 text-sm" 
                        onClick={applyEditingJson}
                      >
                        应用到表单
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>将 JSON 配置应用到表单中</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  快速新增：粘贴整段 MCP 配置，自动识别 {`{ mcpServers: { name: { command,args,env } | { url } } }`}、或通用 {`servers`} 数组/对象。
                </div>
                <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="flex">
                    <pre className="select-none text-right text-xs leading-6 px-1.5 py-2 w-8 bg-gray-50 dark:bg-gray-800 text-gray-400 overflow-hidden" style={{height: 280}}>
                      {addingJsonText.split('\n').map((_,i)=>String(i+1)).join('\n')}
                    </pre>
                  <textarea 
                    value={addingJsonText} 
                    onChange={(e)=>setAddingJsonText(e.target.value)} 
                    className="flex-1 font-mono text-sm p-3 leading-6 bg-white dark:bg-gray-900 outline-none resize-y" 
                    style={{height: 280}} 
                    placeholder={`直接粘贴 JSON 配置并点击“解析并创建”。\n\n示例：\n{\n  \"mcpServers\": {\n    \"filesystem\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem\", \"/path/to/allowed/files\"]\n    },\n    \"git\": {\n      \"command\": \"uvx\",\n      \"args\": [\"mcp-server-git\", \"--repository\", \"path/to/git/repo\"]\n    },\n    \"github\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-github\"],\n      \"env\": { \"GITHUB_PERSONAL_ACCESS_TOKEN\": \"<YOUR_TOKEN>\" }\n    },\n    \"postgres\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-postgres\", \"postgresql://localhost/mydb\"]\n    }\n  }\n}`}
                  />
                  </div>
                </div>
                {editingJsonError && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                    {editingJsonError}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <button 
                    className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" 
                    onClick={()=>{ setAddingJsonText(""); setEditingJsonError(""); }}
                  >
                    清空
                  </button>
                  <button 
                    className="px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 text-sm" 
                    onClick={async()=>{
                      try {
                        const raw = JSON.parse(addingJsonText||"{}");
                        const imported = parseServersFromRaw(raw);
                        if (imported.length === 0) throw new Error('无法识别的 JSON 格式');
                        if (imported.length === 1) {
                          // 单条则应用到表单，便于确认后保存
                          const s = imported[0];
                          setEditing({ name: s.name, config: s.config });
                          setEditingJsonMode(false);
                          setIsAdding(false);
                          toast.success('已解析为单个服务器', { description: s.name });
                        } else {
                          const byName = new Map(servers.map(s => [s.name, s] as const));
                          for (const s of imported) byName.set(s.name, { ...s, enabled: true });
                          const next = Array.from(byName.values());
                          await saveServers(next);
                          setEditing(null);
                          setIsAdding(false);
                          toast.success('已批量新增', { description: `共 ${imported.length} 条` });
                        }
                        setAddingJsonText("");
                        setEditingJsonError("");
                      } catch (e) {
                        setEditingJsonError('JSON 解析失败: ' + String(e));
                      }
                    }}
                  >
                    解析并创建
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {/* 底部操作：仅在非“新增+JSON”模式下显示，避免与“解析并创建”冲突 */}
        {!(
          isAdding && editingJsonMode
        ) && (
        <div className="flex gap-2 pt-3 border-t border-gray-50 dark:border-slate-700 justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                className="px-4 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-all duration-200 shadow-sm hover:shadow-md text-sm" 
                onClick={persistEdit}
              >
                保存
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>保存服务器配置</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button 
                className="px-4 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 text-sm" 
                onClick={testConnect}
              >
                测试连接
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>测试服务器连接</p>
            </TooltipContent>
          </Tooltip>
        </div>
        )}
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="space-y-3 p-4">
        {/* 环境状态检查 */}
        <McpEnvironmentStatus />

        {/* 紧凑工具栏 */}
        <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-200/50 dark:border-slate-700/30">
          {/* 左侧操作按钮组 */}
          <div className="flex gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                  onClick={beginAdd}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">新增服务器</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                  onClick={()=>{ setImportOpen(true); setImportText(""); }}
                >
                  <Upload className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">导入配置</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  className="w-7 h-7 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                  onClick={async()=>{
                    try {
                      // 参考 AdvancedSettings 的下载服务，兼容 macOS/Tauri
                      const data = { servers };
                      const json = JSON.stringify(data, null, 2);
                      const fileName = `mcp_servers-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
                      const ok = await downloadService.downloadJson(fileName, data);
                      if (!ok) {
                        // 回退方案（浏览器场景）
                        const isTauri = await detectTauriEnvironment();
                        if (!isTauri) {
                          const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = fileName;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        }
                      }
                      toast.success('已导出 MCP 配置');
                    } catch (e) {
                      toast.error('导出失败', { description: trimToastDescription(e) });
                    }
                  }}
                >
                  <Download className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">导出配置</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* 右侧齿轮按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-7 h-7 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                onClick={() => setAdvDialogOpen(true)}
              >
                <Settings className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent><p className="text-xs">高级设置</p></TooltipContent>
          </Tooltip>
        </div>

        {renderEditor()}

      {importOpen && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-6 space-y-4 bg-white dark:bg-gray-900 shadow-lg backdrop-blur-sm">
          {/* 头部区域 */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                导入 MCP 配置
              </h3>
            </div>
            <button
              onClick={() => { setImportOpen(false); setImportText(""); }}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 格式说明 */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            支持多种 JSON 格式，自动识别并转换
          </div>
          
          {/* 输入区域 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">JSON 配置</label>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{importText.split('\n').length} 行</span>
                <span>•</span>
                <span>{importText.length} 字符</span>
              </div>
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm">
              <div className="flex">
                <pre ref={importNumsRef} className="select-none text-right text-xs leading-6 px-3 py-3 w-12 bg-gray-50 dark:bg-gray-800 text-gray-400 overflow-hidden border-r border-gray-200 dark:border-gray-700">
                  {importText.split('\n').map((_,i)=>String(i+1)).join('\n')}
                </pre>
                <textarea 
                  ref={importAreaRef} 
                  onScroll={(e)=>{ if(importNumsRef.current){ importNumsRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; } }} 
                  className="flex-1 font-mono text-sm p-3 leading-6 bg-white dark:bg-gray-900 outline-none resize-none focus:ring-0 focus:border-transparent" 
                  value={importText} 
                  onChange={(e)=>setImportText(e.target.value)}
                  placeholder={`格式一:
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}

格式二:
{
  "servers": [
    {
      "name": "filesystem",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  ]
}`}
                  style={{height: '180px'}}
                />
              </div>
            </div>
          </div>
          
          {/* 错误提示 */}
          {importError && (
            <div className="flex items-start gap-2 p-3 text-sm text-red-700 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{importError}</span>
            </div>
          )}
          
          {/* 操作按钮 */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
            <div className="text-xs text-gray-500">
              {importText.trim() ? '准备导入配置' : '请粘贴 JSON 配置'}
            </div>
            <div className="flex gap-2">
              {/* 统一右上角关闭，不再保留取消 */}
              <button 
                className={`px-6 py-2 rounded-lg text-white transition-all duration-200 text-sm font-medium shadow-sm hover:shadow-md ${
                  importText.trim() 
                    ? 'bg-blue-600 hover:bg-blue-700' 
                    : 'bg-gray-400 cursor-not-allowed'
                }`}
                onClick={importFromJson}
                disabled={!importText.trim()}
              >
                导入配置
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {servers.length === 0 && <div className="text-[11px] text-slate-400 py-4 text-center">尚未添加服务器</div>}
        {servers.map((s) => {
          const st = serverStatuses[s.name] || "disconnected";
          const toolsCache = useMcpStore.getState().toolsCache[s.name];
          const toolCount = st === 'connected' ? (toolsCache?.tools?.length || 0) : 0;
          const tools = st === 'connected' ? (toolsCache?.tools || []) : [];
          
          return (
            <div key={s.name} className="border border-slate-200/60 dark:border-slate-700/40 rounded-lg p-3 bg-white/80 dark:bg-slate-900/60 hover:border-slate-300/60 dark:hover:border-slate-600/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <span>{s.name}</span>
                  <span className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded",
                    st === 'connected' 
                      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                      : st === 'connecting' 
                        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                        : st === 'error' 
                          ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                          : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800'
                  )}>
                    {st === 'connected' ? (
                      <CheckCircle className="w-2.5 h-2.5" />
                    ) : st === 'connecting' ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : st === 'error' ? (
                      <XCircle className="w-2.5 h-2.5" />
                    ) : (
                      <XCircle className="w-2.5 h-2.5" />
                    )}
                    {st === 'connected' ? '已连接' : 
                     st === 'connecting' ? '连接中' : 
                     st === 'error' ? '连接失败' : '未连接'}
                  </span>
                  {toolCount > 0 && (
                    <McpToolListTip toolCount={toolCount} tools={tools as any}>
                      <span className="text-[10px] text-slate-400 cursor-help hover:text-slate-600 dark:hover:text-slate-300">
                        {toolCount} 工具
                      </span>
                    </McpToolListTip>
                  )}
                </div>
                {/* 右侧：操作按钮 */}
                <div className="flex items-center gap-1">
                  <Checkbox
                    checked={s.enabled !== false}
                    onCheckedChange={(checked) => {
                      const next = servers.map(x => x.name === s.name ? { ...x, enabled: !!checked } : x);
                      saveServers(next);
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <button 
                    className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors disabled:opacity-50"
                    disabled={!!loadingMap[s.name]} 
                    onClick={()=>connect(s)}
                    title="刷新连接"
                  >
                    {loadingMap[s.name] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  </button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="z-50 w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 text-xs" sideOffset={4} align="end">
                        <DropdownMenu.Item onSelect={() => beginEdit(s)} className="flex items-center gap-2 px-3 py-1.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer text-slate-600 dark:text-slate-300">
                          <Edit className="w-3.5 h-3.5" /> 编辑
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => { setConfigServerName(s.name); setServerConfigDialogOpen(true); }} className="flex items-center gap-2 px-3 py-1.5 outline-none hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer text-slate-600 dark:text-slate-300">
                          <Settings className="w-3.5 h-3.5" /> 配置
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
                        <DropdownMenu.Item onSelect={() => remove(s.name)} className="flex items-center gap-2 px-3 py-1.5 text-red-500 outline-none hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" /> 删除
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
              {/* 命令/URL */}
              <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">
                {s.config.type === 'stdio' ? `${s.config.command} ${(s.config.args||[]).join(' ')}` : `${s.config.type} ${s.config.baseUrl}`}
              </div>
            </div>
          );
        })}
      </div>
            {exportText && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-xl p-6 space-y-4 bg-white dark:bg-gray-900 shadow-sm">
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">导出 JSON</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">可复制保存为 mcp.json</p>
          </div>
          
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">配置内容</label>
            <textarea 
              className="w-full h-40 border border-gray-200 dark:border-slate-700 rounded-lg p-3 font-mono text-sm bg-gray-50 dark:bg-slate-800 resize-none" 
              value={exportText} 
              readOnly 
            />
          </div>
        </div>
      )}

       {/* 删除确认对话框 */}
       <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
         <AlertDialogContent>
           {/* 右上角关闭按钮 */}
           <button
             onClick={() => setDeleteDialogOpen(false)}
             className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 cursor-pointer"
             aria-label="关闭"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
             </svg>
           </button>
           
           <AlertDialogHeader className="pr-8">
             <AlertDialogTitle>确认删除</AlertDialogTitle>
             <AlertDialogDescription>
               确定要删除服务器 <span className="font-medium">{serverToDelete}</span> 吗？此操作无法撤销。
             </AlertDialogDescription>
           </AlertDialogHeader>
           <AlertDialogFooter>
             <AlertDialogCancel onClick={cancelDelete}>取消</AlertDialogCancel>
             <AlertDialogAction onClick={confirmDelete}>
               删除
             </AlertDialogAction>
           </AlertDialogFooter>
         </AlertDialogContent>
       </AlertDialog>
      {/* 高级设置弹窗组件 */}
      <AdvancedMcpSettingsDialog
          open={advDialogOpen}
          onOpenChange={setAdvDialogOpen}
          maxDepth={maxDepthValue}
          onSave={saveAdvanced}
      />
      
      {/* 服务器配置对话框 */}
      <ServerConfigDialog
          open={serverConfigDialogOpen}
          onOpenChange={setServerConfigDialogOpen}
          serverName={configServerName}
          globalDefaults={{
            autoAuthorize: defaultAutoAuth,
            maxRecursionDepth: maxDepthValue,
          }}
      />
      </div>
    </TooltipProvider>
  );
}

