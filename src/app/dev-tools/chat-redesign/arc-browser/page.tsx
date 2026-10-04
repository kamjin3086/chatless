"use client";

import React, { useState } from 'react';
import { 
  ArrowLeft, Plus, Search, Send, Paperclip, 
  Check, X, Loader2, Copy, RotateCcw, ChevronRight, ChevronDown,
  Moon, Sun, Star, Trash2, Settings, MessageSquare, Image,
  Sparkles, Globe, Hash, Mic, Camera, Smile, MoreHorizontal,
  Home, Clock, Bookmark, Download, Share2, PanelLeftClose,
  Palette, Layers, Zap, ChevronUp, ExternalLink, Pin
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案10: 弧形现代风格 (Arc Browser)
 * 
 * 设计理念：
 * - 借鉴Arc浏览器的大胆设计
 * - 丰富但和谐的色彩运用
 * - 圆润的形状和空间层次
 * - 个性化和可定制感
 * - 创新的布局和交互模式
 */

type Theme = 'light' | 'dark';

// 预设的主题色
const themeColors = [
  { id: 'violet', primary: 'from-violet-500 to-purple-600', sidebar: 'bg-violet-950', accent: 'violet' },
  { id: 'blue', primary: 'from-blue-500 to-cyan-500', sidebar: 'bg-blue-950', accent: 'blue' },
  { id: 'rose', primary: 'from-rose-500 to-pink-600', sidebar: 'bg-rose-950', accent: 'rose' },
  { id: 'emerald', primary: 'from-emerald-500 to-teal-500', sidebar: 'bg-emerald-950', accent: 'emerald' },
  { id: 'orange', primary: 'from-orange-500 to-amber-500', sidebar: 'bg-orange-950', accent: 'orange' },
];

const mockSpaces = [
  { id: 'personal', name: '个人', color: 'bg-violet-500', icon: '🏠' },
  { id: 'work', name: '工作', color: 'bg-blue-500', icon: '💼' },
  { id: 'research', name: '研究', color: 'bg-emerald-500', icon: '🔬' },
];

const mockConversations = [
  { id: '1', title: '新对话 15:34', isPinned: true, time: '刚刚' },
  { id: '2', title: 'API设计讨论', isPinned: true, time: '14分钟前' },
  { id: '3', title: '代码审查反馈', isPinned: false, time: '1小时前' },
  { id: '4', title: '项目规划会议', isPinned: false, time: '3小时前' },
  { id: '5', title: '技术选型分析', isPinned: false, time: '昨天' },
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
    content: '正在扫描桌面文件...',
    time: '15:34',
    toolCalls: [
      { name: '文件扫描', status: 'success' as const },
      { name: '格式化输出', status: 'success' as const },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `已完成桌面扫描！以下是您的桌面内容：

📁 **文件夹**
• 项目文档
• 临时文件
• 截图

📄 **快捷方式**
• Chatless
• Cherry Studio
• Clash Verge
• Cursor
• DBeaver
• Visual Studio Code
• Notion
• chatlog

共发现 **3** 个文件夹和 **8** 个快捷方式。`,
    time: '15:35',
  },
];

// 侧边栏
function Sidebar({ 
  isOpen, 
  theme, 
  colorScheme,
  activeId,
  onSelect,
  onToggle
}: { 
  isOpen: boolean;
  theme: Theme;
  colorScheme: typeof themeColors[0];
  activeId: string;
  onSelect: (id: string) => void;
  onToggle: () => void;
}) {
  const isDark = theme === 'dark';
  const [activeSpace, setActiveSpace] = useState('personal');
  const [showSpaceMenu, setShowSpaceMenu] = useState(false);
  
  const pinnedConvs = mockConversations.filter(c => c.isPinned);
  const recentConvs = mockConversations.filter(c => !c.isPinned);
  
  return (
    <div className={cn(
      "h-full flex transition-all duration-200 overflow-hidden",
      isOpen ? "w-72" : "w-0"
    )}>
      <div className={cn(
        "w-72 h-full flex flex-col",
        isDark ? colorScheme.sidebar : "bg-slate-50",
        "bg-gradient-to-b from-black/20 to-transparent"
      )}>
        {/* 空间选择器 */}
        <div className="p-3">
          <div className="relative">
            <button
              onClick={() => setShowSpaceMenu(!showSpaceMenu)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors",
                isDark ? "bg-white/10 hover:bg-white/20" : "bg-white hover:bg-slate-50 shadow-sm"
              )}
            >
              <span className="text-xl">{mockSpaces.find(s => s.id === activeSpace)?.icon}</span>
              <span className={cn(
                "font-medium",
                isDark ? "text-white" : "text-slate-900"
              )}>
                {mockSpaces.find(s => s.id === activeSpace)?.name}
              </span>
              <ChevronDown className={cn(
                "w-4 h-4 ml-auto transition-transform",
                showSpaceMenu && "rotate-180",
                isDark ? "text-white/70" : "text-slate-400"
              )} />
            </button>
            
            {showSpaceMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSpaceMenu(false)} />
                <div className={cn(
                  "absolute left-0 right-0 top-full mt-2 p-2 rounded-xl shadow-xl z-50",
                  isDark ? "bg-slate-900 border border-white/10" : "bg-white border border-slate-200"
                )}>
                  {mockSpaces.map((space) => (
                    <button
                      key={space.id}
                      onClick={() => {
                        setActiveSpace(space.id);
                        setShowSpaceMenu(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                        activeSpace === space.id
                          ? isDark ? "bg-white/10" : "bg-slate-100"
                          : isDark ? "hover:bg-white/5" : "hover:bg-slate-50"
                      )}
                    >
                      <span className="text-lg">{space.icon}</span>
                      <span className={isDark ? "text-white" : "text-slate-900"}>{space.name}</span>
                      <div className={cn("w-3 h-3 rounded-full ml-auto", space.color)} />
                    </button>
                  ))}
                  <div className={cn("my-2 border-t", isDark ? "border-white/10" : "border-slate-200")} />
                  <button className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    isDark ? "text-white/70 hover:bg-white/5" : "text-slate-500 hover:bg-slate-50"
                  )}>
                    <Plus className="w-4 h-4" />
                    <span>新建空间</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* 搜索和新建 */}
        <div className="px-3 pb-3 space-y-2">
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-xl",
            isDark ? "bg-white/5 text-white/60" : "bg-white/90 text-slate-400"
          )}>
            <Search className="w-4 h-4" />
            <span className="text-sm">搜索...</span>
            <kbd className={cn(
              "ml-auto text-[10px] px-1.5 py-0.5 rounded-md",
              isDark ? "bg-white/10" : "bg-slate-100"
            )}>⌘K</kbd>
          </div>
          
          <button className={cn(
            "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium transition-colors",
            `bg-gradient-to-r ${colorScheme.primary}`,
            "text-white shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
          )}>
            <Plus className="w-4 h-4" />
            <span>新对话</span>
          </button>
        </div>
        
        {/* 固定的对话 */}
        <div className="px-3 mb-2">
          <div className={cn(
            "flex items-center gap-2 px-2 py-1 text-[11px] font-medium uppercase tracking-wider",
            isDark ? "text-white/60" : "text-slate-400"
          )}>
            <Pin className="w-3 h-3" />
            <span>固定</span>
          </div>
          <div className="space-y-0.5 mt-1">
            {pinnedConvs.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all",
                  activeId === conv.id
                    ? isDark ? "bg-white/20 text-white" : "bg-white shadow-md text-slate-900"
                    : isDark ? "hover:bg-white/5 text-white/90" : "hover:bg-white/70 text-slate-700"
                )}
              >
                <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                <span className="flex-1 truncate text-sm">{conv.title}</span>
              </button>
            ))}
          </div>
        </div>
        
        {/* 最近的对话 */}
        <div className="flex-1 overflow-y-auto px-3">
          <div className={cn(
            "flex items-center gap-2 px-2 py-1 text-[11px] font-medium uppercase tracking-wider",
            isDark ? "text-white/60" : "text-slate-400"
          )}>
            <Clock className="w-3 h-3" />
            <span>最近</span>
          </div>
          <div className="space-y-0.5 mt-1">
            {recentConvs.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all group",
                  activeId === conv.id
                    ? isDark ? "bg-white/20 text-white" : "bg-white shadow-md text-slate-900"
                    : isDark ? "hover:bg-white/5 text-white/70" : "hover:bg-white/70 text-slate-600"
                )}
              >
                <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                <span className="flex-1 truncate text-sm">{conv.title}</span>
                <span className={cn(
                  "text-xs opacity-0 group-hover:opacity-100 transition-opacity",
                  isDark ? "text-white/60" : "text-slate-400"
                )}>
                  {conv.time}
                </span>
              </button>
            ))}
          </div>
        </div>
        
        {/* 底部控制 */}
        <div className={cn(
          "p-3 border-t",
          isDark ? "border-white/10" : "border-slate-200"
        )}>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
            <button className={cn(
              "p-2 rounded-lg transition-colors",
              isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
            )}>
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 工具调用展示
function ToolCallBadges({ calls, theme, colorScheme }: { 
  calls: typeof mockMessages[1]['toolCalls']; 
  theme: Theme;
  colorScheme: typeof themeColors[0];
}) {
  const isDark = theme === 'dark';
  
  if (!calls) return null;
  
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {calls.map((call, i) => (
        <div 
          key={i}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
            isDark 
              ? "bg-white/10 text-white/90" 
              : "bg-slate-100 text-slate-700"
          )}
        >
          {call.status === 'success' ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Loader2 className="w-3 h-3 animate-spin" />
          )}
          <span>{call.name}</span>
        </div>
      ))}
    </div>
  );
}

