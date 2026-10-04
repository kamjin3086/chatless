"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Plus, Settings, Search, MoreHorizontal, Send, Paperclip, Check, X, Loader2, Copy, RotateCcw, BookOpen, Star, Clock } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案4: 优雅印刷风格 (Editorial)
 * 
 * 设计理念：
 * - 借鉴杂志和书籍排版的优雅设计
 * - 注重阅读体验，大方的留白
 * - 混合使用衬线和无衬线字体
 * - 细腻的分隔线和版式细节
 * - 温暖而专业的色调
 */

// Mock 数据
const mockConversations = [
  { id: '1', title: '新对话 15:34', time: '5分钟前', isActive: true, starred: true },
  { id: '2', title: '新对话 15:25', time: '14分钟前' },
  { id: '3', title: '新对话 13:40', time: '14分钟前' },
  { id: '4', title: '新对话 12:10', time: '约3小时前', starred: true },
  { id: '5', title: '新对话 11:33', time: '约4小时前' },
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
      { name: '列目录', target: 'Desktop', status: 'success' as 'success' | 'error' | 'running' },
      { name: '筛选文件', target: '*.lnk, *.txt', status: 'success' as 'success' | 'error' | 'running' },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `您的桌面包含以下文档和快捷方式：

文件（非目录）：
• Chatless.lnk
• chatlog.exe - 快捷方式.lnk
• Cherry Studio.lnk
• Clash Verge.lnk
• Cursor.lnk
• DBeaver.lnk`,
    time: '15:34',
  },
];

