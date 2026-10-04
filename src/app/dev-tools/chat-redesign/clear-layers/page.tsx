"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Plus, Settings, Search, MoreHorizontal, Send, Paperclip, Check, X, Loader2, Copy, RotateCcw, ChevronDown, Zap, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案3: 清晰层叠风格 (Clear Layers)
 * 
 * 设计理念：
 * - 通过层次感区分内容，无硬边框
 * - 微妙的阴影和高度差创造空间感
 * - 干净的白色/深灰基调
 * - 内容区域通过背景深浅区分
 * - 功能区通过提升的层级暗示交互
 */

// Mock 数据
const mockConversations = [
  { id: '1', title: '新对话 15:34', time: '5分钟前', isActive: true, hasUnread: false },
  { id: '2', title: '新对话 15:25', time: '14分钟前', hasUnread: true },
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
      
      {/* 遮罩 */}
      {isHovered && (
        <div 
          className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-200"
          onClick={() => onHoverChange(false)}
        />
      )}
      
      {/* 侧边栏 */}
      <div
        className={cn(
          "fixed left-0 top-0 h-full z-50 transition-all duration-250 ease-out",
          isHovered ? "translate-x-0" : "-translate-x-full"
        )}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        {/* 卡片容器 - 有阴影和圆角 */}
        <div className="w-72 h-[calc(100%-32px)] m-4 bg-slate-900 rounded-2xl shadow-2xl shadow-black/30 flex flex-col overflow-hidden">
          {/* 头部 */}
          <div className="p-4 pb-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-slate-400" />
                <span className="text-slate-200 font-medium">对话</span>
              </div>
              <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors">
                <Plus className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text"
                placeholder="搜索对话..."
                className="w-full bg-slate-800/80 rounded-xl px-3 py-2.5 pl-10 text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700 transition-all"
              />
            </div>
          </div>

          {/* 分组标签 */}
          <div className="px-4 py-2 flex items-center gap-2">
            <button className="px-3 py-1.5 bg-slate-800 rounded-lg text-xs text-slate-300 font-medium">最近</button>
            <button className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">收藏</button>
            <button className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">重要</button>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {mockConversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "px-3 py-3 rounded-xl cursor-pointer transition-all duration-150 mb-1",
                  conv.isActive 
                    ? "bg-slate-800 shadow-md" 
                    : "hover:bg-slate-800/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 font-medium truncate">{conv.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{conv.time}</div>
                  </div>
                  {conv.hasUnread && (
                    <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 底部 */}
          <div className="p-3 border-t border-slate-800">
            <button className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm transition-colors w-full px-3 py-2 rounded-xl hover:bg-slate-800">
              <Settings className="w-4 h-4" />
              <span>设置</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 工具调用组件 - 提升的层级
function ToolCallGroup({ calls }: { calls: typeof mockMessages[1]['toolCalls'] }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!calls || calls.length === 0) return null;
  
  const allSuccess = calls.every(c => c.status === 'success');
  const hasRunning = calls.some(c => c.status === 'running');
  
  return (
    <div className="mb-3 -mx-1">
      <button 
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all",
          "bg-slate-800/50 hover:bg-slate-800/80"
        )}
      >
        <div className="flex items-center gap-1.5">
          {hasRunning ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          ) : allSuccess ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <X className="w-3.5 h-3.5 text-red-400" />
          )}
          <span className="text-slate-400">
            {calls.length}个操作{allSuccess ? '已完成' : hasRunning ? '执行中' : '有错误'}
          </span>
        </div>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-slate-500 ml-auto transition-transform",
          expanded && "rotate-180"
        )} />
      </button>
      
      {expanded && (
        <div className="mt-1 bg-slate-800/30 rounded-xl p-2 space-y-1">
          {calls.map((call, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors">
              {call.status === 'success' && <Check className="w-3 h-3 text-emerald-400" />}
              {call.status === 'error' && <X className="w-3 h-3 text-red-400" />}
              {call.status === 'running' && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
              <span className="text-xs text-slate-400">{call.name}</span>
              <span className="text-xs text-slate-600">·</span>
              <span className="text-xs text-slate-500 font-mono truncate">{call.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 消息组件
function Message({ message, isLast }: { message: typeof mockMessages[0]; isLast?: boolean }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={cn(
      "relative",
      !isLast && "mb-1"
    )}>
      {/* 连接线 - 非最后一条且是AI消息时显示 */}
      {!isUser && !isLast && (
        <div className="absolute left-4 top-full w-px h-4 bg-gradient-to-b from-slate-700/50 to-transparent" />
      )}
      
      <div className={cn(
        "relative rounded-2xl p-4 transition-all",
        isUser 
          ? "bg-slate-800 ml-12" 
          : "bg-transparent"
      )}>
        {/* 用户标识 */}
        {isUser && (
          <div className="absolute -left-8 top-4 w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-medium shadow-lg">
            U
          </div>
        )}
        
        {/* AI标识 */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 flex items-center justify-center">
              <Zap className="w-3 h-3 text-emerald-400" />
            </div>
            <span className="text-xs text-slate-500">AI</span>
            <span className="text-xs text-slate-600">·</span>
            <span className="text-xs text-slate-600">{message.time}</span>
          </div>
        )}
        
        {/* 工具调用 */}
        {'toolCalls' in message && <ToolCallGroup calls={message.toolCalls} />}
        
        {/* 消息内容 */}
        <div className={cn(
          "text-sm leading-relaxed whitespace-pre-wrap",
          isUser ? "text-slate-200" : "text-slate-300"
        )}>
          {message.content}
        </div>
        
        {/* 用户消息时间 */}
        {isUser && (
          <div className="text-xs text-slate-600 mt-2 text-right">{message.time}</div>
        )}
        
        {/* AI消息操作 */}
        {!isUser && (
          <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="p-1.5 text-slate-600 hover:text-slate-400 hover:bg-slate-800 rounded-lg transition-all">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button className="p-1.5 text-slate-600 hover:text-slate-400 hover:bg-slate-800 rounded-lg transition-all">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
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
      <div className="max-w-3xl mx-auto">
        {/* 提升的输入卡片 */}
        <div className="bg-slate-800 rounded-2xl shadow-xl shadow-black/20 overflow-hidden">
          {/* 输入区 */}
          <div className="p-4">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="输入消息..."
              rows={1}
              className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 text-sm resize-none focus:outline-none leading-relaxed"
              style={{ minHeight: '24px', maxHeight: '200px' }}
            />
          </div>
          
          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-850 border-t border-slate-700/50">
            <div className="flex items-center gap-1">
              <button className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-all">
                <Paperclip className="w-4 h-4" />
              </button>
              <button className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-all">
                @ MCP
              </button>
              <button className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-all">
                # 技能
              </button>
            </div>
            <button className={cn(
              "p-2.5 rounded-xl transition-all",
              value.trim() 
                ? "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20" 
                : "bg-slate-700 text-slate-500"
            )}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClearLayersPreview() {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  
  return (
    <div className="h-screen bg-slate-950 text-slate-300 flex flex-col overflow-hidden">
      {/* 返回导航 */}
      <div className="fixed top-4 right-4 z-50">
        <Link 
          href="/dev-tools/chat-redesign"
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-xl shadow-lg transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>返回</span>
        </Link>
      </div>

      {/* 悬浮侧边栏 */}
      <FloatingSidebar isHovered={sidebarHovered} onHoverChange={setSidebarHovered} />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部栏 - 提升层级 */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h1 className="text-slate-100 font-medium">新对话 15:34</h1>
            <div className="px-2.5 py-1 rounded-lg bg-slate-800 text-xs text-slate-400">
              qwen3-vl-30b
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
              提示词
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-3xl mx-auto space-y-4 group">
            {mockMessages.map((msg, i) => (
              <Message key={msg.id} message={msg} isLast={i === mockMessages.length - 1} />
            ))}
          </div>
        </div>

        {/* 输入区域 */}
        <InputArea />
      </div>

      {/* 设计说明 */}
      <div className="fixed bottom-4 right-4 max-w-xs p-4 bg-slate-800 rounded-2xl shadow-xl text-xs text-slate-500 z-50">
        <div className="font-semibold text-slate-300 mb-2">Clear Layers</div>
        <ul className="space-y-1">
          <li>• 层级阴影区分内容</li>
          <li>• 圆角卡片悬浮侧边栏</li>
          <li>• 用户消息深色背景提升</li>
          <li>• 工具调用可折叠组</li>
          <li>• 输入框底部工具条分层</li>
        </ul>
      </div>
    </div>
  );
}
