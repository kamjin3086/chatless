"use client";

import React, { useState, useRef } from 'react';
import { 
  ArrowLeft, Plus, Settings, Search, MoreHorizontal, Send, Paperclip, 
  Check, X, Loader2, Copy, RotateCcw, ChevronRight, ChevronDown,
  Moon, Sun, Star, Trash2, Hash, AtSign, Smile, Bold, Italic,
  Link2, Code, List, MessageCircle, Bell, Home, Bookmark, Clock,
  Users, Folder, MoreVertical, Edit2, ExternalLink, Forward
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案7: 协作通讯风格 (Slack Inspired)
 * 
 * 设计理念：
 * - 紧凑的消息布局，高信息密度
 * - 明确的时间分隔和线程组织
 * - 丰富的快捷操作和表情反馈
 * - 频道/对话列表清晰分类
 * - 状态指示器和在线状态
 */

type Theme = 'light' | 'dark';

const mockChannels = [
  { id: 'home', name: '首页', icon: Home, type: 'nav' },
  { id: 'activity', name: '活动', icon: Bell, type: 'nav' },
  { id: 'saved', name: '已保存', icon: Bookmark, type: 'nav' },
];

const mockConversations = [
  { id: '1', name: '新对话 15:34', unread: 2, isActive: true },
  { id: '2', name: 'API设计讨论', unread: 0 },
  { id: '3', name: '代码审查', unread: 5 },
  { id: '4', name: '项目规划', unread: 0 },
  { id: '5', name: '技术选型', unread: 0 },
];

const mockMessages = [
  {
    id: '1',
    role: 'user' as const,
    content: '读取我的桌面，列出其中所有的文档名',
    time: '下午 3:34',
    reactions: [{ emoji: '👍', count: 1 }],
  },
  {
    id: '2',
    role: 'assistant' as const,
    content: '正在读取桌面目录...',
    time: '下午 3:34',
    toolCalls: [
      { id: 't1', name: 'filesystem.list_directory', status: 'success' as const },
      { id: 't2', name: 'filesystem.filter_files', status: 'success' as const },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `您的桌面包含以下文件：

**快捷方式 (8个)**
\`\`\`
Chatless.lnk
Cherry Studio.lnk
Clash Verge.lnk
Cursor.lnk
DBeaver.lnk
Visual Studio Code.lnk
Notion.lnk
chatlog.exe - 快捷方式.lnk
\`\`\`

**文件夹 (3个)**
• 项目文档
• 临时文件  
• 截图`,
    time: '下午 3:35',
    reactions: [{ emoji: '✅', count: 1 }, { emoji: '🎉', count: 2 }],
  },
];

// 侧边栏
function Sidebar({ 
  isOpen, 
  theme, 
  activeId,
  onSelect 
}: { 
  isOpen: boolean;
  theme: Theme;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const isDark = theme === 'dark';
  const [expandedSections, setExpandedSections] = useState({ channels: true, direct: true });
  
  const toggleSection = (section: 'channels' | 'direct') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };
  
  return (
    <div className={cn(
      "h-full flex flex-col transition-all duration-200",
      isOpen ? "w-60" : "w-0 overflow-hidden",
      isDark ? "bg-[#1a1d21]" : "bg-[#3f0f40]",
    )}>
      {/* 工作区头部 */}
      <div className={cn(
        "px-4 py-3 flex items-center justify-between border-b",
        isDark ? "border-neutral-800" : "border-[#522653]"
      )}>
        <div className="flex items-center gap-2">
          <span className={cn(
            "font-bold text-lg",
            isDark ? "text-white" : "text-white"
          )}>
            Chatless
          </span>
          <ChevronDown className="w-4 h-4 text-white/60" />
        </div>
        <button className={cn(
          "p-1.5 rounded-lg",
          isDark ? "hover:bg-neutral-700 text-neutral-400" : "hover:bg-white/10 text-white/60"
        )}>
          <Edit2 className="w-4 h-4" />
        </button>
      </div>
      
      {/* 导航项 */}
      <div className="px-2 py-2">
        {mockChannels.map(item => (
          <button
            key={item.id}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
              isDark ? "hover:bg-neutral-800 text-neutral-300" : "hover:bg-white/10 text-white/80"
            )}
          >
            <item.icon className="w-4 h-4" />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      
      {/* 分隔线 */}
      <div className={cn("mx-4 border-t", isDark ? "border-neutral-800" : "border-[#522653]")} />
      
      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* 对话分类 */}
        <button
          onClick={() => toggleSection('channels')}
          className={cn(
            "w-full flex items-center gap-1 px-2 py-1 text-sm transition-colors",
            isDark ? "text-neutral-400 hover:text-neutral-200" : "text-white/60 hover:text-white"
          )}
        >
          <ChevronRight className={cn("w-3 h-3 transition-transform", expandedSections.channels && "rotate-90")} />
          <span>对话</span>
        </button>
        
        {expandedSections.channels && (
          <div className="mt-1">
            {mockConversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1 rounded-md text-sm transition-colors",
                  conv.isActive
                    ? isDark ? "bg-[#1164a3] text-white" : "bg-[#1164a3] text-white"
                    : isDark ? "hover:bg-neutral-800 text-neutral-300" : "hover:bg-white/10 text-white/80"
                )}
              >
                <MessageCircle className="w-4 h-4" />
                <span className="flex-1 text-left truncate">{conv.name}</span>
                {conv.unread > 0 && (
                  <span className={cn(
                    "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
                    isDark ? "bg-red-500 text-white" : "bg-red-500 text-white"
                  )}>
                    {conv.unread}
                  </span>
                )}
              </button>
            ))}
            
            <button className={cn(
              "w-full flex items-center gap-2 px-3 py-1 rounded-md text-sm transition-colors mt-1",
              isDark ? "text-neutral-500 hover:text-neutral-300" : "text-white/40 hover:text-white/80"
            )}>
              <Plus className="w-4 h-4" />
              <span>新建对话</span>
            </button>
          </div>
        )}
      </div>
      
      {/* 底部用户信息 */}
      <div className={cn(
        "px-3 py-2 border-t flex items-center gap-2",
        isDark ? "border-neutral-800" : "border-[#522653]"
      )}>
        <div className="relative">
          <div className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold",
            isDark ? "bg-green-600 text-white" : "bg-green-600 text-white"
          )}>
            U
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#1a1d21]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("text-sm font-medium truncate", isDark ? "text-white" : "text-white")}>
            用户
          </div>
          <div className={cn("text-xs truncate", isDark ? "text-neutral-400" : "text-white/60")}>
            在线
          </div>
        </div>
      </div>
    </div>
  );
}