// 悬浮侧边栏组件
function FloatingSidebar({ isHovered, onHoverChange }: { 
  isHovered: boolean; 
  onHoverChange: (hovered: boolean) => void;
}) {
  return (
    <>
      {/* 触发区域 */}
      <div 
        className="fixed left-0 top-0 w-4 h-full z-40"
        onMouseEnter={() => onHoverChange(true)}
      />
      
      {/* 侧边栏 */}
      <div
        className={cn(
          "fixed left-0 top-0 h-full z-50 transition-all duration-300 ease-out",
          isHovered ? "translate-x-0" : "-translate-x-full"
        )}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <div className="w-80 h-full bg-slate-950 flex flex-col border-r border-slate-800/50">
          {/* 头部 - 杂志风格标题 */}
          <div className="p-6 pb-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-xl text-slate-200 tracking-tight">对话</h2>
              <button className="p-2 hover:bg-slate-800/50 rounded-lg transition-colors">
                <Plus className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input 
                type="text"
                placeholder="搜索..."
                className="w-full bg-transparent border-b border-slate-800 px-0 py-2 pl-6 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-600 transition-colors"
              />
            </div>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto px-4">
            <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3 px-2">今天</div>
            {mockConversations.slice(0, 3).map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "px-3 py-3 rounded-lg cursor-pointer transition-all duration-150 mb-1 group",
                  conv.isActive 
                    ? "bg-slate-800/50" 
                    : "hover:bg-slate-900/50"
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "text-sm truncate",
                      conv.isActive ? "text-slate-100 font-medium" : "text-slate-400"
                    )}>
                      {conv.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                      <Clock className="w-3 h-3" />
                      <span>{conv.time}</span>
                    </div>
                  </div>
                  {conv.starred && (
                    <Star className="w-3.5 h-3.5 text-amber-500/70 fill-amber-500/70 shrink-0 mt-0.5" />
                  )}
                </div>
              </div>
            ))}
            
            <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-3 mt-6 px-2">更早</div>
            {mockConversations.slice(3).map((conv) => (
              <div
                key={conv.id}
                className="px-3 py-3 rounded-lg cursor-pointer hover:bg-slate-900/50 transition-all duration-150 mb-1"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-400 truncate">{conv.title}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                      <Clock className="w-3 h-3" />
                      <span>{conv.time}</span>
                    </div>
                  </div>
                  {conv.starred && (
                    <Star className="w-3.5 h-3.5 text-amber-500/70 fill-amber-500/70 shrink-0 mt-0.5" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 底部 */}
          <div className="p-4 border-t border-slate-800/50">
            <button className="flex items-center gap-3 text-slate-500 hover:text-slate-300 text-sm transition-colors w-full px-2 py-2">
              <Settings className="w-4 h-4" />
              <span>设置</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 工具调用组件 - 边注风格
function ToolCallNote({ calls }: { calls: typeof mockMessages[1]['toolCalls'] }) {
  if (!calls || calls.length === 0) return null;
  
  return (
    <div className="text-xs text-slate-500 mb-4 pl-4 border-l-2 border-slate-800">
      <span className="text-slate-600 uppercase tracking-wider text-[10px]">执行</span>
      <div className="mt-1 space-y-0.5">
        {calls.map((call, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {call.status === 'success' && <Check className="w-3 h-3 text-emerald-500/70" />}
            {call.status === 'error' && <X className="w-3 h-3 text-red-500/70" />}
            {call.status === 'running' && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
            <span>{call.name}</span>
            <span className="text-slate-600">→</span>
            <span className="font-mono text-slate-400">{call.target}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 消息组件
function Message({ message }: { message: typeof mockMessages[0] }) {
  const isUser = message.role === 'user';
  
  return (
    <article className={cn(
      "py-6",
      !isUser && "border-b border-slate-800/30"
    )}>
      {/* 消息头 - 杂志风格 */}
      <header className="flex items-center gap-3 mb-4">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium",
          isUser 
            ? "bg-slate-800 text-slate-300" 
            : "bg-gradient-to-br from-amber-800/30 to-orange-800/30 text-amber-200/80"
        )}>
          {isUser ? 'U' : 'AI'}
        </div>
        <div>
          <div className={cn(
            "text-sm font-medium",
            isUser ? "text-slate-300" : "text-slate-200"
          )}>
            {isUser ? '您' : '助手'}
          </div>
          <div className="text-xs text-slate-600">{message.time}</div>
        </div>
      </header>
      
      {/* 工具调用 */}
      {'toolCalls' in message && <ToolCallNote calls={message.toolCalls} />}
      
      {/* 消息内容 - 阅读优化 */}
      <div className={cn(
        "leading-[1.8] whitespace-pre-wrap",
        isUser 
          ? "text-slate-300 text-[15px]" 
          : "text-slate-300/90 text-[15px] font-serif"
      )}>
        {message.content}
      </div>
      
      {/* AI消息操作 - 边注风格 */}
      {!isUser && (
        <footer className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-800/20">
          <button className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
            <Copy className="w-3 h-3" />
            <span>复制</span>
          </button>
          <button className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
            <RotateCcw className="w-3 h-3" />
            <span>重试</span>
          </button>
          <button className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
            <Star className="w-3 h-3" />
            <span>收藏</span>
          </button>
        </footer>
      )}
    </article>
  );
}

// 输入框组件
function InputArea() {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);
  
  return (
    <div className="border-t border-slate-800/50 p-6">
      <div className="max-w-2xl mx-auto">
        {/* 输入提示 */}
        <div className="text-xs text-slate-600 mb-3 uppercase tracking-wider">新消息</div>
        
        <div className="flex items-end gap-4">
          {/* 输入框 */}
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="写点什么..."
              rows={1}
              className="w-full bg-transparent text-slate-200 placeholder:text-slate-600 text-[15px] resize-none focus:outline-none leading-relaxed font-serif border-b border-slate-800 pb-2 focus:border-slate-600 transition-colors"
              style={{ minHeight: '28px', maxHeight: '200px' }}
            />
            
            {/* 工具按钮 */}
            <div className="flex items-center gap-4 mt-3">
              <button className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                <Paperclip className="w-4 h-4" />
              </button>
              <button className="text-xs text-slate-600 hover:text-slate-400 transition-colors">@ MCP</button>
              <button className="text-xs text-slate-600 hover:text-slate-400 transition-colors"># 技能</button>
            </div>
          </div>
          
          {/* 发送按钮 */}
          <button className={cn(
            "p-3 rounded-full transition-all shrink-0 mb-1",
            value.trim() 
              ? "bg-slate-200 text-slate-900 hover:bg-white" 
              : "bg-slate-800 text-slate-500"
          )}>
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EditorialPreview() {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  
  return (
    <div className="h-screen bg-slate-950 text-slate-300 flex flex-col overflow-hidden">
      {/* 返回导航 */}
      <div className="fixed top-4 right-4 z-50">
        <Link 
          href="/dev-tools/chat-redesign"
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 bg-slate-900 rounded-lg border border-slate-800 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>返回</span>
        </Link>
      </div>

      {/* 悬浮侧边栏 */}
      <FloatingSidebar isHovered={sidebarHovered} onHoverChange={setSidebarHovered} />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部栏 - 杂志标题风格 */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-slate-800/30">
          <div className="flex items-center gap-4">
            <BookOpen className="w-5 h-5 text-slate-600" />
            <div>
              <h1 className="font-serif text-lg text-slate-100">新对话 15:34</h1>
              <div className="text-xs text-slate-600 mt-0.5">qwen3-vl-30b-a3b-instruct · LM Studio</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              提示词
            </button>
            <button className="p-2 text-slate-500 hover:text-slate-300 transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 消息区域 - 阅读优化布局 */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8">
            {mockMessages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}
          </div>
        </div>

        {/* 输入区域 */}
        <InputArea />
      </div>

      {/* 设计说明 */}
      <div className="fixed bottom-4 right-4 max-w-xs p-4 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-500 z-50">
        <div className="font-serif text-slate-300 mb-2">Editorial</div>
        <ul className="space-y-1">
          <li>• 衬线字体提升阅读体验</li>
          <li>• 杂志风格的版式布局</li>
          <li>• 温暖的石色调色板</li>
          <li>• 边注风格的工具调用</li>
          <li>• 文章式的消息结构</li>
        </ul>
      </div>
    </div>
  );
}
