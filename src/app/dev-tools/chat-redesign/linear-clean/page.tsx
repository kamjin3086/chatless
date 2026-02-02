"use client";

import React, { useState } from 'react';
import { 
  ArrowLeft, Plus, Search, Send, Paperclip, 
  Check, X, Loader2, Copy, RotateCcw, ChevronRight, ChevronDown,
  Moon, Sun, Star, Trash2, Archive, Settings, MessageSquare,
  Inbox, Clock, Filter, SlidersHorizontal, MoreHorizontal,
  Zap, Globe, Command, Hash, Sparkles, ArrowUpRight,
  PanelLeft, Keyboard
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案8: 线性简洁风格 (Linear Clean)
 * 
 * 设计理念：
 * - 借鉴Linear的极简美学
 * - 精确的对齐和网格系统
 * - 微妙的动效和过渡
 * - 键盘优先的交互设计
 * - 高信息密度但不拥挤
 */

type Theme = 'light' | 'dark';

const mockConversations = [
  { id: '1', title: '新对话 15:34', status: 'active', priority: 'high', time: '刚刚' },
  { id: '2', title: 'API设计讨论', status: 'done', priority: 'medium', time: '14分钟前' },
  { id: '3', title: '代码审查反馈', status: 'active', priority: 'low', time: '1小时前' },
  { id: '4', title: '项目规划会议', status: 'done', priority: 'medium', time: '3小时前' },
  { id: '5', title: '技术选型分析', status: 'archived', priority: 'low', time: '昨天' },
];

const mockMessages = [
  {
    id: '1',
    role: 'user' as const,
    content: '读取我的桌面，列出其中所有的文档名',
    time: '15:34',
  },
  {
    id: '2',
    role: 'assistant' as const,
    content: '正在执行文件系统操作...',
    time: '15:34',
    toolCalls: [
      { name: 'list_directory', args: 'Desktop', status: 'success' as const, duration: '312ms' },
      { name: 'filter_files', args: '*.lnk, *.doc*', status: 'success' as const, duration: '89ms' },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `桌面文件扫描完成。

**快捷方式** (8)
- Chatless.lnk
- Cherry Studio.lnk
- Clash Verge.lnk
- Cursor.lnk
- DBeaver.lnk
- Visual Studio Code.lnk
- Notion.lnk
- chatlog.exe - 快捷方式.lnk

**文件夹** (3)
- 项目文档/
- 临时文件/
- 截图/`,
    time: '15:35',
  },
];

// 优先级颜色
const priorityColors = {
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

// 状态图标
const statusIcons = {
  active: { icon: Loader2, color: 'text-blue-500', spin: true },
  done: { icon: Check, color: 'text-green-500', spin: false },
  archived: { icon: Archive, color: 'text-gray-400', spin: false },
};

// 侧边栏
function Sidebar({ 
  isOpen, 
  theme, 
  activeId,
  onSelect,
  onToggle
}: { 
  isOpen: boolean;
  theme: Theme;
  activeId: string;
  onSelect: (id: string) => void;
  onToggle: () => void;
}) {
  const isDark = theme === 'dark';
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('all');
  
  const filters = [
    { id: 'all', label: '全部', icon: Inbox },
    { id: 'active', label: '进行中', icon: Loader2 },
    { id: 'done', label: '已完成', icon: Check },
    { id: 'archived', label: '已归档', icon: Archive },
  ];
  
  const filteredConvs = mockConversations.filter(c => 
    selectedFilter === 'all' || c.status === selectedFilter
  );
  
  return (
    <div className={cn(
      "h-full flex flex-col transition-all duration-150",
      isOpen ? "w-64" : "w-14",
      isDark ? "bg-[#0f0f10] border-[#1f1f23]" : "bg-gray-50 border-gray-200",
      "border-r"
    )}>
      {/* 头部 */}
      <div className={cn(
        "flex items-center gap-2 p-3",
        isOpen ? "justify-between" : "justify-center"
      )}>
        {isOpen ? (
          <>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-6 h-6 rounded flex items-center justify-center text-xs font-bold",
                "bg-gradient-to-br from-violet-500 to-purple-600 text-white"
              )}>
                C
              </div>
              <span className={cn("font-semibold text-sm", isDark ? "text-white" : "text-gray-900")}>
                Chatless
              </span>
            </div>
            <button 
              onClick={onToggle}
              className={cn(
                "p-1.5 rounded transition-colors",
                isDark ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-200 text-gray-400"
              )}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </>
        ) : (
          <button 
            onClick={onToggle}
            className={cn(
              "p-1.5 rounded transition-colors",
              isDark ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-200 text-gray-400"
            )}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {isOpen && (
        <>
          {/* 搜索和新建 */}
          <div className="px-3 space-y-2">
            <button className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
              isDark 
                ? "bg-violet-600 text-white hover:bg-violet-500" 
                : "bg-violet-500 text-white hover:bg-violet-600"
            )}>
              <Plus className="w-4 h-4" />
              <span>新对话</span>
              <kbd className="ml-auto text-[10px] opacity-60 bg-white/20 px-1 rounded">⌘N</kbd>
            </button>
            
            <div className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
              isDark ? "bg-white/5 text-gray-400" : "bg-white border border-gray-200 text-gray-500"
            )}>
              <Search className="w-4 h-4" />
              <span>搜索...</span>
              <kbd className="ml-auto text-[10px] opacity-60 px-1 rounded bg-black/10">⌘K</kbd>
            </div>
          </div>
          
          {/* 筛选器 */}
          <div className="px-3 py-3">
            <div className="flex items-center gap-1">
              {filters.map(filter => (
                <button
                  key={filter.id}
                  onClick={() => setSelectedFilter(filter.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all",
                    selectedFilter === filter.id
                      ? isDark ? "bg-white/10 text-white" : "bg-gray-200 text-gray-900"
                      : isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <filter.icon className={cn("w-3.5 h-3.5", filter.id === 'active' && "animate-spin")} />
                  <span>{filter.label}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto px-2">
            {filteredConvs.map((conv) => {
              const StatusIcon = statusIcons[conv.status as keyof typeof statusIcons];
              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all mb-0.5",
                    activeId === conv.id
                      ? isDark ? "bg-white/10" : "bg-gray-200"
                      : isDark ? "hover:bg-white/5" : "hover:bg-gray-100"
                  )}
                >
                  {/* 优先级指示 */}
                  <div className={cn(
                    "w-1 h-8 rounded-full shrink-0",
                    priorityColors[conv.priority as keyof typeof priorityColors]
                  )} />
                  
                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "text-sm truncate",
                      isDark ? "text-gray-200" : "text-gray-800"
                    )}>
                      {conv.title}
                    </div>
                    <div className={cn("text-xs", isDark ? "text-gray-500" : "text-gray-500")}>
                      {conv.time}
                    </div>
                  </div>
                  
                  {/* 状态 */}
                  <StatusIcon.icon className={cn(
                    "w-4 h-4 shrink-0",
                    StatusIcon.color,
                    StatusIcon.spin && "animate-spin"
                  )} />
                </button>
              );
            })}
          </div>
          
          {/* 底部 */}
          <div className={cn(
            "p-3 border-t",
            isDark ? "border-[#1f1f23]" : "border-gray-200"
          )}>
            <button className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
              isDark ? "hover:bg-white/5 text-gray-400" : "hover:bg-gray-100 text-gray-500"
            )}>
              <Settings className="w-4 h-4" />
              <span>设置</span>
              <kbd className="ml-auto text-[10px] opacity-60 px-1 rounded bg-black/10">⌘,</kbd>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// 工具调用
function ToolCalls({ calls, theme }: { calls: typeof mockMessages[1]['toolCalls']; theme: Theme }) {
  const [expanded, setExpanded] = useState(true);
  const isDark = theme === 'dark';
  
  if (!calls) return null;
  
  const totalTime = calls.reduce((acc, c) => acc + parseInt(c.duration || '0'), 0);
  
  return (
    <div className={cn(
      "rounded-lg overflow-hidden mb-3",
      isDark ? "bg-[#1a1a1d]" : "bg-gray-100"
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
          isDark ? "hover:bg-white/5" : "hover:bg-gray-200"
        )}
      >
        <ChevronRight className={cn(
          "w-3.5 h-3.5 transition-transform",
          expanded && "rotate-90",
          isDark ? "text-gray-500" : "text-gray-400"
        )} />
        <Zap className="w-3.5 h-3.5 text-violet-500" />
        <span className={isDark ? "text-gray-300" : "text-gray-600"}>
          {calls.length}个工具调用
        </span>
        <span className={cn("ml-auto font-mono", isDark ? "text-gray-500" : "text-gray-400")}>
          {totalTime}ms
        </span>
      </button>
      
      {expanded && (
        <div className={cn(
          "border-t",
          isDark ? "border-[#2a2a2d]" : "border-gray-200"
        )}>
          {calls.map((call, i) => (
            <div 
              key={i} 
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-xs",
                isDark ? "hover:bg-white/5" : "hover:bg-gray-50"
              )}
            >
              <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
              <code className={cn(
                "font-mono",
                isDark ? "text-violet-400" : "text-violet-600"
              )}>
                {call.name}
              </code>
              <span className={isDark ? "text-gray-600" : "text-gray-400"}>→</span>
              <span className={cn("truncate", isDark ? "text-gray-400" : "text-gray-600")}>
                {call.args}
              </span>
              <span className={cn(
                "ml-auto font-mono shrink-0",
                isDark ? "text-gray-600" : "text-gray-400"
              )}>
                {call.duration}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 消息
function Message({ message, theme }: { message: typeof mockMessages[0]; theme: Theme }) {
  const isUser = message.role === 'user';
  const isDark = theme === 'dark';
  const [showActions, setShowActions] = useState(false);
  
  return (
    <div 
      className="py-4 group"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 时间戳和角色 - 左对齐 */}
      <div className="flex items-center gap-3 mb-2">
        <span className={cn(
          "text-xs font-mono",
          isDark ? "text-gray-600" : "text-gray-400"
        )}>
          {message.time}
        </span>
        <div className={cn(
          "px-2 py-0.5 rounded text-xs font-medium",
          isUser
            ? isDark ? "bg-blue-500/20 text-blue-400" : "bg-blue-100 text-blue-600"
            : isDark ? "bg-violet-500/20 text-violet-400" : "bg-violet-100 text-violet-600"
        )}>
          {isUser ? 'USER' : 'ASSISTANT'}
        </div>
        
        {/* 操作按钮 */}
        <div className={cn(
          "flex items-center gap-1 ml-auto transition-opacity",
          showActions ? "opacity-100" : "opacity-0"
        )}>
          <button className={cn(
            "p-1 rounded transition-colors",
            isDark ? "hover:bg-white/10 text-gray-500" : "hover:bg-gray-200 text-gray-400"
          )}>
            <Copy className="w-3.5 h-3.5" />
          </button>
          {!isUser && (
            <button className={cn(
              "p-1 rounded transition-colors",
              isDark ? "hover:bg-white/10 text-gray-500" : "hover:bg-gray-200 text-gray-400"
            )}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      
      {/* 工具调用 */}
      {'toolCalls' in message && <ToolCalls calls={message.toolCalls} theme={theme} />}
      
      {/* 内容 */}
      <div className={cn(
        "text-[15px] leading-[1.7] whitespace-pre-wrap",
        isDark ? "text-gray-200" : "text-gray-800"
      )}>
        {message.content}
      </div>
    </div>
  );
}

// 输入框
function InputArea({ theme }: { theme: Theme }) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<'chat' | 'agent'>('agent');
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "border-t p-4",
      isDark ? "border-[#1f1f23]" : "border-gray-200"
    )}>
      <div className="max-w-3xl mx-auto">
        {/* 模式切换 */}
        <div className="flex items-center gap-2 mb-3">
          <div className={cn(
            "inline-flex items-center rounded-lg p-0.5",
            isDark ? "bg-[#1a1a1d]" : "bg-gray-100"
          )}>
            <button
              onClick={() => setMode('chat')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                mode === 'chat'
                  ? isDark ? "bg-white/10 text-white" : "bg-white text-gray-900 shadow"
                  : isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-500 hover:text-gray-700"
              )}
            >
              对话
            </button>
            <button
              onClick={() => setMode('agent')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5",
                mode === 'agent'
                  ? isDark ? "bg-white/10 text-white" : "bg-white text-gray-900 shadow"
                  : isDark ? "text-gray-500 hover:text-gray-300" : "text-gray-500 hover:text-gray-700"
              )}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Agent
            </button>
          </div>
          
          <button className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
            isDark ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-500"
          )}>
            <Globe className="w-3.5 h-3.5" />
            联网
          </button>
        </div>
        
        {/* 输入框 */}
        <div className={cn(
          "flex items-end gap-3 p-3 rounded-xl border transition-colors",
          isDark 
            ? "bg-[#1a1a1d] border-[#2a2a2d] focus-within:border-violet-500/50" 
            : "bg-white border-gray-200 focus-within:border-violet-500"
        )}>
          <button className={cn(
            "p-2 rounded-lg transition-colors shrink-0",
            isDark ? "hover:bg-white/10 text-gray-500" : "hover:bg-gray-100 text-gray-400"
          )}>
            <Paperclip className="w-4 h-4" />
          </button>
          
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="输入消息，或使用 / 调用命令..."
            rows={1}
            className={cn(
              "flex-1 resize-none outline-none text-sm leading-relaxed",
              isDark ? "bg-transparent text-gray-200 placeholder:text-gray-600" : "bg-transparent text-gray-800 placeholder:text-gray-400"
            )}
          />
          
          <div className="flex items-center gap-1 shrink-0">
            <button className={cn(
              "p-2 rounded-lg transition-colors",
              isDark ? "hover:bg-white/10 text-gray-500" : "hover:bg-gray-100 text-gray-400"
            )}>
              <Command className="w-4 h-4" />
            </button>
            <button className={cn(
              "p-2 rounded-lg transition-colors",
              value.trim()
                ? "bg-violet-600 text-white hover:bg-violet-500"
                : isDark ? "bg-white/5 text-gray-600" : "bg-gray-100 text-gray-400"
            )}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* 快捷键提示 */}
        <div className={cn(
          "flex items-center gap-4 mt-2 text-[10px]",
          isDark ? "text-gray-600" : "text-gray-400"
        )}>
          <span className="flex items-center gap-1">
            <Keyboard className="w-3 h-3" />
            <kbd className="px-1 rounded bg-black/10">⌘↵</kbd> 发送
          </span>
          <span>
            <kbd className="px-1 rounded bg-black/10">/</kbd> 命令
          </span>
          <span>
            <kbd className="px-1 rounded bg-black/10">@</kbd> MCP
          </span>
        </div>
      </div>
    </div>
  );
}

