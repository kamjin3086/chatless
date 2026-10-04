"use client";

import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, ChevronRight, ChevronDown, Plus, Settings, Search, MoreHorizontal, 
  Send, Paperclip, Check, X, Loader2, Copy, RotateCcw, Moon, Sun,
  MessageSquare, Star, Trash2, Archive, Download, Share2, Edit3, Pin,
  Globe, Zap, Hash, Clock, Filter, SortAsc, Upload, FileText, Tag,
  Keyboard, Command, Terminal, FolderOpen, File, ChevronUp, AlertCircle,
  CheckCircle, Info, Bot, Database, Shield, Plug, SlidersHorizontal
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案1: 极简终端风格 (Terminal Minimal) - 完整版
 * 
 * 设计理念：
 * - 受终端/IDE启发，高信息密度但不杂乱
 * - 单色调（灰度为主），通过缩进和符号区分层级
 * - 零边框、零卡片，纯文本流式布局
 * - 等宽字体增强技术感和可读性
 * - 功能通过前缀符号和缩进暗示
 */

type Theme = 'light' | 'dark';
type View = 'chat' | 'settings' | 'prompts';

// Mock 数据
const mockConversations = [
  { id: '1', title: '新对话 15:34', time: '5分钟前', isActive: true, pinned: true },
  { id: '2', title: 'API设计讨论', time: '14分钟前', pinned: true },
  { id: '3', title: '代码审查反馈', time: '1小时前', pinned: false },
  { id: '4', title: '项目规划会议', time: '3小时前', pinned: false },
  { id: '5', title: '技术选型分析', time: '昨天', pinned: false },
  { id: '6', title: 'Bug修复记录', time: '昨天', pinned: false },
];

