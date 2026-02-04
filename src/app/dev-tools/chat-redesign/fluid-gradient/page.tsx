"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Plus, Settings, Search, MoreHorizontal, Send, Paperclip, Check, X, Loader2, Copy, RotateCcw, Sparkles, Globe } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案2: 流畅渐变风格 (Fluid Gradient)
 * 
 * 设计理念：
 * - 柔和的渐变背景营造舒适氛围
 * - 流体动画和微妙的光效增强现代感
 * - 玻璃拟态卡片，但非硬边框
 * - 圆润的形状和柔和的阴影
 * - 色彩克制但有品质感
 */

// Mock 数据
const mockConversations = [
  { id: '1', title: '新对话 15:34', time: '5分钟前', isActive: true },
  { id: '2', title: '新对话 15:25', time: '14分钟前' },
  { id: '3', title: '新对话 13:40', time: '14分钟前' },
  { id: '4', title: '新对话 12:10', time: '约3小时前' },
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
          isHovered ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
        )}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <div className="w-72 h-full bg-gradient-to-b from-slate-900/95 via-slate-900/98 to-slate-950/98 backdrop-blur-xl flex flex-col shadow-2xl shadow-black/20">
          {/* 发光边缘 */}
          <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-violet-500/20 via-indigo-500/10 to-transparent" />
          
          {/* 头部 */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-slate-400 text-sm font-medium">对话</span>
              <button className="p-2 hover:bg-white/5 rounded-xl transition-colors group">
                <Plus className="w-4 h-4 text-slate-500 group-hover:text-violet-400 transition-colors" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
              <input 
                type="text"
                placeholder="搜索对话..."
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 pl-10 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:bg-white/8 focus:ring-1 focus:ring-violet-500/30 transition-all"
              />
            </div>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {mockConversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "px-3 py-3 rounded-xl cursor-pointer transition-all duration-200 mb-1",
                  conv.isActive 
                    ? "bg-gradient-to-r from-violet-500/15 to-indigo-500/10 text-white" 
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                )}
              >
                <div className="text-sm font-medium truncate">{conv.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{conv.time}</div>
              </div>
            ))}
          </div>

          {/* 底部 */}
          <div className="p-4 border-t border-white/5">
            <button className="flex items-center gap-3 text-slate-500 hover:text-slate-300 text-sm transition-colors w-full px-3 py-2 rounded-xl hover:bg-white/5">
              <Settings className="w-4 h-4" />
              <span>设置</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 工具调用组件 - 内联紧凑风格
