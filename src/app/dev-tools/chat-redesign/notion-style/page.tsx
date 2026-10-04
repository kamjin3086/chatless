"use client";

import React, { useState } from 'react';
import { 
  ArrowLeft, Plus, Settings, Search, MoreHorizontal, Send, Paperclip, 
  Check, X, Loader2, Copy, RotateCcw, ChevronRight, ChevronDown,
  Moon, Sun, Star, Trash2, Archive, Share2, Download, Clock, 
  MessageSquare, Hash, Globe, Zap, PanelLeftClose, PanelLeft,
  MoreVertical, Edit3, Pin, FolderOpen, FileText, Tag, Filter,
  SortAsc, Upload, Import, SlidersHorizontal, Bot, Database,
  Shield, Plug, Info, ChevronUp, AlertCircle, CheckCircle,
  Keyboard, Command, BookOpen, Sparkles, ExternalLink, Home,
  Users, Bell, HelpCircle, LogOut, CreditCard, Palette
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案6: 结构化笔记风格 (Notion Style) - 完整版
 * 
 * 设计理念：
 * - 借鉴Notion的块状结构，每个元素都是独立的块
 * - 清晰的层级缩进和可折叠区域
 * - 干净的黑白灰调色板，亮暗双模式
 * - 悬停显示操作，保持界面整洁
 * - 侧边栏默认可见，可手动折叠
 */

type Theme = 'light' | 'dark';
type View = 'chat' | 'settings' | 'prompts';

// Mock数据
const mockConversations = [
  { id: '1', title: '新对话 15:34', time: '5分钟前', isActive: true, pinned: true },
  { id: '2', title: 'API设计讨论', time: '14分钟前', pinned: true },
  { id: '3', title: '代码审查反馈', time: '1小时前', pinned: false },
  { id: '4', title: '项目规划会议', time: '3小时前', pinned: false },
  { id: '5', title: '技术选型分析', time: '昨天', pinned: false },
  { id: '6', title: 'Bug修复记录', time: '昨天', pinned: false },
  { id: '7', title: '需求文档整理', time: '3天前', pinned: false },
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
    content: '我将为您列出桌面上的所有文档。首先，让我检查一下桌面目录的内容。',
    time: '15:34',
    toolCalls: [
      { id: 't1', name: '列目录', target: 'Desktop', status: 'success' as const, duration: '0.3s' },
      { id: 't2', name: '筛选文件', target: '*.lnk, *.txt, *.doc*', status: 'success' as const, duration: '0.1s' },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `您的桌面包含以下文档和快捷方式：

**文件（非目录）：**
• Chatless.lnk
• chatlog.exe - 快捷方式.lnk
• Cherry Studio.lnk
• Clash Verge.lnk
• Cursor.lnk
• DBeaver.lnk
• Visual Studio Code.lnk
• Notion.lnk

**文件夹：**
• 项目文档
• 临时文件
• 截图`,
    time: '15:35',
  },
];

const mockPrompts = [
  { id: '1', name: '代码审查', shortcut: 'review', description: '审查代码并给出改进建议', tags: ['编程', '审查'], uses: 42, favorite: true, content: '请审查以下代码，从代码质量、性能、安全性等方面给出详细的改进建议...' },
  { id: '2', name: '文档翻译', shortcut: 'trans', description: '将内容翻译成目标语言', tags: ['翻译'], uses: 28, favorite: true, content: '将以下内容翻译成中文，保持原文的语气和风格...' },
  { id: '3', name: '需求分析', shortcut: 'req', description: '分析需求并给出技术方案', tags: ['产品'], uses: 15, favorite: false, content: '分析以下需求，给出详细的技术方案和实现路径...' },
  { id: '4', name: 'Bug报告', shortcut: 'bug', description: '生成标准的Bug报告', tags: ['编程', '测试'], uses: 33, favorite: false, content: '根据以下信息生成标准的Bug报告，包含复现步骤、期望行为、实际行为...' },
  { id: '5', name: '会议纪要', shortcut: 'meeting', description: '整理会议内容为纪要', tags: ['办公'], uses: 21, favorite: false, content: '整理以下会议内容为正式的会议纪要，包含议题、讨论内容、决定事项、下一步行动...' },
  { id: '6', name: 'SQL生成', shortcut: 'sql', description: '根据需求生成SQL语句', tags: ['编程', '数据库'], uses: 56, favorite: true, content: '根据以下需求生成高效的SQL查询语句...' },
];

const settingsSections = [
  { id: 'general', name: '常规设置', icon: SlidersHorizontal, description: '语言、主题、快捷键等' },
  { id: 'models', name: 'AI 模型', icon: Bot, description: '配置 AI 服务提供商' },
  { id: 'knowledge', name: '知识库', icon: Database, description: '管理本地知识库' },
  { id: 'mcp', name: 'MCP 服务器', icon: Plug, description: '工具和能力扩展' },
  { id: 'web', name: '网络搜索', icon: Globe, description: '联网搜索配置' },
  { id: 'security', name: '隐私安全', icon: Shield, description: '权限和数据安全' },
  { id: 'advanced', name: '高级设置', icon: Settings, description: '开发者选项' },
  { id: 'about', name: '关于', icon: Info, description: '版本和更新' },
];

// ==================== 侧边栏组件 ====================

function Sidebar({ 
  isOpen, 
  onToggle, 
  theme,
  conversations,
  activeId,
  onSelect,
  currentView,
  onViewChange
}: { 
  isOpen: boolean;
  onToggle: () => void;
  theme: Theme;
  conversations: typeof mockConversations;
  activeId: string;
  onSelect: (id: string) => void;
  currentView: View;
  onViewChange: (view: View) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [expandedSections, setExpandedSections] = useState({ pinned: true, recent: true });
  
  const pinnedConvs = conversations.filter(c => c.pinned);
  const recentConvs = conversations.filter(c => !c.pinned);
  
  const isDark = theme === 'dark';
  
  const toggleSection = (section: 'pinned' | 'recent') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };
  
  return (
    <>
      {/* 侧边栏 */}
      <div className={cn(
        "h-full flex flex-col transition-all duration-200",
        isOpen ? "w-64" : "w-0 overflow-hidden",
        isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200",
        "border-r"
      )}>
        {/* 头部 */}
        <div className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold",
              isDark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"
            )}>
              C
            </div>
            <span className={cn(
              "text-sm font-medium",
              isDark ? "text-slate-200" : "text-slate-700"
            )}>
              Chatless
            </span>
          </div>
          <button 
            onClick={onToggle}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        
        {/* 搜索框 */}
        <div className="px-3 pb-2">
          <div className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm",
            isDark ? "bg-slate-800 text-slate-400" : "bg-white border border-slate-200 text-slate-500"
          )}>
            <Search className="w-3.5 h-3.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索..."
              className={cn(
                "flex-1 bg-transparent outline-none text-sm",
                isDark ? "placeholder:text-slate-500" : "placeholder:text-slate-400"
              )}
            />
            <kbd className={cn(
              "text-[10px] px-1 py-0.5 rounded-md",
              isDark ? "bg-slate-700 text-slate-500" : "bg-slate-100 text-slate-400"
            )}>⌘K</kbd>
          </div>
        </div>
        
        {/* 新建按钮 */}
        <div className="px-3 pb-2">
          <button className={cn(
            "w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors",
            isDark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-600"
          )}>
            <Plus className="w-4 h-4" />
            <span>新对话</span>
            <kbd className={cn(
              "ml-auto text-[10px] px-1 py-0.5 rounded-md",
              isDark ? "bg-slate-700 text-slate-500" : "bg-slate-100 text-slate-400"
            )}>⌘N</kbd>
          </button>
        </div>
        
        {/* 导航 */}
        <div className="px-3 pb-2 space-y-0.5">
          <button 
            onClick={() => onViewChange('chat')}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors",
              currentView === 'chat'
                ? isDark ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-900"
                : isDark ? "hover:bg-slate-800/50 text-slate-400" : "hover:bg-slate-100 text-slate-600"
            )}
          >
            <MessageSquare className="w-4 h-4" />
            <span>对话</span>
          </button>
          <button 
            onClick={() => onViewChange('prompts')}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors",
              currentView === 'prompts'
                ? isDark ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-900"
                : isDark ? "hover:bg-slate-800/50 text-slate-400" : "hover:bg-slate-100 text-slate-600"
            )}
          >
            <FileText className="w-4 h-4" />
            <span>提示词</span>
          </button>
          <button 
            onClick={() => onViewChange('settings')}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors",
              currentView === 'settings'
                ? isDark ? "bg-slate-800 text-slate-200" : "bg-slate-200 text-slate-900"
                : isDark ? "hover:bg-slate-800/50 text-slate-400" : "hover:bg-slate-100 text-slate-600"
            )}
          >
            <Settings className="w-4 h-4" />
            <span>设置</span>
          </button>
        </div>
        
        <div className={cn("mx-3 border-t", isDark ? "border-slate-800" : "border-slate-200")} />
        
        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {/* 置顶 */}
          {pinnedConvs.length > 0 && (
            <div className="mb-2">
              <button
                onClick={() => toggleSection('pinned')}
                className={cn(
                  "w-full flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wider rounded-md transition-colors",
                  isDark ? "text-slate-500 hover:bg-slate-800/50" : "text-slate-400 hover:bg-slate-100"
                )}
              >
                <ChevronRight className={cn(
                  "w-3 h-3 transition-transform",
                  expandedSections.pinned && "rotate-90"
                )} />
                <Pin className="w-3 h-3" />
                <span>置顶</span>
                <span className="ml-auto">{pinnedConvs.length}</span>
              </button>
              {expandedSections.pinned && (
                <div className="mt-1">
                  {pinnedConvs.map(conv => (
                    <ConversationItem
                      key={conv.id}
                      conv={conv}
                      isActive={activeId === conv.id && currentView === 'chat'}
                      theme={theme}
                      onSelect={() => { onSelect(conv.id); onViewChange('chat'); }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* 最近 */}
          <div>
            <button
              onClick={() => toggleSection('recent')}
              className={cn(
                "w-full flex items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wider rounded-md transition-colors",
                isDark ? "text-slate-500 hover:bg-slate-800/50" : "text-slate-400 hover:bg-slate-100"
              )}
            >
              <ChevronRight className={cn(
                "w-3 h-3 transition-transform",
                expandedSections.recent && "rotate-90"
              )} />
              <Clock className="w-3 h-3" />
              <span>最近</span>
              <span className="ml-auto">{recentConvs.length}</span>
            </button>
            {expandedSections.recent && (
              <div className="mt-1">
                {recentConvs.map(conv => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    isActive={activeId === conv.id && currentView === 'chat'}
                    theme={theme}
                    onSelect={() => { onSelect(conv.id); onViewChange('chat'); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ id: conv.id, x: e.clientX, y: e.clientY });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        
        {/* 底部 */}
        <div className={cn(
          "p-3 border-t",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
              isDark ? "bg-blue-600 text-white" : "bg-blue-500 text-white"
            )}>
              U
            </div>
            <div className="flex-1 min-w-0">
              <div className={cn("text-sm font-medium truncate", isDark ? "text-slate-200" : "text-slate-700")}>
                用户
              </div>
              <div className={cn("text-xs truncate", isDark ? "text-slate-500" : "text-slate-500")}>
                免费版
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenuDropdown
          x={contextMenu.x}
          y={contextMenu.y}
          theme={theme}
          onClose={() => setContextMenu(null)}
        />
      )}
      
      {/* 折叠时的展开按钮 */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className={cn(
            "absolute left-2 top-3 p-1.5 rounded-md transition-colors z-10",
            isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
          )}
        >
          <PanelLeft className="w-4 h-4" />
        </button>
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
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors mb-0.5",
        isActive
          ? isDark ? "bg-slate-800" : "bg-slate-200"
          : isDark ? "hover:bg-slate-800/50" : "hover:bg-slate-100"
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <MessageSquare className={cn(
        "w-4 h-4 shrink-0",
        isDark ? "text-slate-500" : "text-slate-400"
      )} />
      <span className={cn(
        "flex-1 text-sm truncate",
        isActive
          ? isDark ? "text-slate-100" : "text-slate-900"
          : isDark ? "text-slate-300" : "text-slate-600"
      )}>
        {conv.title}
      </span>
      {isHovered && (
        <button className={cn(
          "p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
          isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-slate-300 text-slate-500"
        )}>
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function ContextMenuDropdown({ x, y, theme, onClose }: { 
  x: number; 
  y: number; 
  theme: Theme;
  onClose: () => void;
}) {
  const isDark = theme === 'dark';
  
  const menuItems = [
    { icon: Pin, label: '置顶', shortcut: '⌘⇧P' },
    { icon: Edit3, label: '重命名', shortcut: '⌘R' },
    { icon: Star, label: '收藏', shortcut: '⌘S' },
    { icon: FolderOpen, label: '移动到...', shortcut: null },
    { type: 'divider' as const },
    { icon: Share2, label: '分享', shortcut: null },
    { icon: Download, label: '导出', shortcut: '⌘E' },
    { type: 'divider' as const },
    { icon: Archive, label: '归档', shortcut: null },
    { icon: Trash2, label: '删除', shortcut: '⌘⌫', danger: true },
  ];
  
  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className={cn(
          "fixed z-50 w-52 py-1 rounded-lg shadow-xl border",
          isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
        )}
        style={{ left: x, top: y }}
      >
        {menuItems.map((item, i) => (
          item.type === 'divider' ? (
            <div key={i} className={cn("my-1 border-t", isDark ? "border-slate-800" : "border-slate-100")} />
          ) : (
            <button
              key={i}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                item.danger
                  ? isDark ? "text-red-400 hover:bg-red-900/30" : "text-red-600 hover:bg-red-50"
                  : isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-50"
              )}
              onClick={onClose}
            >
              <item.icon className="w-4 h-4" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.shortcut && (
                <span className={cn("text-xs", isDark ? "text-slate-500" : "text-slate-400")}>
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

// ==================== 聊天视图组件 ====================

function ToolCallBlock({ calls, theme }: { calls: typeof mockMessages[1]['toolCalls']; theme: Theme }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isDark = theme === 'dark';
  
  if (!calls || calls.length === 0) return null;
  
  const allSuccess = calls.every(c => c.status === 'success');
  
  return (
    <div className={cn(
      "rounded-lg mb-3 overflow-hidden",
      isDark ? "bg-slate-800/50" : "bg-slate-100"
    )}>
      <button
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          isDark ? "hover:bg-slate-800" : "hover:bg-slate-200"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
        <div className={cn(
          "flex items-center gap-1.5",
          allSuccess 
            ? isDark ? "text-emerald-400" : "text-emerald-600"
            : isDark ? "text-amber-400" : "text-amber-600"
        )}>
          {allSuccess ? <Check className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{calls.length}个操作{allSuccess ? '已完成' : '执行中'}</span>
        </div>
        <span className={cn("text-xs ml-auto", isDark ? "text-slate-500" : "text-slate-400")}>
          {calls.reduce((acc, c) => acc + parseFloat(c.duration || '0'), 0).toFixed(1)}s
        </span>
      </button>
      
      {isExpanded && (
        <div className={cn(
          "border-t px-3 py-2 space-y-1.5",
          isDark ? "border-slate-700" : "border-slate-200"
        )}>
          {calls.map((call) => (
            <div key={call.id} className="flex items-center gap-2 text-sm">
              {call.status === 'success' ? (
                <Check className={cn("w-3.5 h-3.5", isDark ? "text-emerald-400" : "text-emerald-600")} />
              ) : call.status === 'error' ? (
                <X className="w-3.5 h-3.5 text-red-500" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
              )}
              <span className={isDark ? "text-slate-300" : "text-slate-600"}>{call.name}</span>
              <span className={isDark ? "text-slate-600" : "text-slate-400"}>→</span>
              <code className={cn(
                "text-xs px-1 py-0.5 rounded-md",
                isDark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"
              )}>
                {call.target}
              </code>
              <span className={cn("text-xs ml-auto", isDark ? "text-slate-500" : "text-slate-400")}>
                {call.duration}
              </span>
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
      className="group py-4"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 消息头 */}
      <div className="flex items-center gap-2 mb-2">
        <div className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center text-xs font-medium",
          isUser
            ? isDark ? "bg-blue-600 text-white" : "bg-blue-500 text-white"
            : isDark ? "bg-slate-700 text-slate-300" : "bg-slate-200 text-slate-600"
        )}>
          {isUser ? 'U' : 'AI'}
        </div>
        <span className={cn(
          "text-sm font-medium",
          isDark ? "text-slate-200" : "text-slate-700"
        )}>
          {isUser ? '你' : 'Assistant'}
        </span>
        <span className={cn("text-xs", isDark ? "text-slate-500" : "text-slate-400")}>
          {message.time}
        </span>
        
        {/* 操作按钮 */}
        <div className={cn(
          "flex items-center gap-0.5 ml-auto transition-opacity",
          showActions ? "opacity-100" : "opacity-0"
        )}>
          <button 
            onClick={handleCopy}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
            )}
            title="复制"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {!isUser && (
            <button 
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
              )}
              title="重试"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {/* 工具调用 */}
      {'toolCalls' in message && <ToolCallBlock calls={message.toolCalls} theme={theme} />}
      
      {/* 消息内容 */}
      <div className={cn(
        "text-[15px] leading-relaxed whitespace-pre-wrap pl-8",
        isDark ? "text-slate-300" : "text-slate-700"
      )}>
        {message.content}
      </div>
    </div>
  );
}

function InputArea({ theme }: { theme: Theme }) {
  const [value, setValue] = useState('');
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [mode, setMode] = useState<'chat' | 'agent'>('agent');
  const isDark = theme === 'dark';
  
  const capabilities = [
    { id: 'filesystem', name: '文件系统', enabled: true },
    { id: 'shell', name: 'Shell执行', enabled: true },
    { id: 'web', name: '网页搜索', enabled: false },
    { id: 'code', name: '代码分析', enabled: true },
    { id: 'image', name: '图像识别', enabled: false },
    { id: 'database', name: '数据库', enabled: false },
  ];
  
  return (
    <div className={cn(
      "border-t p-4",
      isDark ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-slate-50"
    )}>
      <div className="max-w-3xl mx-auto">
        {/* 模式和能力选择栏 */}
        <div className="flex items-center gap-2 mb-3">
          <div className={cn(
            "flex items-center rounded-lg p-0.5",
            isDark ? "bg-slate-800" : "bg-slate-200"
          )}>
            <button
              onClick={() => setMode('chat')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                mode === 'chat'
                  ? isDark ? "bg-slate-700 text-white" : "bg-white text-slate-900 shadow-sm"
                  : isDark ? "text-slate-400" : "text-slate-600"
              )}
            >
              对话
            </button>
            <button
              onClick={() => setMode('agent')}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                mode === 'agent'
                  ? isDark ? "bg-slate-700 text-white" : "bg-white text-slate-900 shadow-sm"
                  : isDark ? "text-slate-400" : "text-slate-600"
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              Agent
            </button>
          </div>
          
          <button
            onClick={() => setShowCapabilities(!showCapabilities)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors",
              showCapabilities
                ? isDark ? "bg-slate-700 text-slate-200" : "bg-slate-300 text-slate-700"
                : isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            <Plug className="w-3.5 h-3.5" />
            <span>能力</span>
            <ChevronDown className={cn("w-3 h-3 transition-transform", showCapabilities && "rotate-180")} />
          </button>
          
          <button className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors",
            isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          )}>
            <Globe className="w-3.5 h-3.5" />
            <span>联网</span>
          </button>
        </div>
        
        {/* 能力下拉面板 */}
        {showCapabilities && (
          <div className={cn(
            "mb-3 p-3 rounded-lg border",
            isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
          )}>
            <div className={cn("text-xs font-medium mb-2", isDark ? "text-slate-400" : "text-slate-500")}>
              启用的能力
            </div>
            <div className="grid grid-cols-3 gap-2">
              {capabilities.map((cap) => (
                <label key={cap.id} className={cn(
                  "flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors",
                  isDark ? "hover:bg-slate-700" : "hover:bg-slate-50"
                )}>
                  <input 
                    type="checkbox" 
                    defaultChecked={cap.enabled}
                    className="rounded-md border-slate-600"
                  />
                  <span className={cn("text-sm", isDark ? "text-slate-300" : "text-slate-600")}>
                    {cap.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        
        {/* 输入框 */}
        <div className={cn(
          "flex items-end gap-3 p-3 rounded-xl border",
          isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
        )}>
          <button className={cn(
            "p-2 rounded-lg transition-colors shrink-0",
            isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          )}>
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="输入消息... 使用 / 调用命令，@ 提及MCP"
            rows={1}
            className={cn(
              "flex-1 resize-none outline-none text-sm leading-relaxed",
              isDark ? "bg-transparent text-slate-200 placeholder:text-slate-500" : "bg-transparent text-slate-700 placeholder:text-slate-400"
            )}
            style={{ minHeight: '24px', maxHeight: '200px' }}
          />
          <button className={cn(
            "p-2 rounded-lg transition-colors shrink-0",
            value.trim()
              ? isDark ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-blue-500 text-white hover:bg-blue-600"
              : isDark ? "bg-slate-700 text-slate-500" : "bg-slate-200 text-slate-400"
          )}>
            <Send className="w-4 h-4" />
          </button>
        </div>
        
        {/* 快捷提示 */}
        <div className={cn(
          "flex items-center gap-4 mt-2 text-xs",
          isDark ? "text-slate-500" : "text-slate-400"
        )}>
          <span><kbd className={cn("px-1 py-0.5 rounded-md", isDark ? "bg-slate-800" : "bg-slate-100")}>⌘</kbd> + <kbd className={cn("px-1 py-0.5 rounded-md", isDark ? "bg-slate-800" : "bg-slate-100")}>↵</kbd> 发送</span>
          <span><kbd className={cn("px-1 py-0.5 rounded-md", isDark ? "bg-slate-800" : "bg-slate-100")}>/</kbd> 命令</span>
          <span><kbd className={cn("px-1 py-0.5 rounded-md", isDark ? "bg-slate-800" : "bg-slate-100")}>@</kbd> 提及MCP</span>
          <span><kbd className={cn("px-1 py-0.5 rounded-md", isDark ? "bg-slate-800" : "bg-slate-100")}>#</kbd> 技能</span>
        </div>
      </div>
    </div>
  );
}

// ==================== 设置视图组件 ====================

function SettingsView({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  const [activeSection, setActiveSection] = useState('general');
  
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 设置导航 */}
      <div className={cn(
        "w-56 border-r p-4 overflow-y-auto",
        isDark ? "border-slate-800" : "border-slate-200"
      )}>
        <h2 className={cn("text-lg font-semibold mb-4", isDark ? "text-slate-100" : "text-slate-900")}>
          设置
        </h2>
        <div className="space-y-1">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                activeSection === section.id
                  ? isDark ? "bg-slate-800 text-slate-100" : "bg-slate-200 text-slate-900"
                  : isDark ? "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <section.icon className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium">{section.name}</div>
                <div className={cn("text-xs mt-0.5", isDark ? "text-slate-500" : "text-slate-500")}>
                  {section.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      
      {/* 设置内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {activeSection === 'general' && <GeneralSettings theme={theme} />}
          {activeSection === 'models' && <ModelsSettings theme={theme} />}
          {activeSection === 'mcp' && <McpSettings theme={theme} />}
          {activeSection === 'security' && <SecuritySettings theme={theme} />}
          {activeSection === 'knowledge' && <KnowledgeSettings theme={theme} />}
          {activeSection === 'web' && <WebSearchSettings theme={theme} />}
          {activeSection === 'advanced' && <AdvancedSettings theme={theme} />}
          {activeSection === 'about' && <AboutSettings theme={theme} />}
        </div>
      </div>
    </div>
  );
}

function SettingSection({ title, description, theme, children }: { 
  title: string; 
  description?: string;
  theme: Theme; 
  children: React.ReactNode;
}) {
  const isDark = theme === 'dark';
  
  return (
    <div className="mb-8">
      <h3 className={cn("text-base font-semibold mb-1", isDark ? "text-slate-100" : "text-slate-900")}>
        {title}
      </h3>
      {description && (
        <p className={cn("text-sm mb-4", isDark ? "text-slate-400" : "text-slate-500")}>
          {description}
        </p>
      )}
      <div className={cn(
        "rounded-lg border p-4 space-y-4",
        isDark ? "border-slate-800 bg-slate-900/50" : "border-slate-200 bg-slate-50"
      )}>
        {children}
      </div>
    </div>
  );
}

function SettingRow({ label, description, theme, children }: { 
  label: string; 
  description?: string;
  theme: Theme; 
  children: React.ReactNode;
}) {
  const isDark = theme === 'dark';
  
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className={cn("text-sm font-medium", isDark ? "text-slate-200" : "text-slate-700")}>
          {label}
        </div>
        {description && (
          <div className={cn("text-xs mt-0.5", isDark ? "text-slate-500" : "text-slate-500")}>
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, theme }: { checked: boolean; onChange: (v: boolean) => void; theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "w-10 h-5 rounded-full transition-colors relative",
        checked
          ? "bg-blue-600"
          : isDark ? "bg-slate-700" : "bg-slate-300"
      )}
    >
      <div className={cn(
        "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
        checked ? "translate-x-5" : "translate-x-0.5"
      )} />
    </button>
  );
}

function SelectInput({ value, options, onChange, theme }: { 
  value: string; 
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  theme: Theme;
}) {
  const isDark = theme === 'dark';
  
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "px-3 py-1.5 rounded-md border text-sm outline-none",
        isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-300 text-slate-700"
      )}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function GeneralSettings({ theme }: { theme: Theme }) {
  const [autoSave, setAutoSave] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [restoreSession, setRestoreSession] = useState(true);
  
  return (
    <>
      <SettingSection title="外观" description="自定义应用的外观和语言" theme={theme}>
        <SettingRow label="语言" description="设置应用界面语言" theme={theme}>
          <SelectInput
            value="zh-CN"
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'en', label: 'English' },
              { value: 'ja', label: '日本語' },
            ]}
            onChange={() => {}}
            theme={theme}
          />
        </SettingRow>
        <SettingRow label="主题" description="选择亮色或暗色主题" theme={theme}>
          <SelectInput
            value="system"
            options={[
              { value: 'light', label: '亮色' },
              { value: 'dark', label: '暗色' },
              { value: 'system', label: '跟随系统' },
            ]}
            onChange={() => {}}
            theme={theme}
          />
        </SettingRow>
        <SettingRow label="字体大小" theme={theme}>
          <SelectInput
            value="14"
            options={[
              { value: '12', label: '12px' },
              { value: '14', label: '14px' },
              { value: '16', label: '16px' },
            ]}
            onChange={() => {}}
            theme={theme}
          />
        </SettingRow>
      </SettingSection>
      
      <SettingSection title="行为" description="自定义应用的行为方式" theme={theme}>
        <SettingRow label="发送快捷键" theme={theme}>
          <SelectInput
            value="cmd-enter"
            options={[
              { value: 'enter', label: 'Enter' },
              { value: 'cmd-enter', label: '⌘ + Enter' },
              { value: 'ctrl-enter', label: 'Ctrl + Enter' },
            ]}
            onChange={() => {}}
            theme={theme}
          />
        </SettingRow>
        <SettingRow label="自动保存" description="自动保存对话和设置" theme={theme}>
          <Toggle checked={autoSave} onChange={setAutoSave} theme={theme} />
        </SettingRow>
        <SettingRow label="显示时间戳" description="在消息旁显示发送时间" theme={theme}>
          <Toggle checked={showTimestamps} onChange={setShowTimestamps} theme={theme} />
        </SettingRow>
        <SettingRow label="恢复上次会话" description="启动时恢复上次的对话" theme={theme}>
          <Toggle checked={restoreSession} onChange={setRestoreSession} theme={theme} />
        </SettingRow>
      </SettingSection>
    </>
  );
}

function ModelsSettings({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  const providers = [
    { id: '1', name: 'LM Studio', status: 'connected', models: 3, endpoint: 'http://localhost:1234' },
    { id: '2', name: 'OpenAI', status: 'disconnected', models: 0, endpoint: '' },
    { id: '3', name: 'Anthropic', status: 'disconnected', models: 0, endpoint: '' },
  ];
  
  return (
    <>
      <SettingSection title="AI 服务提供商" description="配置 AI 模型服务" theme={theme}>
        <div className="space-y-2">
          {providers.map((p) => (
            <div 
              key={p.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                isDark ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-100"
              )}
            >
              <div className={cn(
                "w-2.5 h-2.5 rounded-full",
                p.status === 'connected' ? "bg-emerald-500" : "bg-slate-400"
              )} />
              <div className="flex-1">
                <div className={cn("text-sm font-medium", isDark ? "text-slate-200" : "text-slate-700")}>
                  {p.name}
                </div>
                <div className={cn("text-xs", isDark ? "text-slate-500" : "text-slate-500")}>
                  {p.status === 'connected' ? `${p.models} 个模型可用 · ${p.endpoint}` : '未配置'}
                </div>
              </div>
              <ChevronRight className={cn("w-4 h-4", isDark ? "text-slate-500" : "text-slate-400")} />
            </div>
          ))}
        </div>
        <button className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
          isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
        )}>
          <Plus className="w-4 h-4" />
          <span>添加服务提供商</span>
        </button>
      </SettingSection>
    </>
  );
}

function McpSettings({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  const servers = [
    { id: '1', name: 'filesystem', status: 'running', version: '1.0.0', tools: 5 },
    { id: '2', name: 'shell_executor', status: 'running', version: '1.0.0', tools: 2 },
    { id: '3', name: 'web_search', status: 'stopped', version: '1.0.0', tools: 1 },
  ];
  
  return (
    <>
      <SettingSection title="MCP 服务器" description="管理工具和能力扩展" theme={theme}>
        <div className="space-y-2">
          {servers.map((s) => (
            <div 
              key={s.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border",
                isDark ? "border-slate-700" : "border-slate-200"
              )}
            >
              <div className={cn(
                "w-2.5 h-2.5 rounded-full",
                s.status === 'running' ? "bg-emerald-500" : "bg-slate-400"
              )} />
              <div className="flex-1">
                <div className={cn("text-sm font-medium", isDark ? "text-slate-200" : "text-slate-700")}>
                  {s.name}
                </div>
                <div className={cn("text-xs", isDark ? "text-slate-500" : "text-slate-500")}>
                  v{s.version} · {s.tools} 个工具
                </div>
              </div>
              <span className={cn(
                "px-2 py-0.5 rounded-md text-xs",
                s.status === 'running'
                  ? isDark ? "bg-emerald-900/30 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : isDark ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-500"
              )}>
                {s.status === 'running' ? '运行中' : '已停止'}
              </span>
            </div>
          ))}
        </div>
        <button className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
          isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
        )}>
          <Plus className="w-4 h-4" />
          <span>添加服务器</span>
        </button>
      </SettingSection>
    </>
  );
}

function SecuritySettings({ theme }: { theme: Theme }) {
  const [authFs, setAuthFs] = useState(true);
  const [authShell, setAuthShell] = useState(true);
  
  return (
    <>
      <SettingSection title="权限控制" description="控制工具的访问权限" theme={theme}>
        <SettingRow label="文件系统授权" description="访问文件系统前需要确认" theme={theme}>
          <Toggle checked={authFs} onChange={setAuthFs} theme={theme} />
        </SettingRow>
        <SettingRow label="Shell 命令授权" description="执行 Shell 命令前需要确认" theme={theme}>
          <Toggle checked={authShell} onChange={setAuthShell} theme={theme} />
        </SettingRow>
      </SettingSection>
      
      <SettingSection title="可信目录" description="这些目录将自动授权访问" theme={theme}>
        <div className={cn(
          "p-3 rounded-lg font-mono text-sm",
          theme === 'dark' ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-600"
        )}>
          ~/Desktop<br />
          ~/Documents<br />
          ~/Projects
        </div>
        <button className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
          theme === 'dark' ? "text-slate-400 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
        )}>
          <Plus className="w-4 h-4" />
          <span>添加目录</span>
        </button>
      </SettingSection>
    </>
  );
}

function KnowledgeSettings({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <>
      <SettingSection title="知识库" description="管理本地知识库" theme={theme}>
        <div className={cn(
          "text-center py-8",
          isDark ? "text-slate-500" : "text-slate-500"
        )}>
          <Database className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm mb-4">暂无知识库</p>
          <button className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors",
            isDark ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          )}>
            <Plus className="w-4 h-4" />
            <span>创建知识库</span>
          </button>
        </div>
      </SettingSection>
    </>
  );
}

function WebSearchSettings({ theme }: { theme: Theme }) {
  const [enabled, setEnabled] = useState(false);
  
  return (
    <>
      <SettingSection title="网络搜索" description="启用联网搜索功能" theme={theme}>
        <SettingRow label="启用网络搜索" description="允许 AI 搜索互联网获取信息" theme={theme}>
          <Toggle checked={enabled} onChange={setEnabled} theme={theme} />
        </SettingRow>
        {enabled && (
          <SettingRow label="搜索引擎" theme={theme}>
            <SelectInput
              value="google"
              options={[
                { value: 'google', label: 'Google' },
                { value: 'bing', label: 'Bing' },
                { value: 'duckduckgo', label: 'DuckDuckGo' },
              ]}
              onChange={() => {}}
              theme={theme}
            />
          </SettingRow>
        )}
      </SettingSection>
    </>
  );
}

function AdvancedSettings({ theme }: { theme: Theme }) {
  const [debugMode, setDebugMode] = useState(false);
  const isDark = theme === 'dark';
  
  return (
    <>
      <SettingSection title="开发者选项" theme={theme}>
        <SettingRow label="调试模式" description="显示详细的调试信息" theme={theme}>
          <Toggle checked={debugMode} onChange={setDebugMode} theme={theme} />
        </SettingRow>
        <SettingRow label="日志级别" theme={theme}>
          <SelectInput
            value="info"
            options={[
              { value: 'debug', label: 'Debug' },
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Warning' },
              { value: 'error', label: 'Error' },
            ]}
            onChange={() => {}}
            theme={theme}
          />
        </SettingRow>
      </SettingSection>
      
      <SettingSection title="数据管理" theme={theme}>
        <div className="flex gap-2">
          <button className={cn(
            "px-4 py-2 rounded-lg text-sm transition-colors",
            isDark ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
          )}>
            导出数据
          </button>
          <button className={cn(
            "px-4 py-2 rounded-lg text-sm transition-colors",
            isDark ? "text-red-400 hover:bg-red-900/30" : "text-red-600 hover:bg-red-50"
          )}>
            清除所有数据
          </button>
        </div>
      </SettingSection>
    </>
  );
}

function AboutSettings({ theme }: { theme: Theme }) {
  const isDark = theme === 'dark';
  
  return (
    <>
      <SettingSection title="关于 Chatless" theme={theme}>
        <div className="text-center py-4">
          <div className={cn(
            "w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-bold",
            isDark ? "bg-blue-600 text-white" : "bg-blue-500 text-white"
          )}>
            C
          </div>
          <h3 className={cn("text-lg font-semibold mb-1", isDark ? "text-slate-100" : "text-slate-900")}>
            Chatless
          </h3>
          <p className={cn("text-sm mb-4", isDark ? "text-slate-500" : "text-slate-500")}>
            版本 1.0.0
          </p>
          <button className={cn(
            "px-4 py-2 rounded-lg text-sm transition-colors",
            isDark ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-blue-500 text-white hover:bg-blue-600"
          )}>
            检查更新
          </button>
        </div>
      </SettingSection>
    </>
  );
}

// ==================== 提示词视图组件 ====================

function PromptsView({ theme }: { theme: Theme }) {
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className={cn(
        "p-4 border-b",
        isDark ? "border-slate-800" : "border-slate-200"
      )}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className={cn("text-lg font-semibold", isDark ? "text-slate-100" : "text-slate-900")}>
              提示词库
            </h2>
            <p className={cn("text-sm", isDark ? "text-slate-500" : "text-slate-500")}>
              管理和使用您的提示词模板
            </p>
          </div>
          <button
            onClick={() => setShowEditor(true)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors",
              isDark ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-blue-500 text-white hover:bg-blue-600"
            )}
          >
            <Plus className="w-4 h-4" />
            <span>新建提示词</span>
          </button>
        </div>
        
        {/* 搜索和筛选 */}
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex-1 flex items-center gap-2 px-3 py-2 rounded-lg",
            isDark ? "bg-slate-800" : "bg-slate-100"
          )}>
            <Search className={cn("w-4 h-4", isDark ? "text-slate-500" : "text-slate-400")} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索提示词..."
              className={cn(
                "flex-1 bg-transparent outline-none text-sm",
                isDark ? "text-slate-200 placeholder:text-slate-500" : "text-slate-700 placeholder:text-slate-400"
              )}
            />
          </div>
          
          <button
            onClick={() => setShowFavorites(!showFavorites)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
              showFavorites
                ? isDark ? "bg-amber-900/30 text-amber-400" : "bg-amber-100 text-amber-700"
                : isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Star className={cn("w-4 h-4", showFavorites && "fill-current")} />
            <span>收藏</span>
          </button>
          
          <div className="flex items-center gap-2">
            <Download className={cn("w-4 h-4", isDark ? "text-slate-500" : "text-slate-400")} />
            <Upload className={cn("w-4 h-4", isDark ? "text-slate-500" : "text-slate-400")} />
          </div>
        </div>
        
        {/* 标签筛选 */}
        <div className="flex items-center gap-2 mt-3">
          <span className={cn("text-sm", isDark ? "text-slate-500" : "text-slate-500")}>标签：</span>
          <button
            onClick={() => setFilterTag(null)}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs transition-colors",
              filterTag === null
                ? isDark ? "bg-slate-700 text-slate-200" : "bg-slate-200 text-slate-700"
                : isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            全部
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs transition-colors",
                filterTag === tag
                  ? isDark ? "bg-slate-700 text-slate-200" : "bg-slate-200 text-slate-700"
                  : isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      
      {/* 提示词列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className={cn(
                "p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md",
                selectedPrompt?.id === prompt.id
                  ? isDark ? "border-blue-500 bg-blue-900/20" : "border-blue-400 bg-blue-50"
                  : isDark ? "border-slate-800 hover:border-slate-700" : "border-slate-200 hover:border-slate-300"
              )}
              onClick={() => setSelectedPrompt(prompt)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {prompt.favorite && <Star className="w-4 h-4 text-amber-500 fill-amber-500" />}
                  <h3 className={cn("font-medium", isDark ? "text-slate-200" : "text-slate-800")}>
                    {prompt.name}
                  </h3>
                </div>
                <code className={cn(
                  "text-xs px-1.5 py-0.5 rounded-md",
                  isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                )}>
                  /{prompt.shortcut}
                </code>
              </div>
              <p className={cn(
                "text-sm mb-3 line-clamp-2",
                isDark ? "text-slate-400" : "text-slate-600"
              )}>
                {prompt.description}
              </p>
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  {prompt.tags.map((tag) => (
                    <span 
                      key={tag}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs",
                        isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <span className={cn("text-xs", isDark ? "text-slate-500" : "text-slate-400")}>
                  {prompt.uses} 次使用
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* 选中的提示词详情面板 */}
      {selectedPrompt && (
        <div className={cn(
          "border-t p-4",
          isDark ? "border-slate-800 bg-slate-900/50" : "border-slate-200 bg-slate-50"
        )}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className={cn("font-semibold", isDark ? "text-slate-100" : "text-slate-900")}>
                {selectedPrompt.name}
              </h3>
              <code className={cn(
                "text-xs px-1.5 py-0.5 rounded-md",
                isDark ? "bg-slate-800 text-slate-400" : "bg-slate-200 text-slate-500"
              )}>
                /{selectedPrompt.shortcut}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <button className={cn(
                "px-3 py-1.5 rounded-lg text-sm transition-colors",
                isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-600"
              )}>
                <Edit3 className="w-4 h-4" />
              </button>
              <button className={cn(
                "px-4 py-1.5 rounded-lg text-sm transition-colors",
                isDark ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-blue-500 text-white hover:bg-blue-600"
              )}>
                应用
              </button>
            </div>
          </div>
          <pre className={cn(
            "p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap",
            isDark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-700"
          )}>
            {selectedPrompt.content}
          </pre>
        </div>
      )}
      
      {/* 编辑弹窗 */}
      {showEditor && (
        <PromptEditorModal theme={theme} onClose={() => setShowEditor(false)} />
      )}
    </div>
  );
}

function PromptEditorModal({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const isDark = theme === 'dark';
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={cn(
        "relative w-full max-w-lg rounded-xl shadow-2xl",
        isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-slate-200"
      )}>
        <div className={cn(
          "flex items-center justify-between p-4 border-b",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <h3 className={cn("font-semibold", isDark ? "text-slate-100" : "text-slate-900")}>
            新建提示词
          </h3>
          <button 
            onClick={onClose}
            className={cn(
              "p-1 rounded-md transition-colors",
              isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
            )}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className={cn("block text-sm font-medium mb-1.5", isDark ? "text-slate-300" : "text-slate-700")}>
              名称
            </label>
            <input
              type="text"
              placeholder="提示词名称"
              className={cn(
                "w-full px-3 py-2 rounded-lg border outline-none text-sm",
                isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
            />
          </div>
          
          <div>
            <label className={cn("block text-sm font-medium mb-1.5", isDark ? "text-slate-300" : "text-slate-700")}>
              快捷指令
            </label>
            <div className="flex items-center gap-2">
              <span className={isDark ? "text-slate-500" : "text-slate-400"}>/</span>
              <input
                type="text"
                placeholder="shortcut"
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border outline-none text-sm",
                  isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
                )}
              />
            </div>
          </div>
          
          <div>
            <label className={cn("block text-sm font-medium mb-1.5", isDark ? "text-slate-300" : "text-slate-700")}>
              描述
            </label>
            <input
              type="text"
              placeholder="简短描述"
              className={cn(
                "w-full px-3 py-2 rounded-lg border outline-none text-sm",
                isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
            />
          </div>
          
          <div>
            <label className={cn("block text-sm font-medium mb-1.5", isDark ? "text-slate-300" : "text-slate-700")}>
              内容
            </label>
            <textarea
              rows={6}
              placeholder="提示词内容..."
              className={cn(
                "w-full px-3 py-2 rounded-lg border outline-none text-sm resize-none",
                isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
            />
          </div>
          
          <div>
            <label className={cn("block text-sm font-medium mb-1.5", isDark ? "text-slate-300" : "text-slate-700")}>
              标签
            </label>
            <input
              type="text"
              placeholder="用逗号分隔，如：编程, 审查"
              className={cn(
                "w-full px-3 py-2 rounded-lg border outline-none text-sm",
                isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"
              )}
            />
          </div>
        </div>
        
        <div className={cn(
          "flex justify-end gap-2 p-4 border-t",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <button
            onClick={onClose}
            className={cn(
              "px-4 py-2 rounded-lg text-sm transition-colors",
              isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            取消
          </button>
          <button className={cn(
            "px-4 py-2 rounded-lg text-sm transition-colors",
            isDark ? "bg-blue-600 text-white hover:bg-blue-500" : "bg-blue-500 text-white hover:bg-blue-600"
          )}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主页面 ====================

export default function NotionStylePreview() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<View>('chat');
  const [activeConvId, setActiveConvId] = useState('1');
  
  const isDark = theme === 'dark';
  
  return (
    <div className={cn(
      "h-screen flex overflow-hidden relative",
      isDark ? "bg-slate-950 text-slate-100" : "bg-white text-slate-900"
    )}>
      {/* 侧边栏 */}
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        theme={theme}
        conversations={mockConversations}
        activeId={activeConvId}
        onSelect={setActiveConvId}
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className={cn(
          "flex items-center justify-between px-4 py-2 border-b",
          isDark ? "border-slate-800" : "border-slate-200"
        )}>
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
                )}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            
            {currentView === 'chat' && (
              <>
                <span className={cn("text-sm font-medium", isDark ? "text-slate-200" : "text-slate-700")}>
                  新对话 15:34
                </span>
                <span className={isDark ? "text-slate-600" : "text-slate-300"}>·</span>
                <span className={cn("text-sm", isDark ? "text-slate-500" : "text-slate-500")}>
                  qwen3-vl-30b
                </span>
              </>
            )}
            
            {currentView === 'settings' && (
              <span className={cn("text-sm font-medium", isDark ? "text-slate-200" : "text-slate-700")}>
                设置
              </span>
            )}
            
            {currentView === 'prompts' && (
              <span className={cn("text-sm font-medium", isDark ? "text-slate-200" : "text-slate-700")}>
                提示词
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {/* 主题切换 */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            {/* 返回 */}
            <Link 
              href="/dev-tools/chat-redesign"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
                isDark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-200 text-slate-500"
              )}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>返回</span>
            </Link>
          </div>
        </div>
        
        {/* 视图内容 */}
        {currentView === 'chat' && (
          <>
            {/* 消息区域 */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 py-4">
                {mockMessages.map((msg) => (
                  <Message key={msg.id} message={msg} theme={theme} />
                ))}
              </div>
            </div>
            
            {/* 输入区域 */}
            <InputArea theme={theme} />
          </>
        )}
        
        {currentView === 'settings' && <SettingsView theme={theme} />}
        {currentView === 'prompts' && <PromptsView theme={theme} />}
      </div>
    </div>
  );
}
            