const mockMessages = [
  {
    id: '1',
    role: 'user' as const,
    content: '读取我的桌面，列出其中所有的文档名',
    time: '15:34:22',
  },
  {
    id: '2',
    role: 'assistant' as const,
    content: '我将为您列出桌面上的所有文档。首先，让我检查一下桌面目录的内容。',
    time: '15:34:23',
    toolCalls: [
      { id: 't1', name: 'fs.list_directory', args: 'C:/Users/Desktop', status: 'success' as 'success' | 'error' | 'running', duration: '312ms', output: '找到 11 个项目' },
      { id: 't2', name: 'fs.filter', args: '*.lnk, *.doc*', status: 'success' as 'success' | 'error' | 'running', duration: '45ms', output: '匹配 8 个文件' },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `扫描完成。您的桌面包含以下文档和快捷方式：

[目录]
  项目文档/
  临时文件/
  截图/

[文件]
  Chatless.lnk
  chatlog.exe - 快捷方式.lnk
  Cherry Studio.lnk
  Clash Verge.lnk
  Cursor.lnk
  DBeaver.lnk
  Visual Studio Code.lnk
  Notion.lnk

统计: 3 个目录, 8 个文件`,
    time: '15:34:25',
  },
];

const mockPrompts = [
  { id: '1', name: '代码审查', shortcut: 'review', tags: ['编程', '审查'], uses: 42, favorite: true, content: '请审查以下代码，指出潜在问题...' },
  { id: '2', name: '文档翻译', shortcut: 'trans', tags: ['翻译'], uses: 28, favorite: true, content: '将以下内容翻译成中文...' },
  { id: '3', name: '需求分析', shortcut: 'req', tags: ['产品'], uses: 15, favorite: false, content: '分析以下需求，给出技术方案...' },
  { id: '4', name: 'Bug报告', shortcut: 'bug', tags: ['编程', '测试'], uses: 33, favorite: false, content: '根据以下信息生成Bug报告...' },
  { id: '5', name: '会议纪要', shortcut: 'meeting', tags: ['办公'], uses: 21, favorite: false, content: '整理以下会议内容为纪要...' },
];

const settingsTabs = [
  { id: 'general', name: '常规', icon: SlidersHorizontal },
  { id: 'models', name: 'AI模型', icon: Bot },
  { id: 'knowledge', name: '知识库', icon: Database },
  { id: 'mcp', name: 'MCP服务器', icon: Plug },
  { id: 'security', name: '安全', icon: Shield },
  { id: 'advanced', name: '高级', icon: Settings },
];

// ==================== 聊天视图组件 ====================

function Sidebar({ 
  theme, 
  conversations, 
  activeId, 
  onSelect,
  onViewChange
}: { 
  theme: Theme;
  conversations: typeof mockConversations;
  activeId: string;
  onSelect: (id: string) => void;
  onViewChange: (view: View) => void;
}) {
  const isDark = theme === 'dark';
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'pinned'>('all');
  
  const pinnedConvs = conversations.filter(c => c.pinned);
  const recentConvs = conversations.filter(c => !c.pinned);
  const filteredConvs = filterType === 'pinned' ? pinnedConvs : conversations;
  
  return (
    <>
      <div className={cn(
        "w-64 h-full flex flex-col border-r font-mono text-xs",
        isDark ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"
      )}>
        {/* 头部 */}
        <div className={cn(
          "p-3 border-b",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <div className="flex items-center justify-between mb-2">
            <span className={cn("uppercase tracking-wider", isDark ? "text-slate-500" : "text-slate-500")}>
              conversations
            </span>
            <button className={cn(
              "p-1 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
            )}>
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          
          {/* 搜索框 */}
          <div className="relative">
            <span className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2",
              isDark ? "text-slate-600" : "text-slate-400"
            )}>$</span>
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="grep..."
              className={cn(
                "w-full bg-transparent pl-4 py-1 outline-none",
                isDark ? "text-slate-300 placeholder:text-slate-600" : "text-slate-700 placeholder:text-slate-400"
              )}
            />
          </div>
          
          {/* 筛选 */}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => setFilterType('all')}
              className={cn(
                "px-2 py-0.5 rounded-md transition-colors",
                filterType === 'all'
                  ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
                  : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
              )}
            >
              all
            </button>
            <button
              onClick={() => setFilterType('pinned')}
              className={cn(
                "px-2 py-0.5 rounded-md transition-colors",
                filterType === 'pinned'
                  ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
                  : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
              )}
            >
              pinned ({pinnedConvs.length})
            </button>
          </div>
        </div>
        
        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto py-1">
          {filterType === 'all' && pinnedConvs.length > 0 && (
            <div className="mb-2">
              <div className={cn(
                "px-3 py-1 text-[10px] uppercase tracking-wider",
                isDark ? "text-slate-600" : "text-slate-400"
              )}>
                # pinned
              </div>
              {pinnedConvs.map(conv => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={activeId === conv.id}
                  theme={theme}
                  onSelect={() => onSelect(conv.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
                  }}
                />
              ))}
            </div>
          )}
          
          {filterType === 'all' && (
            <div>
              <div className={cn(
                "px-3 py-1 text-[10px] uppercase tracking-wider",
                isDark ? "text-slate-600" : "text-slate-400"
              )}>
                # recent
              </div>
              {recentConvs.map(conv => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={activeId === conv.id}
                  theme={theme}
                  onSelect={() => onSelect(conv.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
                  }}
                />
              ))}
            </div>
          )}
          
          {filterType === 'pinned' && filteredConvs.map(conv => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={activeId === conv.id}
              theme={theme}
              onSelect={() => onSelect(conv.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
              }}
            />
          ))}
        </div>
        
        {/* 底部导航 */}
        <div className={cn(
          "p-2 border-t space-y-1",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <button 
            onClick={() => onViewChange('prompts')}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left",
              isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>prompts</span>
          </button>
          <button 
            onClick={() => onViewChange('settings')}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left",
              isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>settings</span>
          </button>
        </div>
      </div>
      
      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          theme={theme}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

function ConversationItem({ 
  conv, 
  isActive, 
  theme, 
  onSelect,
  onContextMenu
}: { 
  conv: typeof mockConversations[0];
  isActive: boolean;
  theme: Theme;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const isDark = theme === 'dark';
  
  return (
    <div
      className={cn(
        "px-3 py-1.5 cursor-pointer transition-colors",
        isActive
          ? isDark ? "bg-slate-800/50 text-slate-200" : "bg-slate-200 text-slate-900"
          : isDark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-900/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center gap-2">
        <span className={isDark ? "text-slate-600" : "text-slate-400"}>{isActive ? '›' : ' '}</span>
        {conv.pinned && <Pin className="w-2.5 h-2.5 text-amber-500" />}
        <span className="truncate flex-1">{conv.title}</span>
      </div>
      <div className={cn(
        "text-[10px] ml-4 mt-0.5",
        isDark ? "text-slate-600" : "text-slate-400"
      )}>
        {conv.time}
      </div>
    </div>
  );
}

function ContextMenu({ x, y, theme, onClose }: { 
  x: number; 
  y: number; 
  theme: Theme;
  onClose: () => void;
}) {
  const isDark = theme === 'dark';
  
  const items = [
    { icon: Pin, label: 'pin/unpin', shortcut: 'p' },
    { icon: Edit3, label: 'rename', shortcut: 'r' },
    { icon: Star, label: 'favorite', shortcut: 'f' },
    { type: 'divider' as const },
    { icon: Share2, label: 'share', shortcut: null },
    { icon: Download, label: 'export', shortcut: 'e' },
    { type: 'divider' as const },
    { icon: Archive, label: 'archive', shortcut: null },
    { icon: Trash2, label: 'delete', shortcut: 'd', danger: true },
  ];
  
  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className={cn(
          "fixed z-50 w-44 py-1 font-mono text-xs border shadow-lg",
          isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
        )}
        style={{ left: x, top: y }}
      >
        {items.map((item, i) => (
          item.type === 'divider' ? (
            <div key={i} className={cn("my-1 border-t", isDark ? "border-slate-800" : "border-slate-100")} />
          ) : (
            <button
              key={i}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 transition-colors text-left",
                item.danger
                  ? isDark ? "text-red-400 hover:bg-red-900/30" : "text-red-600 hover:bg-red-50"
                  : isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-50"
              )}
              onClick={onClose}
            >
              <item.icon className="w-3.5 h-3.5" />
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className={isDark ? "text-slate-600" : "text-slate-400"}>
                  {item.shortcut}
                </span>
              )}
            </button>
          )
        ))}
      </div>
    </>
  );
}