// 工具调用状态
function ToolCallStatus({ calls, theme }: { calls: typeof mockMessages[1]['toolCalls']; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  const isDark = theme === 'dark';
  
  if (!calls) return null;
  
  return (
    <div className={cn(
      "inline-flex items-center gap-1 px-2 py-1 rounded text-xs mb-2",
      isDark ? "bg-neutral-800" : "bg-gray-100"
    )}>
      <Check className="w-3 h-3 text-green-500" />
      <span className={isDark ? "text-neutral-400" : "text-gray-600"}>
        {calls.length}个工具调用完成
      </span>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn("ml-1", isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-700")}
      >
        {expanded ? '收起' : '详情'}
      </button>
      
      {expanded && (
        <div className={cn(
          "absolute left-0 top-full mt-1 p-2 rounded-lg shadow-lg border z-10 w-64",
          isDark ? "bg-neutral-900 border-neutral-700" : "bg-white border-gray-200"
        )}>
          {calls.map(call => (
            <div key={call.id} className="flex items-center gap-2 py-1 text-xs">
              <Check className="w-3 h-3 text-green-500" />
              <code className={isDark ? "text-neutral-300" : "text-gray-700"}>{call.name}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 消息操作栏
function MessageActions({ theme, onReply }: { theme: Theme; onReply: () => void }) {
  const isDark = theme === 'dark';
  
  const actions = [
    { icon: Smile, label: '添加反应' },
    { icon: MessageCircle, label: '回复', onClick: onReply },
    { icon: Forward, label: '转发' },
    { icon: Bookmark, label: '保存' },
    { icon: MoreVertical, label: '更多' },
  ];
  
  return (
    <div className={cn(
      "absolute -top-4 right-0 flex items-center gap-0.5 px-1 py-0.5 rounded-lg shadow-lg border opacity-0 group-hover:opacity-100 transition-opacity",
      isDark ? "bg-neutral-800 border-neutral-700" : "bg-white border-gray-200"
    )}>
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={action.onClick}
          className={cn(
            "p-1.5 rounded transition-colors",
            isDark ? "hover:bg-neutral-700 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
          )}
          title={action.label}
        >
          <action.icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}

// 表情反应
function Reactions({ reactions, theme }: { reactions?: { emoji: string; count: number }[]; theme: Theme }) {
  const isDark = theme === 'dark';
  
  if (!reactions || reactions.length === 0) return null;
  
  return (
    <div className="flex items-center gap-1 mt-1">
      {reactions.map((reaction, i) => (
        <button
          key={i}
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors",
            isDark 
              ? "bg-neutral-800 border-neutral-700 hover:border-neutral-600" 
              : "bg-gray-100 border-gray-200 hover:border-gray-300"
          )}
        >
          <span>{reaction.emoji}</span>
          <span className={isDark ? "text-neutral-400" : "text-gray-600"}>{reaction.count}</span>
        </button>
      ))}
      <button className={cn(
        "p-1 rounded-full transition-colors",
        isDark ? "hover:bg-neutral-800 text-neutral-500" : "hover:bg-gray-100 text-gray-400"
      )}>
        <Smile className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// 消息组件
function Message({ message, theme }: { message: typeof mockMessages[0]; theme: Theme }) {
  const isUser = message.role === 'user';
  const isDark = theme === 'dark';
  const [showThread, setShowThread] = useState(false);
  
  return (
    <div className="group relative px-5 py-2 hover:bg-black/5 dark:hover:bg-white/5">
      <MessageActions theme={theme} onReply={() => setShowThread(true)} />
      
      <div className="flex gap-3">
        {/* 头像 */}
        <div className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0",
          isUser
            ? "bg-green-600 text-white"
            : isDark ? "bg-gradient-to-br from-purple-600 to-pink-600 text-white" : "bg-gradient-to-br from-purple-500 to-pink-500 text-white"
        )}>
          {isUser ? 'U' : 'AI'}
        </div>
        
        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className={cn(
              "font-bold text-sm",
              isDark ? "text-neutral-100" : "text-gray-900"
            )}>
              {isUser ? '你' : 'Assistant'}
            </span>
            <span className={cn("text-xs", isDark ? "text-neutral-500" : "text-gray-500")}>
              {message.time}
            </span>
          </div>
          
          {/* 工具调用 */}
          {'toolCalls' in message && (
            <div className="relative">
              <ToolCallStatus calls={message.toolCalls} theme={theme} />
            </div>
          )}
          
          {/* 消息文本 */}
          <div className={cn(
            "text-[15px] leading-relaxed whitespace-pre-wrap",
            isDark ? "text-neutral-200" : "text-gray-800"
          )}>
            {message.content}
          </div>
          
          {/* 反应 */}
          <Reactions reactions={message.reactions} theme={theme} />
        </div>
      </div>
    </div>
  );
}

// 时间分隔线
function TimeDivider({ time, theme }: { time: string; theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="flex items-center gap-4 px-5 py-2">
      <div className={cn("flex-1 h-px", isDark ? "bg-neutral-800" : "bg-gray-200")} />
      <span className={cn(
        "text-xs font-medium px-3 py-1 rounded-full border",
        isDark ? "bg-neutral-900 border-neutral-800 text-neutral-400" : "bg-white border-gray-200 text-gray-500"
      )}>
        {time}
      </span>
      <div className={cn("flex-1 h-px", isDark ? "bg-neutral-800" : "bg-gray-200")} />
    </div>
  );
}

// 输入框
function InputArea({ theme }: { theme: Theme }) {
  const [value, setValue] = useState('');
  const isDark = theme === 'dark';
  
  const formatButtons = [
    { icon: Bold, label: '粗体' },
    { icon: Italic, label: '斜体' },
    { icon: Code, label: '代码' },
    { icon: Link2, label: '链接' },
    { icon: List, label: '列表' },
  ];
  
  return (
    <div className="px-5 pb-4">
      <div className={cn(
        "rounded-lg border overflow-hidden",
        isDark ? "bg-neutral-900 border-neutral-700" : "bg-white border-gray-300"
      )}>
        {/* 输入区 */}
        <div className="p-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="发送消息到 #新对话..."
            rows={2}
            className={cn(
              "w-full resize-none outline-none text-[15px]",
              isDark ? "bg-transparent text-neutral-100 placeholder:text-neutral-500" : "bg-transparent text-gray-800 placeholder:text-gray-400"
            )}
          />
        </div>
        
        {/* 工具栏 */}
        <div className={cn(
          "flex items-center justify-between px-3 py-2 border-t",
          isDark ? "border-neutral-800" : "border-gray-200"
        )}>
          <div className="flex items-center gap-1">
            <button className={cn(
              "p-1.5 rounded transition-colors",
              isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
            )}>
              <Plus className="w-4 h-4" />
            </button>
            
            <div className={cn("w-px h-5 mx-1", isDark ? "bg-neutral-800" : "bg-gray-200")} />
            
            {formatButtons.map((btn, i) => (
              <button
                key={i}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
                )}
                title={btn.label}
              >
                <btn.icon className="w-4 h-4" />
              </button>
            ))}
            
            <div className={cn("w-px h-5 mx-1", isDark ? "bg-neutral-800" : "bg-gray-200")} />
            
            <button className={cn(
              "p-1.5 rounded transition-colors",
              isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
            )}>
              <AtSign className="w-4 h-4" />
            </button>
            <button className={cn(
              "p-1.5 rounded transition-colors",
              isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
            )}>
              <Smile className="w-4 h-4" />
            </button>
            <button className={cn(
              "p-1.5 rounded transition-colors",
              isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
            )}>
              <Paperclip className="w-4 h-4" />
            </button>
          </div>
          
          <button className={cn(
            "p-2 rounded-lg transition-colors",
            value.trim()
              ? "bg-green-600 text-white hover:bg-green-500"
              : isDark ? "bg-neutral-800 text-neutral-500" : "bg-gray-200 text-gray-400"
          )}>
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// 主页面
export default function SlackInspiredPreview() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState('1');
  
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-screen flex overflow-hidden",
      isDark ? "bg-[#1a1d21]" : "bg-white"
    )}>
      {/* 侧边栏 */}
      <Sidebar
        isOpen={sidebarOpen}
        theme={theme}
        activeId={activeId}
        onSelect={setActiveId}
      />
      
      {/* 主内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className={cn(
          "flex items-center justify-between px-4 py-2 border-b",
          isDark ? "border-neutral-800" : "border-gray-200"
        )}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={cn(
                "p-1.5 rounded transition-colors",
                isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
              )}
            >
              <Hash className="w-4 h-4" />
            </button>
            <div>
              <h1 className={cn("font-bold", isDark ? "text-white" : "text-gray-900")}>
                新对话 15:34
              </h1>
              <div className={cn("text-xs flex items-center gap-2", isDark ? "text-neutral-400" : "text-gray-500")}>
                <span>qwen3-vl-30b</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  <span>1</span>
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
              )}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            <Link 
              href="/dev-tools/chat-redesign"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors",
                isDark ? "hover:bg-neutral-800 text-neutral-400" : "hover:bg-gray-100 text-gray-500"
              )}
            >
              <ArrowLeft className="w-3 h-3" />
              <span>返回</span>
            </Link>
          </div>
        </div>
        
        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto">
          <TimeDivider time="今天" theme={theme} />
          {mockMessages.map((msg) => (
            <Message key={msg.id} message={msg} theme={theme} />
          ))}
        </div>
        
        {/* 输入区域 */}
        <InputArea theme={theme} />
      </div>
    </div>
  );
}