function ToolCallInline({ calls }: { calls: typeof mockMessages[1]['toolCalls'] }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!calls || calls.length === 0) return null;
  
  return (
    <div className="mb-3">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-400 transition-colors group"
      >
        <div className="flex items-center gap-1">
          {calls.map((call, i) => (
            <span key={i} className="flex items-center gap-1">
              {call.status === 'success' && <Check className="w-3 h-3 text-emerald-400/70" />}
              {call.status === 'error' && <X className="w-3 h-3 text-red-400/70" />}
              {call.status === 'running' && <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />}
              <span>{call.name}</span>
              {i < calls.length - 1 && <span className="text-slate-600 mx-1">·</span>}
            </span>
          ))}
        </div>
        <span className="text-slate-600 group-hover:text-slate-500 transition-colors">
          {expanded ? '收起' : '详情'}
        </span>
      </button>
      
      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-violet-500/20 space-y-1.5">
          {calls.map((call, i) => (
            <div key={i} className="text-xs">
              <span className="text-slate-500">{call.name}</span>
              <span className="text-slate-600 mx-1.5">→</span>
              <span className="text-slate-400 font-mono">{call.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 消息组件
function Message({ message }: { message: typeof mockMessages[0] }) {
  const isUser = message.role === 'user';
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div 
      className={cn("py-4 group", isUser && "flex justify-end")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={cn(
        "max-w-[85%]",
        isUser && "text-right"
      )}>
        {/* 工具调用 */}
        {'toolCalls' in message && <ToolCallInline calls={message.toolCalls} />}
        
        {/* 消息内容 */}
        <div className={cn(
          "inline-block text-sm leading-relaxed whitespace-pre-wrap rounded-2xl px-4 py-3",
          isUser 
            ? "bg-gradient-to-r from-violet-600/90 to-indigo-600/90 text-white shadow-lg shadow-violet-500/10" 
            : "text-slate-300"
        )}>
          {message.content}
        </div>
        
        {/* 时间和操作 */}
        <div className={cn(
          "flex items-center gap-2 mt-1.5 text-[11px] text-slate-600 transition-opacity duration-200",
          isUser ? "justify-end pr-1" : "pl-1",
          isHovered ? "opacity-100" : "opacity-0"
        )}>
          <span>{message.time}</span>
          {!isUser && (
            <>
              <button className="p-1 hover:text-slate-400 transition-colors">
                <Copy className="w-3 h-3" />
              </button>
              <button className="p-1 hover:text-slate-400 transition-colors">
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
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
    <div className="p-4">
      <div className="relative max-w-3xl mx-auto">
        {/* 发光背景 */}
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 via-indigo-500/5 to-violet-500/10 rounded-2xl blur-xl" />
        
        {/* 输入容器 */}
        <div className="relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/5 shadow-xl shadow-black/10">
          {/* 功能按钮条 */}
          <div className="flex items-center gap-1 px-3 pt-3 pb-2">
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all">
              <Paperclip className="w-3.5 h-3.5" />
              <span>附件</span>
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all">
              <Globe className="w-3.5 h-3.5" />
              <span>联网</span>
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Agent</span>
            </button>
          </div>
          
          {/* 输入区 */}
          <div className="flex items-end gap-3 px-4 pb-3">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="开始对话吧..."
              rows={1}
              className="flex-1 bg-transparent text-slate-200 placeholder:text-slate-600 text-sm resize-none focus:outline-none leading-relaxed"
              style={{ minHeight: '24px', maxHeight: '200px' }}
            />
            <button className={cn(
              "p-2.5 rounded-xl transition-all duration-200 shrink-0",
              value.trim() 
                ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40" 
                : "bg-white/5 text-slate-500"
            )}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FluidGradientPreview() {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  
  return (
    <div className="h-screen bg-slate-950 text-slate-300 flex flex-col overflow-hidden relative">
      {/* 背景渐变 */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-violet-500/5 rounded-full blur-[150px] -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[120px] translate-y-1/2 -translate-x-1/2" />
      
      {/* 返回导航 */}
      <div className="fixed top-4 right-4 z-50">
        <Link 
          href="/dev-tools/chat-redesign"
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-900/80 backdrop-blur-xl rounded-xl border border-white/5 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>返回</span>
        </Link>
      </div>

      {/* 悬浮侧边栏 */}
      <FloatingSidebar isHovered={sidebarHovered} onHoverChange={setSidebarHovered} />

      {/* 主内容区 */}
      <div className="relative flex-1 flex flex-col z-10">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-slate-200 font-medium">新对话 15:34</h1>
            <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs text-slate-500">
              qwen3-vl-30b
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
              提示词
            </button>
            <button className="p-2 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-6">
          <div className="max-w-3xl mx-auto">
            {mockMessages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}
          </div>
        </div>

        {/* 输入区域 */}
        <InputArea />
      </div>

      {/* 设计说明 */}
      <div className="fixed bottom-4 right-4 max-w-xs p-4 bg-slate-900/90 backdrop-blur-xl border border-white/5 rounded-2xl text-xs text-slate-500 z-50">
        <div className="font-semibold text-slate-400 mb-2">Fluid Gradient</div>
        <ul className="space-y-1">
          <li>• 背景模糊渐变光斑</li>
          <li>• 玻璃拟态UI元素</li>
          <li>• 用户消息渐变高亮</li>
          <li>• 工具调用内联紧凑展示</li>
          <li>• 发光边缘与柔和阴影</li>
        </ul>
      </div>
    </div>
  );
}