function ToolCallBlock({ 
  calls, 
  theme 
}: { 
  calls: typeof mockMessages[1]['toolCalls'];
  theme: Theme;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDark = theme === 'dark';
  
  if (!calls || calls.length === 0) return null;
  
  return (
    <div className="mb-2 font-mono text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-1.5 py-0.5 transition-colors",
          isDark ? "text-slate-500 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
        )}
      >
        <ChevronRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
        <span>[{calls.length} tool calls]</span>
        <span className={isDark ? "text-slate-600" : "text-slate-400"}>
          {calls.reduce((acc, c) => acc + parseInt(c.duration || '0'), 0)}ms
        </span>
      </button>
      
      {expanded && (
        <div className={cn(
          "ml-4 pl-2 border-l",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          {calls.map((call) => (
            <div key={call.id} className="py-1">
              <div className="flex items-center gap-2">
                {call.status === 'success' && <Check className="w-3 h-3 text-emerald-500" />}
                {call.status === 'error' && <X className="w-3 h-3 text-red-500" />}
                {call.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                <span className={isDark ? "text-cyan-400" : "text-cyan-600"}>{call.name}</span>
                <span className={isDark ? "text-slate-600" : "text-slate-400"}>→</span>
                <span className={isDark ? "text-slate-400" : "text-slate-600"}>{call.args}</span>
                <span className={cn("ml-auto", isDark ? "text-slate-600" : "text-slate-400")}>{call.duration}</span>
              </div>
              {call.output && (
                <div className={cn("ml-5 mt-0.5", isDark ? "text-slate-500" : "text-slate-500")}>
                  └─ {call.output}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Message({ message, theme }: { message: typeof mockMessages[0]; theme: Theme }) {
  const isUser = message.role === 'user';
  const isDark = theme === 'dark';
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div 
      className={cn("py-3 font-mono text-xs", isUser && "border-l-2 border-slate-700 dark:border-slate-600 pl-3")}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 消息头 */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn(
          "text-[10px] uppercase tracking-wider",
          isUser 
            ? isDark ? "text-slate-400" : "text-slate-500"
            : isDark ? "text-emerald-500" : "text-emerald-600"
        )}>
          {isUser ? '› user' : '› assistant'}
        </span>
        <span className={isDark ? "text-slate-700" : "text-slate-400"}>{message.time}</span>
        
        {/* 操作按钮 */}
        <div className={cn(
          "flex items-center gap-1 ml-auto transition-opacity",
          showActions ? "opacity-100" : "opacity-0"
        )}>
          <button 
            onClick={handleCopy}
            className={cn(
              "p-1 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-600" : "hover:bg-slate-200 text-slate-400"
            )}
            title="copy"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
          {!isUser && (
            <button 
              className={cn(
                "p-1 rounded-md transition-colors",
                isDark ? "hover:bg-slate-800 text-slate-600" : "hover:bg-slate-200 text-slate-400"
              )}
              title="retry"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      
      {/* 工具调用 */}
      {'toolCalls' in message && <ToolCallBlock calls={message.toolCalls} theme={theme} />}
      
      {/* 消息内容 */}
      <div className={cn(
        "text-sm leading-relaxed whitespace-pre-wrap",
        isUser 
          ? isDark ? "text-slate-300" : "text-slate-700"
          : isDark ? "text-slate-400" : "text-slate-600"
      )}>
        {message.content}
      </div>
    </div>
  );
}

function InputArea({ theme }: { theme: Theme }) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<'chat' | 'agent'>('agent');
  const [showMcp, setShowMcp] = useState(false);
  const isDark = theme === 'dark';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);
  
  return (
    <div className={cn(
      "border-t p-3 font-mono text-xs",
      isDark ? "border-slate-800" : "border-slate-200"
    )}>
      {/* 模式选择 */}
      <div className="flex items-center gap-2 mb-2">
        <span className={isDark ? "text-slate-600" : "text-slate-400"}>mode:</span>
        <button
          onClick={() => setMode('chat')}
          className={cn(
            "px-2 py-0.5 rounded-md transition-colors",
            mode === 'chat'
              ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
              : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
          )}
        >
          chat
        </button>
        <button
          onClick={() => setMode('agent')}
          className={cn(
            "px-2 py-0.5 rounded-md transition-colors",
            mode === 'agent'
              ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
              : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
          )}
        >
          agent
        </button>
        <span className={isDark ? "text-slate-700" : "text-slate-300"}>|</span>
        <button
          onClick={() => setShowMcp(!showMcp)}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors",
            showMcp
              ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
              : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Plug className="w-3 h-3" />
          mcp
        </button>
        <button className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors",
          isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
        )}>
          <Globe className="w-3 h-3" />
          web
        </button>
      </div>
      
      {/* MCP 面板 */}
      {showMcp && (
        <div className={cn(
          "mb-2 p-2 rounded-md border",
          isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"
        )}>
          <div className={cn("text-[10px] uppercase tracking-wider mb-1.5", isDark ? "text-slate-600" : "text-slate-400")}>
            enabled servers
          </div>
          <div className="space-y-1">
            {['filesystem', 'shell_executor', 'web_search'].map((server) => (
              <label key={server} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked={server !== 'web_search'} className="rounded-md" />
                <span className={isDark ? "text-slate-400" : "text-slate-600"}>{server}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      
      {/* 输入框 */}
      <div className="flex items-end gap-2">
        <button className={cn(
          "p-1.5 rounded-md transition-colors shrink-0",
          isDark ? "hover:bg-slate-800 text-slate-600" : "hover:bg-slate-200 text-slate-400"
        )}>
          <Paperclip className="w-4 h-4" />
        </button>
        
        <div className="flex-1 relative">
          <span className={cn(
            "absolute left-0 top-2",
            isDark ? "text-slate-600" : "text-slate-400"
          )}>$</span>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="input..."
            rows={1}
            className={cn(
              "w-full bg-transparent text-sm resize-none focus:outline-none leading-relaxed pl-4",
              isDark ? "text-slate-300 placeholder:text-slate-600" : "text-slate-700 placeholder:text-slate-400"
            )}
            style={{ minHeight: '24px', maxHeight: '200px' }}
          />
        </div>
        
        <button className={cn(
          "p-1.5 rounded-md transition-colors shrink-0",
          value.trim()
            ? isDark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-slate-700 text-white hover:bg-slate-600"
            : isDark ? "text-slate-600" : "text-slate-400"
        )}>
          <Send className="w-4 h-4" />
        </button>
      </div>
      
      {/* 快捷键提示 */}
      <div className={cn(
        "flex items-center gap-4 mt-2",
        isDark ? "text-slate-700" : "text-slate-400"
      )}>
        <span>⌘↵ send</span>
        <span>/ commands</span>
        <span>@ mcp</span>
        <span># skills</span>
      </div>
    </div>
  );
}

// ==================== 设置视图组件 ====================

function SettingsView({ theme, onBack }: { theme: Theme; onBack: () => void }) {
  const isDark = theme === 'dark';
  const [activeTab, setActiveTab] = useState('general');
  
  return (
    <div className="flex-1 flex font-mono text-xs">
      {/* 设置侧边栏 */}
      <div className={cn(
        "w-48 h-full border-r flex flex-col",
        isDark ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"
      )}>
        <div className={cn(
          "p-3 border-b flex items-center gap-2",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <button 
            onClick={onBack}
            className={cn(
              "p-1 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <span className={cn("uppercase tracking-wider", isDark ? "text-slate-500" : "text-slate-500")}>
            settings
          </span>
        </div>
        
        <div className="flex-1 p-2 space-y-0.5">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left",
                activeTab === tab.id
                  ? isDark ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-900"
                  : isDark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-900/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              <span>{tab.name}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* 设置内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {activeTab === 'general' && <GeneralSettingsContent theme={theme} />}
          {activeTab === 'models' && <ModelsSettingsContent theme={theme} />}
          {activeTab === 'mcp' && <McpSettingsContent theme={theme} />}
          {activeTab === 'security' && <SecuritySettingsContent theme={theme} />}
          {activeTab === 'knowledge' && <KnowledgeSettingsContent theme={theme} />}
          {activeTab === 'advanced' && <AdvancedSettingsContent theme={theme} />}
        </div>
      </div>
    </div>
  );
}

function GeneralSettingsContent({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className={cn("text-sm font-medium mb-4", isDark ? "text-slate-200" : "text-slate-900")}>
          # general
        </h2>
        
        <div className="space-y-4">
          <SettingItem theme={theme} label="language" value="简体中文" type="select" options={['简体中文', 'English', '日本語']} />
          <SettingItem theme={theme} label="theme" value="system" type="select" options={['light', 'dark', 'system']} />
          <SettingItem theme={theme} label="font_size" value="14px" type="select" options={['12px', '14px', '16px']} />
          <SettingItem theme={theme} label="send_shortcut" value="⌘+Enter" type="select" options={['Enter', '⌘+Enter', 'Ctrl+Enter']} />
          <SettingItem theme={theme} label="auto_save" value={true} type="toggle" />
          <SettingItem theme={theme} label="show_timestamps" value={true} type="toggle" />
        </div>
      </div>
      
      <div>
        <h3 className={cn("text-sm font-medium mb-3", isDark ? "text-slate-300" : "text-slate-700")}>
          ## startup
        </h3>
        <div className="space-y-3">
          <SettingItem theme={theme} label="restore_last_session" value={true} type="toggle" />
          <SettingItem theme={theme} label="check_updates" value={true} type="toggle" />
        </div>
      </div>
    </div>
  );
}

function ModelsSettingsContent({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  const providers = [
    { name: 'LM Studio', status: 'connected', models: 3 },
    { name: 'OpenAI', status: 'disconnected', models: 0 },
    { name: 'Anthropic', status: 'disconnected', models: 0 },
  ];
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className={cn("text-sm font-medium mb-4", isDark ? "text-slate-200" : "text-slate-900")}>
          # ai_models
        </h2>
        
        <div className="space-y-2">
          {providers.map((p) => (
            <div 
              key={p.name}
              className={cn(
                "flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors",
                isDark ? "border-slate-800 hover:bg-slate-900/50" : "border-slate-200 hover:bg-slate-50"
              )}
            >
              <div className={cn(
                "w-2 h-2 rounded-full",
                p.status === 'connected' ? "bg-emerald-500" : "bg-slate-500"
              )} />
              <span className={isDark ? "text-slate-300" : "text-slate-700"}>{p.name}</span>
              <span className={isDark ? "text-slate-600" : "text-slate-400"}>
                {p.status === 'connected' ? `${p.models} models` : 'not configured'}
              </span>
              <ChevronRight className={cn("w-3.5 h-3.5 ml-auto", isDark ? "text-slate-600" : "text-slate-400")} />
            </div>
          ))}
        </div>
        
        <button className={cn(
          "mt-3 flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors",
          isDark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
        )}>
          <Plus className="w-3.5 h-3.5" />
          <span>add provider</span>
        </button>
      </div>
    </div>
  );
}

function McpSettingsContent({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  const servers = [
    { name: 'filesystem', status: 'running', version: '1.0.0' },
    { name: 'shell_executor', status: 'running', version: '1.0.0' },
    { name: 'web_search', status: 'stopped', version: '1.0.0' },
  ];
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className={cn("text-sm font-medium mb-4", isDark ? "text-slate-200" : "text-slate-900")}>
          # mcp_servers
        </h2>
        
        <div className="space-y-2">
          {servers.map((s) => (
            <div 
              key={s.name}
              className={cn(
                "flex items-center gap-3 p-3 rounded-md border",
                isDark ? "border-slate-800" : "border-slate-200"
              )}
            >
              <div className={cn(
                "w-2 h-2 rounded-full",
                s.status === 'running' ? "bg-emerald-500" : "bg-slate-500"
              )} />
              <span className={isDark ? "text-slate-300" : "text-slate-700"}>{s.name}</span>
              <span className={isDark ? "text-slate-600" : "text-slate-400"}>v{s.version}</span>
              <span className={cn(
                "ml-auto px-2 py-0.5 rounded-md text-[10px]",
                s.status === 'running'
                  ? isDark ? "bg-emerald-900/30 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : isDark ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-500"
              )}>
                {s.status}
              </span>
            </div>
          ))}
        </div>
        
        <button className={cn(
          "mt-3 flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors",
          isDark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
        )}>
          <Plus className="w-3.5 h-3.5" />
          <span>add server</span>
        </button>
      </div>
    </div>
  );
}

function SecuritySettingsContent({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className={cn("text-sm font-medium mb-4", isDark ? "text-slate-200" : "text-slate-900")}>
          # security
        </h2>
        
        <div className="space-y-4">
          <SettingItem theme={theme} label="require_auth_for_filesystem" value={true} type="toggle" />
          <SettingItem theme={theme} label="require_auth_for_shell" value={true} type="toggle" />
          <SettingItem theme={theme} label="allowed_directories" value="/Users/Desktop, /Users/Documents" type="text" />
        </div>
      </div>
      
      <div>
        <h3 className={cn("text-sm font-medium mb-3", isDark ? "text-slate-300" : "text-slate-700")}>
          ## trusted_paths
        </h3>
        <div className={cn(
          "p-3 rounded-md border",
          isDark ? "border-slate-800 bg-slate-900/30" : "border-slate-200 bg-slate-50"
        )}>
          <div className={isDark ? "text-slate-400" : "text-slate-600"}>
            ~/Desktop<br />
            ~/Documents<br />
            ~/Projects
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeSettingsContent({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className={cn("text-sm font-medium mb-4", isDark ? "text-slate-200" : "text-slate-900")}>
          # knowledge_base
        </h2>
        
        <div className={cn(
          "p-4 rounded-md border text-center",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <Database className={cn("w-8 h-8 mx-auto mb-2", isDark ? "text-slate-600" : "text-slate-400")} />
          <div className={isDark ? "text-slate-400" : "text-slate-600"}>no knowledge bases</div>
          <button className={cn(
            "mt-3 flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors mx-auto",
            isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          )}>
            <Plus className="w-3.5 h-3.5" />
            <span>create</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AdvancedSettingsContent({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className={cn("text-sm font-medium mb-4", isDark ? "text-slate-200" : "text-slate-900")}>
          # advanced
        </h2>
        
        <div className="space-y-4">
          <SettingItem theme={theme} label="debug_mode" value={false} type="toggle" />
          <SettingItem theme={theme} label="log_level" value="info" type="select" options={['debug', 'info', 'warn', 'error']} />
          <SettingItem theme={theme} label="max_context_tokens" value="8192" type="text" />
        </div>
      </div>
      
      <div>
        <h3 className={cn("text-sm font-medium mb-3", isDark ? "text-slate-300" : "text-slate-700")}>
          ## data
        </h3>
        <div className="flex gap-2">
          <button className={cn(
            "px-3 py-1.5 rounded-md transition-colors",
            isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          )}>
            export data
          </button>
          <button className={cn(
            "px-3 py-1.5 rounded-md transition-colors",
            isDark ? "text-red-400 hover:bg-red-900/30" : "text-red-600 hover:bg-red-50"
          )}>
            clear all data
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingItem({ 
  theme, 
  label, 
  value, 
  type,
  options
}: { 
  theme: Theme;
  label: string;
  value: string | boolean;
  type: 'text' | 'select' | 'toggle';
  options?: string[];
}) {
  const isDark = theme === 'dark';
  const [currentValue, setCurrentValue] = useState(value);
  
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={isDark ? "text-slate-400" : "text-slate-600"}>{label}</span>
      
      {type === 'toggle' && (
        <button
          onClick={() => setCurrentValue(!currentValue)}
          className={cn(
            "w-10 h-5 rounded-full transition-colors relative",
            currentValue
              ? isDark ? "bg-emerald-600" : "bg-emerald-500"
              : isDark ? "bg-slate-700" : "bg-slate-300"
          )}
        >
          <div className={cn(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
            currentValue ? "translate-x-5" : "translate-x-0.5"
          )} />
        </button>
      )}
      
      {type === 'select' && options && (
        <select
          value={currentValue as string}
          onChange={(e) => setCurrentValue(e.target.value)}
          className={cn(
            "px-2 py-1 rounded-md border outline-none",
            isDark ? "bg-slate-900 border-slate-700 text-slate-300" : "bg-white border-slate-300 text-slate-700"
          )}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}
      
      {type === 'text' && (
        <input
          type="text"
          value={currentValue as string}
          onChange={(e) => setCurrentValue(e.target.value)}
          className={cn(
            "px-2 py-1 rounded-md border outline-none w-48",
            isDark ? "bg-slate-900 border-slate-700 text-slate-300" : "bg-white border-slate-300 text-slate-700"
          )}
        />
      )}
    </div>
  );
}

// ==================== 提示词视图组件 ====================

function PromptsView({ theme, onBack }: { theme: Theme; onBack: () => void }) {
  const isDark = theme === 'dark';
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<typeof mockPrompts[0] | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  
  const filteredPrompts = mockPrompts.filter(p => {
    if (showFavorites && !p.favorite) return false;
    if (filterTag && !p.tags.includes(filterTag)) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
  
  const allTags = Array.from(new Set(mockPrompts.flatMap(p => p.tags)));
  
  return (
    <div className="flex-1 flex flex-col font-mono text-xs">
      {/* 头部 */}
      <div className={cn(
        "p-3 border-b",
        isDark ? "border-slate-800" : "border-slate-200"
      )}>
        <div className="flex items-center gap-3 mb-3">
          <button 
            onClick={onBack}
            className={cn(
              "p-1 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <span className={cn("uppercase tracking-wider", isDark ? "text-slate-500" : "text-slate-500")}>
            prompts
          </span>
          <button
            onClick={() => setShowEditor(true)}
            className={cn(
              "ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors",
              isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>new</span>
          </button>
        </div>
        
        {/* 搜索和筛选 */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <span className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2",
              isDark ? "text-slate-600" : "text-slate-400"
            )}>$</span>
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="grep..."
              className={cn(
                "w-full bg-transparent pl-4 py-1 outline-none",
                isDark ? "text-slate-300 placeholder:text-slate-600" : "text-slate-700 placeholder:text-slate-400"
              )}
            />
          </div>
          
          <button
            onClick={() => setShowFavorites(!showFavorites)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
              showFavorites
                ? isDark ? "bg-amber-900/30 text-amber-400" : "bg-amber-100 text-amber-700"
                : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Star className={cn("w-3.5 h-3.5", showFavorites && "fill-current")} />
            <span>favorites</span>
          </button>
        </div>
        
        {/* 标签筛选 */}
        <div className="flex items-center gap-2 mt-2">
          <span className={isDark ? "text-slate-600" : "text-slate-400"}>tags:</span>
          <button
            onClick={() => setFilterTag(null)}
            className={cn(
              "px-2 py-0.5 rounded-md transition-colors",
              filterTag === null
                ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
                : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
            )}
          >
            all
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag)}
              className={cn(
                "px-2 py-0.5 rounded-md transition-colors",
                filterTag === tag
                  ? isDark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
                  : isDark ? "text-slate-600 hover:text-slate-400" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      
      {/* 提示词列表 */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-1">
          {filteredPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className={cn(
                "p-3 rounded-md cursor-pointer transition-colors",
                selectedPrompt?.id === prompt.id
                  ? isDark ? "bg-slate-800" : "bg-slate-200"
                  : isDark ? "hover:bg-slate-900/50" : "hover:bg-slate-100"
              )}
              onClick={() => setSelectedPrompt(prompt)}
            >
              <div className="flex items-center gap-2 mb-1">
                {prompt.favorite && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                <span className={isDark ? "text-slate-200" : "text-slate-900"}>{prompt.name}</span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded-md text-[10px]",
                  isDark ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500"
                )}>
                  /{prompt.shortcut}
                </span>
                <span className={cn("ml-auto", isDark ? "text-slate-600" : "text-slate-400")}>
                  {prompt.uses} uses
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {prompt.tags.map((tag) => (
                  <span 
                    key={tag}
                    className={cn(
                      "px-1.5 py-0.5 rounded-md text-[10px]",
                      isDark ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-500"
                    )}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* 选中的提示词详情 */}
      {selectedPrompt && (
        <div className={cn(
          "border-t p-4",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <div className="flex items-center justify-between mb-2">
            <span className={isDark ? "text-slate-300" : "text-slate-700"}>
              {selectedPrompt.name}
            </span>
            <div className="flex items-center gap-2">
              <button className={cn(
                "px-2 py-1 rounded-md transition-colors",
                isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
              )}>
                edit
              </button>
              <button className={cn(
                "px-2 py-1 rounded-md transition-colors",
                isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
              )}>
                apply
              </button>
            </div>
          </div>
          <pre className={cn(
            "p-3 rounded-md text-xs overflow-x-auto",
            isDark ? "bg-slate-900 text-slate-400" : "bg-slate-100 text-slate-600"
          )}>
            {selectedPrompt.content}
          </pre>
        </div>
      )}
      
      {/* 新建/编辑弹窗 */}
      {showEditor && (
        <PromptEditorModal theme={theme} onClose={() => setShowEditor(false)} />
      )}
    </div>
  );
}

function PromptEditorModal({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={cn(
        "relative w-full max-w-lg p-4 rounded-lg shadow-xl font-mono text-xs",
        isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-slate-200"
      )}>
        <div className="flex items-center justify-between mb-4">
          <span className={isDark ? "text-slate-200" : "text-slate-900"}>new prompt</span>
          <button onClick={onClose} className={isDark ? "text-slate-500" : "text-slate-500"}>
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="space-y-3">
          <div>
            <label className={cn("block mb-1", isDark ? "text-slate-500" : "text-slate-500")}>name</label>
            <input
              type="text"
              className={cn(
                "w-full px-3 py-2 rounded-md border outline-none",
                isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
              placeholder="prompt name..."
            />
          </div>
          
          <div>
            <label className={cn("block mb-1", isDark ? "text-slate-500" : "text-slate-500")}>shortcut</label>
            <div className="flex items-center gap-2">
              <span className={isDark ? "text-slate-600" : "text-slate-400"}>/</span>
              <input
                type="text"
                className={cn(
                  "flex-1 px-3 py-2 rounded-md border outline-none",
                  isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
                )}
                placeholder="shortcut..."
              />
            </div>
          </div>
          
          <div>
            <label className={cn("block mb-1", isDark ? "text-slate-500" : "text-slate-500")}>content</label>
            <textarea
              rows={6}
              className={cn(
                "w-full px-3 py-2 rounded-md border outline-none resize-none",
                isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
              placeholder="prompt content..."
            />
          </div>
          
          <div>
            <label className={cn("block mb-1", isDark ? "text-slate-500" : "text-slate-500")}>tags</label>
            <input
              type="text"
              className={cn(
                "w-full px-3 py-2 rounded-md border outline-none",
                isDark ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
              placeholder="tag1, tag2..."
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className={cn(
              "px-3 py-1.5 rounded-md transition-colors",
              isDark ? "text-slate-500 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            cancel
          </button>
          <button className={cn(
            "px-3 py-1.5 rounded-md transition-colors",
            isDark ? "bg-slate-700 text-slate-200 hover:bg-slate-600" : "bg-slate-800 text-white hover:bg-slate-700"
          )}>
            save
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面 ====================

export default function TerminalMinimalPreview() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [view, setView] = useState<View>('chat');
  const [activeConvId, setActiveConvId] = useState('1');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-screen flex overflow-hidden",
      isDark ? "bg-slate-950 text-slate-300" : "bg-white text-slate-900"
    )}>
      {/* 侧边栏 - 聊天视图时显示 */}
      {view === 'chat' && (
        <Sidebar
          theme={theme}
          conversations={mockConversations}
          activeId={activeConvId}
          onSelect={setActiveConvId}
          onViewChange={setView}
        />
      )}
      
      {/* 设置视图 */}
      {view === 'settings' && (
        <SettingsView theme={theme} onBack={() => setView('chat')} />
      )}
      
      {/* 提示词视图 */}
      {view === 'prompts' && (
        <PromptsView theme={theme} onBack={() => setView('chat')} />
      )}
      
      {/* 聊天主区域 */}
      {view === 'chat' && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* 顶部栏 */}
          <div className={cn(
            "flex items-center justify-between px-4 py-2 border-b font-mono text-xs",
            isDark ? "border-slate-800" : "border-slate-200"
          )}>
            <div className="flex items-center gap-3">
              <span className={isDark ? "text-slate-400" : "text-slate-600"}>新对话 15:34</span>
              <span className={isDark ? "text-slate-700" : "text-slate-300"}>|</span>
              <span className={isDark ? "text-slate-600" : "text-slate-400"}>qwen3-vl-30b-a3b-instruct</span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* 主题切换 */}
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
                )}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              
              {/* 更多菜单 */}
              <div className="relative">
                <button
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className={cn(
                    "px-2 py-1 rounded-md transition-colors",
                    isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
                  )}
                >
                  menu
                </button>
                
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
                    <div className={cn(
                      "absolute right-0 top-full mt-1 w-40 py-1 border shadow-lg z-50",
                      isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
                    )}>
                      {[
                        { label: 'share', icon: Share2 },
                        { label: 'export', icon: Download },
                        { label: 'favorite', icon: Star },
                        { type: 'divider' as const },
                        { label: 'delete', icon: Trash2, danger: true },
                      ].map((item, i) => (
                        item.type === 'divider' ? (
                          <div key={i} className={cn("my-1 border-t", isDark ? "border-slate-800" : "border-slate-100")} />
                        ) : (
                          <button
                            key={i}
                            className={cn(
                              "w-full flex items-center gap-2 px-3 py-1.5 transition-colors text-left",
                              item.danger
                                ? isDark ? "text-red-400 hover:bg-red-900/30" : "text-red-600 hover:bg-red-50"
                                : isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-50"
                            )}
                            onClick={() => setMoreMenuOpen(false)}
                          >
                            <item.icon className="w-3.5 h-3.5" />
                            <span>{item.label}</span>
                          </button>
                        )
                      ))}
                    </div>
                  </>
                )}
              </div>
              
              {/* 返回按钮 */}
              <Link 
                href="/dev-tools/chat-redesign"
                className={cn(
                  "px-2 py-1 rounded-md transition-colors",
                  isDark ? "hover:bg-slate-800 text-slate-500" : "hover:bg-slate-200 text-slate-500"
                )}
              >
                ← back
              </Link>
            </div>
          </div>

          {/* 消息区域 */}
          <div className="flex-1 overflow-y-auto px-4">
            <div className="max-w-3xl mx-auto py-4">
              {mockMessages.map((msg) => (
                <Message key={msg.id} message={msg} theme={theme} />
              ))}
            </div>
          </div>

          {/* 输入区域 */}
          <div className="max-w-3xl mx-auto w-full">
            <InputArea theme={theme} />
          </div>
        </div>
      )}
    </div>
  );
}