// 主页面
export default function LinearCleanPreview() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState('1');
  
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-screen flex overflow-hidden",
      isDark ? "bg-[#0f0f10]" : "bg-white"
    )}>
      <Sidebar
        isOpen={sidebarOpen}
        theme={theme}
        activeId={activeId}
        onSelect={setActiveId}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className={cn(
          "flex items-center justify-between px-4 py-2 border-b",
          isDark ? "border-[#1f1f23]" : "border-gray-200"
        )}>
          <div className="flex items-center gap-3">
            <h1 className={cn("font-semibold", isDark ? "text-white" : "text-gray-900")}>
              新对话 15:34
            </h1>
            <span className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs",
              isDark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-600"
            )}>
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              高优先级
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isDark ? "hover:bg-white/10 text-gray-400" : "hover:bg-gray-100 text-gray-500"
              )}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            <Link 
              href="/dev-tools/chat-redesign"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors",
                isDark ? "hover:bg-white/10 text-gray-400" : "hover:bg-gray-100 text-gray-500"
              )}
            >
              <ArrowLeft className="w-3 h-3" />
              返回
            </Link>
          </div>
        </div>
        
        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-6">
          <div className="max-w-3xl mx-auto">
            {mockMessages.map((msg) => (
              <Message key={msg.id} message={msg} theme={theme} />
            ))}
          </div>
        </div>
        
        <InputArea theme={theme} />
      </div>
    </div>
  );
}
