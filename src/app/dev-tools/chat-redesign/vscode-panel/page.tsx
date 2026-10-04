"use client";

import React, { useState } from 'react';
import { 
  ArrowLeft, Plus, Search, Send, Paperclip, 
  Check, X, Loader2, Copy, RotateCcw, ChevronRight, ChevronDown,
  Moon, Sun, Trash2, Settings, MessageSquare, Terminal,
  Files, GitBranch, Bug, Package, Play, Square, MoreHorizontal,
  Maximize2, Minimize2, SplitSquareHorizontal, PanelRightClose,
  ChevronUp, Circle, AlertCircle, Info, XCircle, Bell
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案9: 面板布局风格 (VSCode Panel)
 * 
 * 设计理念：
 * - 借鉴VSCode的面板设计
 * - 可调整大小的分区
 * - 标签导航和多视图
 * - 状态栏信息展示
 * - 专业的开发工具感
 */

type Theme = 'light' | 'dark';

const mockConversations = [
  { id: '1', title: '新对话 15:34', isActive: true, status: 'running' },
  { id: '2', title: 'API设计', status: 'idle' },
  { id: '3', title: '代码审查', status: 'error' },
  { id: '4', title: '项目规划', status: 'idle' },
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
    content: '执行文件系统扫描...',
    time: '15:34:23',
    toolCalls: [
      { name: 'fs.readdir', path: 'C:/Users/Desktop', status: 'success' as const, output: '找到 11 个项目' },
      { name: 'fs.stat', path: '*.lnk', status: 'success' as const, output: '8 个快捷方式' },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `扫描完成。桌面文件列表：

\`\`\`
📁 项目文档/
📁 临时文件/
📁 截图/
📄 Chatless.lnk
📄 Cherry Studio.lnk
📄 Clash Verge.lnk
📄 Cursor.lnk
📄 DBeaver.lnk
📄 Visual Studio Code.lnk
📄 Notion.lnk
📄 chatlog.exe - 快捷方式.lnk
\`\`\`

共计 **3** 个文件夹和 **8** 个文件。`,
    time: '15:34:25',
  },
];

const mockProblems = [
  { type: 'error', message: '工具调用超时', source: 'fs.readdir', line: 1 },
  { type: 'warning', message: '文件权限受限', source: 'fs.stat', line: 2 },
];

const mockOutput = [
  '[15:34:22] 开始执行任务...',
  '[15:34:22] 调用 fs.readdir("C:/Users/Desktop")',
  '[15:34:23] 返回 11 个项目',
  '[15:34:23] 调用 fs.stat("*.lnk")',
  '[15:34:23] 匹配 8 个文件',
  '[15:34:25] 任务完成',
];

// 活动栏
function ActivityBar({ theme, activeView, onViewChange }: { 
  theme: Theme; 
  activeView: string;
  onViewChange: (view: string) => void;
}) {
  const isDark = theme === 'dark';
  
  const views = [
    { id: 'chat', icon: MessageSquare, label: '对话' },
    { id: 'files', icon: Files, label: '文件' },
    { id: 'search', icon: Search, label: '搜索' },
    { id: 'git', icon: GitBranch, label: 'Git' },
    { id: 'debug', icon: Bug, label: '调试' },
    { id: 'extensions', icon: Package, label: '扩展' },
  ];
  
  return (
    <div className={cn(
      "w-12 flex flex-col items-center py-2 border-r",
      isDark ? "bg-[#181818] border-[#2d2d2d]" : "bg-slate-100 border-slate-200"
    )}>
      {views.map((view) => (
        <button
          key={view.id}
          onClick={() => onViewChange(view.id)}
          className={cn(
            "w-12 h-12 flex items-center justify-center transition-colors relative",
            activeView === view.id
              ? isDark ? "text-white" : "text-slate-900"
              : isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
          )}
          title={view.label}
        >
          {activeView === view.id && (
            <div className={cn(
              "absolute left-0 w-0.5 h-6 rounded-r",
              isDark ? "bg-white" : "bg-slate-900"
            )} />
          )}
          <view.icon className="w-6 h-6" />
        </button>
      ))}
      
      <div className="flex-1" />
      
      <button className={cn(
        "w-12 h-12 flex items-center justify-center transition-colors",
        isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
      )}>
        <Settings className="w-5 h-5" />
      </button>
    </div>
  );
}

// 侧边栏
function Sidebar({ 
  theme, 
  conversations,
  activeId,
  onSelect
}: { 
  theme: Theme;
  conversations: typeof mockConversations;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const isDark = theme === 'dark';
  const [isExpanded, setIsExpanded] = useState(true);
  
  const statusColors = {
    running: 'bg-blue-500',
    idle: 'bg-slate-400',
    error: 'bg-red-500',
  };
  
  return (
    <div className={cn(
      "w-60 flex flex-col border-r",
      isDark ? "bg-[#1e1e1e] border-[#2d2d2d]" : "bg-slate-50 border-slate-200"
    )}>
      {/* 标题 */}
      <div className={cn(
        "px-4 py-2 text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between",
        isDark ? "text-slate-400" : "text-slate-500"
      )}>
        <span>对话</span>
        <button className={cn(
          "p-1 rounded-md transition-colors",
          isDark ? "hover:bg-white/10" : "hover:bg-slate-200"
        )}>
          <Plus className="w-4 h-4" />
        </button>
      </div>
      
      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={cn(
              "w-full flex items-center gap-2 px-4 py-1.5 text-sm transition-colors",
              activeId === conv.id
                ? isDark ? "bg-[#37373d]" : "bg-blue-50"
                : isDark ? "hover:bg-[#2a2a2a]" : "hover:bg-slate-100"
            )}
          >
            <div className={cn(
              "w-2 h-2 rounded-full shrink-0",
              statusColors[conv.status as keyof typeof statusColors]
            )} />
            <MessageSquare className={cn(
              "w-4 h-4 shrink-0",
              isDark ? "text-slate-400" : "text-slate-500"
            )} />
            <span className={cn(
              "flex-1 text-left truncate",
              activeId === conv.id
                ? isDark ? "text-white" : "text-slate-900"
                : isDark ? "text-slate-300" : "text-slate-700"
            )}>
              {conv.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 编辑器标签栏
function EditorTabs({ theme, activeId }: { theme: Theme; activeId: string }) {
  const isDark = theme === 'dark';
  
  const tabs = [
    { id: '1', title: '新对话 15:34', isActive: true },
    { id: '2', title: 'API设计', isActive: false },
  ];
  
  return (
    <div className={cn(
      "flex items-center border-b",
      isDark ? "bg-[#1e1e1e] border-[#2d2d2d]" : "bg-slate-100 border-slate-200"
    )}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-sm border-r cursor-pointer group",
            tab.isActive
              ? isDark ? "bg-[#1e1e1e] text-white border-t-2 border-t-blue-500" : "bg-white text-slate-900 border-t-2 border-t-blue-500"
              : isDark ? "bg-[#2d2d2d] text-slate-400 hover:bg-[#37373d]" : "bg-slate-200 text-slate-600 hover:bg-slate-300",
            isDark ? "border-[#2d2d2d]" : "border-slate-200"
          )}
        >
          <MessageSquare className="w-4 h-4" />
          <span>{tab.title}</span>
          <button className={cn(
            "p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
            isDark ? "hover:bg-white/10" : "hover:bg-slate-300"
          )}>
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      
      <div className="flex-1" />
      
      <div className="flex items-center gap-1 px-2">
        <button className={cn(
          "p-1.5 rounded-md transition-colors",
          isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"
        )}>
          <SplitSquareHorizontal className="w-4 h-4" />
        </button>
        <button className={cn(
          "p-1.5 rounded-md transition-colors",
          isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"
        )}>
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// 工具调用输出
function ToolCallOutput({ calls, theme }: { calls: typeof mockMessages[1]['toolCalls']; theme: Theme }) {
  const isDark = theme === 'dark';
  
  if (!calls) return null;
  
  return (
    <div className={cn(
      "font-mono text-xs mb-3 rounded-md overflow-hidden",
      isDark ? "bg-[#1e1e1e]" : "bg-slate-100"
    )}>
      {calls.map((call, i) => (
        <div 
          key={i} 
          className={cn(
            "flex items-start gap-2 px-3 py-1.5 border-l-2",
            call.status === 'success' ? "border-green-500" : "border-red-500"
          )}
        >
          {call.status === 'success' ? (
            <Check className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
          ) : (
            <X className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("text-blue-400")}>{call.name}</span>
              <span className={isDark ? "text-slate-600" : "text-slate-400"}>→</span>
              <span className={isDark ? "text-slate-400" : "text-slate-600"}>{call.path}</span>
            </div>
            <div className={isDark ? "text-slate-500" : "text-slate-500"}>
              {call.output}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// 消息组件
function Message({ message, theme }: { message: typeof mockMessages[0]; theme: Theme }) {
  const isUser = message.role === 'user';
  const isDark = theme === 'dark';
  
  return (
    <div className="py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn(
          "text-xs font-mono",
          isDark ? "text-slate-500" : "text-slate-400"
        )}>
          [{message.time}]
        </span>
        <span className={cn(
          "text-xs font-semibold",
          isUser
            ? isDark ? "text-green-400" : "text-green-600"
            : isDark ? "text-blue-400" : "text-blue-600"
        )}>
          {isUser ? 'USER' : 'ASSISTANT'}
        </span>
      </div>
      
      {'toolCalls' in message && <ToolCallOutput calls={message.toolCalls} theme={theme} />}
      
      <div className={cn(
        "text-sm leading-relaxed whitespace-pre-wrap",
        isDark ? "text-slate-200" : "text-slate-800"
      )}>
        {message.content}
      </div>
    </div>
  );
}

// 底部面板
function BottomPanel({ theme, activeTab, onTabChange }: { 
  theme: Theme; 
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const isDark = theme === 'dark';
  const [isExpanded, setIsExpanded] = useState(true);
  
  const tabs = [
    { id: 'problems', label: '问题', icon: AlertCircle, count: 2 },
    { id: 'output', label: '输出', icon: Terminal, count: 0 },
    { id: 'terminal', label: '终端', icon: Terminal, count: 0 },
  ];
  
  return (
    <div className={cn(
      "flex flex-col border-t",
      isDark ? "border-[#2d2d2d]" : "border-slate-200",
      isExpanded ? "h-48" : "h-8"
    )}>
      {/* 面板标签栏 */}
      <div className={cn(
        "flex items-center px-2 border-b",
        isDark ? "bg-[#1e1e1e] border-[#2d2d2d]" : "bg-slate-100 border-slate-200"
      )}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs transition-colors",
              activeTab === tab.id
                ? isDark ? "text-white border-b border-white" : "text-slate-900 border-b border-slate-900"
                : isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span className={cn(
                "px-1.5 py-0.5 rounded-full text-[10px]",
                isDark ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600"
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
        
        <div className="flex-1" />
        
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "p-1 rounded-md transition-colors",
            isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"
          )}
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <button className={cn(
          "p-1 rounded-md transition-colors",
          isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"
        )}>
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* 面板内容 */}
      {isExpanded && (
        <div className={cn(
          "flex-1 overflow-y-auto p-2 font-mono text-xs",
          isDark ? "bg-[#1e1e1e]" : "bg-white"
        )}>
          {activeTab === 'problems' && (
            <div className="space-y-1">
              {mockProblems.map((problem, i) => (
                <div key={i} className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-black/5">
                  {problem.type === 'error' ? (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />
                  )}
                  <span className={isDark ? "text-slate-300" : "text-slate-700"}>{problem.message}</span>
                  <span className={isDark ? "text-slate-500" : "text-slate-400"}>[{problem.source}]</span>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'output' && (
            <div className={isDark ? "text-slate-400" : "text-slate-600"}>
              {mockOutput.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 状态栏
function StatusBar({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-6 flex items-center justify-between px-2 text-xs",
      isDark ? "bg-[#007acc] text-white" : "bg-blue-600 text-white"
    )}>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <GitBranch className="w-3.5 h-3.5" />
          main
        </span>
        <span className="flex items-center gap-1">
          <Circle className="w-2 h-2 fill-current" />
          已连接
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span>qwen3-vl-30b</span>
        <span>UTF-8</span>
        <span className="flex items-center gap-1">
          <Bell className="w-3.5 h-3.5" />
          0
        </span>
      </div>
    </div>
  );
}

// 输入框
function InputArea({ theme }: { theme: Theme }) {
  const [value, setValue] = useState('');
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "border-t p-3",
      isDark ? "border-[#2d2d2d]" : "border-slate-200"
    )}>
      <div className={cn(
        "flex items-end gap-2 p-2 rounded-md border",
        isDark ? "bg-[#1e1e1e] border-[#3c3c3c]" : "bg-white border-slate-300"
      )}>
        <button className={cn(
          "p-1.5 rounded-md transition-colors shrink-0",
          isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-100 text-slate-500"
        )}>
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入消息..."
          rows={1}
          className={cn(
            "flex-1 resize-none outline-none text-sm",
            isDark ? "bg-transparent text-slate-200 placeholder:text-slate-500" : "bg-transparent text-slate-800 placeholder:text-slate-400"
          )}
        />
        <button className={cn(
          "p-1.5 rounded-md transition-colors shrink-0",
          value.trim()
            ? "bg-blue-600 text-white hover:bg-blue-500"
            : isDark ? "bg-white/5 text-slate-500" : "bg-slate-100 text-slate-400"
        )}>
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// 主页面
export default function VSCodePanelPreview() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [activeView, setActiveView] = useState('chat');
  const [activeConvId, setActiveConvId] = useState('1');
  const [bottomTab, setBottomTab] = useState('output');
  
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-screen flex flex-col overflow-hidden",
      isDark ? "bg-[#1e1e1e]" : "bg-white"
    )}>
      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 活动栏 */}
        <ActivityBar theme={theme} activeView={activeView} onViewChange={setActiveView} />
        
        {/* 侧边栏 */}
        <Sidebar
          theme={theme}
          conversations={mockConversations}
          activeId={activeConvId}
          onSelect={setActiveConvId}
        />
        
        {/* 编辑器区域 */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 顶部工具栏 */}
          <div className={cn(
            "flex items-center justify-end gap-1 px-2 py-1 border-b",
            isDark ? "border-[#2d2d2d]" : "border-slate-200"
          )}>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link 
              href="/dev-tools/chat-redesign"
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
                isDark ? "hover:bg-white/10 text-slate-400" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              <ArrowLeft className="w-3 h-3" />
              返回
            </Link>
          </div>
          
          {/* 编辑器标签栏 */}
          <EditorTabs theme={theme} activeId={activeConvId} />
          
          {/* 消息区域 */}
          <div className="flex-1 overflow-y-auto px-4">
            {mockMessages.map((msg) => (
              <Message key={msg.id} message={msg} theme={theme} />
            ))}
          </div>
          
          {/* 输入区域 */}
          <InputArea theme={theme} />
          
          {/* 底部面板 */}
          <BottomPanel theme={theme} activeTab={bottomTab} onTabChange={setBottomTab} />
        </div>
      </div>
      
      {/* 状态栏 */}
      <StatusBar theme={theme} />
    </div>
  );
}