// 消息组件
function Message({ 
  message, 
  theme,
  colorScheme
}: { 
  message: typeof mockMessages[0];
  theme: Theme;
  colorScheme: typeof themeColors[0];
}) {
  const isUser = message.role === 'user';
  const isDark = theme === 'dark';
  const [showActions, setShowActions] = useState(false);
  
  return (
    <div 
      className={cn(
        "py-4 group",
        isUser && "flex justify-end"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={cn(
        "max-w-[85%]",
        isUser && "text-right"
      )}>
        {/* 工具调用 */}
        {'toolCalls' in message && !isUser && (
          <ToolCallBadges calls={message.toolCalls} theme={theme} colorScheme={colorScheme} />
        )}
        
        {/* 消息气泡 */}
        <div className={cn(
          "inline-block rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap",
          isUser
            ? `bg-gradient-to-r ${colorScheme.primary} text-white shadow-lg`
            : isDark ? "bg-white/10 text-white/95" : "bg-slate-100 text-slate-800"
        )}>
          {message.content}
        </div>
        
        {/* 时间和操作 */}
        <div className={cn(
          "flex items-center gap-2 mt-1.5 transition-opacity",
          isUser ? "justify-end" : "justify-start",
          showActions ? "opacity-100" : "opacity-0"
        )}>
          <span className={cn("text-xs", isDark ? "text-white/60" : "text-slate-400")}>
            {message.time}
          </span>
          {!isUser && (
            <>
              <button className={cn(
                "p-1 rounded-md transition-colors",
                isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-200 text-slate-400"
              )}>
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button className={cn(
                "p-1 rounded-md transition-colors",
                isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-200 text-slate-400"
              )}>
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 输入框
function InputArea({ theme, colorScheme }: { theme: Theme; colorScheme: typeof themeColors[0] }) {
  const [value, setValue] = useState('');
  const [showCapabilities, setShowCapabilities] = useState(false);
  const isDark = theme === 'dark';
  
  const capabilities = [
    { id: 'agent', icon: Zap, label: 'Agent', active: true },
    { id: 'web', icon: Globe, label: '联网', active: false },
    { id: 'image', icon: Image, label: '图像', active: false },
  ];
  
  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto">
        {/* 能力切换 */}
        <div className="flex items-center gap-2 mb-3">
          {capabilities.map((cap) => (
            <button
              key={cap.id}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                cap.active
                  ? `bg-gradient-to-r ${colorScheme.primary} text-white shadow-md`
                  : isDark ? "bg-white/5 text-white/70 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              <cap.icon className="w-3.5 h-3.5" />
              <span>{cap.label}</span>
            </button>
          ))}
        </div>
        
        {/* 输入框 */}
        <div className={cn(
          "flex items-end gap-3 p-3 rounded-2xl border-2 transition-colors",
          isDark 
            ? "bg-white/5 border-white/10 focus-within:border-white/20" 
            : "bg-white border-slate-200 focus-within:border-slate-300 shadow-sm"
        )}>
          <div className="flex items-center gap-1">
            <button className={cn(
              "p-2 rounded-xl transition-colors",
              isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-100 text-slate-400"
            )}>
              <Paperclip className="w-4 h-4" />
            </button>
            <button className={cn(
              "p-2 rounded-xl transition-colors",
              isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-100 text-slate-400"
            )}>
              <Camera className="w-4 h-4" />
            </button>
          </div>
          
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="有什么我可以帮你的？"
            rows={1}
            className={cn(
              "flex-1 resize-none outline-none text-[15px] leading-relaxed",
              isDark ? "bg-transparent text-white placeholder:text-white/60" : "bg-transparent text-slate-800 placeholder:text-slate-400"
            )}
          />
          
          <div className="flex items-center gap-1">
            <button className={cn(
              "p-2 rounded-xl transition-colors",
              isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-slate-100 text-slate-400"
            )}>
              <Mic className="w-4 h-4" />
            </button>
            <button className={cn(
              "p-2.5 rounded-xl transition-all",
              value.trim()
                ? `bg-gradient-to-r ${colorScheme.primary} text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95`
                : isDark ? "bg-white/5 text-white/30" : "bg-slate-100 text-slate-300"
            )}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 颜色选择器
function ColorPicker({ 
  currentColor, 
  onColorChange,
  theme
}: { 
  currentColor: typeof themeColors[0];
  onColorChange: (color: typeof themeColors[0]) => void;
  theme: Theme;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isDark = theme === 'dark';
  
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "p-2 rounded-lg transition-colors",
          isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
        )}
        title="更换主题色"
      >
        <Palette className="w-4 h-4" />
      </button>
      
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className={cn(
            "absolute right-0 top-full mt-2 p-3 rounded-xl shadow-xl z-50",
            isDark ? "bg-slate-900 border border-white/10" : "bg-white border border-slate-200"
          )}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("text-xs font-medium", isDark ? "text-white/70" : "text-slate-500")}>
                主题色
              </span>
            </div>
            <div className="flex items-center gap-2">
              {themeColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => {
                    onColorChange(color);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-8 h-8 rounded-full bg-gradient-to-r transition-transform hover:scale-110",
                    color.primary,
                    currentColor.id === color.id && "ring-2 ring-offset-2 ring-white"
                  )}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 主页面
export default function ArcBrowserPreview() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [colorScheme, setColorScheme] = useState(themeColors[0]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState('1');
  
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-screen flex overflow-hidden",
      isDark ? "bg-slate-950" : "bg-slate-100"
    )}>
      {/* 侧边栏 */}
      <Sidebar
        isOpen={sidebarOpen}
        theme={theme}
        colorScheme={colorScheme}
        activeId={activeId}
        onSelect={setActiveId}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className={cn(
          "flex items-center justify-between px-4 py-3",
          isDark ? "bg-slate-900/50" : "bg-white/60",
          "backdrop-blur-sm"
        )}>
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className={cn(
                  "p-2 rounded-lg transition-colors",
                  isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
                )}
              >
                <Layers className="w-4 h-4" />
              </button>
            )}
            <h1 className={cn(
              "font-semibold",
              isDark ? "text-white" : "text-slate-900"
            )}>
              新对话 15:34
            </h1>
            <span className={cn(
              "px-2.5 py-1 rounded-full text-xs",
              isDark ? "bg-white/10 text-white/70" : "bg-slate-200 text-slate-600"
            )}>
              qwen3-vl-30b
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            {/* 颜色选择 */}
            <ColorPicker
              currentColor={colorScheme}
              onColorChange={setColorScheme}
              theme={theme}
            />
            
            {/* 主题切换 */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            <button className={cn(
              "p-2 rounded-lg transition-colors",
              isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
            )}>
              <Share2 className="w-4 h-4" />
            </button>
            
            <Link 
              href="/dev-tools/chat-redesign"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ml-2",
                isDark ? "hover:bg-white/10 text-white/70" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              <ArrowLeft className="w-3 h-3" />
              返回
            </Link>
          </div>
        </div>
        
        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-6">
          <div className="max-w-3xl mx-auto py-4">
            {mockMessages.map((msg) => (
              <Message key={msg.id} message={msg} theme={theme} colorScheme={colorScheme} />
            ))}
          </div>
        </div>
        
        {/* 输入区域 */}
        <InputArea theme={theme} colorScheme={colorScheme} />
      </div>
    </div>
  );
}
