"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Plus, Settings, Search, Send, Paperclip, Check, X, Loader2, Copy, RotateCcw, Menu, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * 方案5: 沉浸对话风格 (Immersive)
 * 
 * 设计理念：
 * - 极度克制的UI，让内容成为绝对焦点
 * - 界面元素渐隐，只在需要时显现
 * - 大量留白，禅意般的宁静感
 * - 对话流自然延展，无明显分隔
 * - 最小化视觉干扰
 */

// Mock 数据
const mockConversations = [
  { id: '1', title: '新对话 15:34', isActive: true },
  { id: '2', title: '新对话 15:25' },
  { id: '3', title: '新对话 13:40' },
  { id: '4', title: '新对话 12:10' },
  { id: '5', title: '新对话 11:33' },
];

const mockMessages = [
  {
    id: '1',
    role: 'user' as const,
    content: '读取我的桌面，列出其中所有的文档名',
  },
  {
    id: '2',
    role: 'assistant' as const,
    content: '我将为您列出桌面上的所有文档。',
    toolCalls: [
      { name: '列目录', target: 'Desktop', status: 'success' as 'success' | 'error' | 'running' },
    ],
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: `您的桌面包含以下文档和快捷方式：

• Chatless.lnk
• chatlog.exe - 快捷方式.lnk
• Cherry Studio.lnk
• Clash Verge.lnk
• Cursor.lnk
• DBeaver.lnk`,
  },
];

// 悬浮侧边栏组件 - 极简版
function FloatingSidebar({ isHovered, onHoverChange }: { 
  isHovered: boolean; 
  onHoverChange: (hovered: boolean) => void;
}) {
  return (
    <>
      {/* 触发区域 */}
      <div 
        className="fixed left-0 top-0 w-3 h-full z-40"
        onMouseEnter={() => onHoverChange(true)}
      />
      
      {/* 侧边栏 */}
      <div
        className={cn(
          "fixed left-0 top-0 h-full z-50 transition-all duration-200 ease-out",
          isHovered ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
        )}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <div className="w-64 h-full bg-slate-950/95 backdrop-blur-sm flex flex-col">
          {/* 头部 */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-slate-400 text-sm">对话</span>
              <button className="p-1.5 hover:bg-slate-800/50 rounded-md transition-colors">
                <Plus className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="relative">
              <input 
                type="text"
                placeholder="搜索"
                className="w-full bg-slate-900/50 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-700 transition-all"
              />
            </div>
          </div>

          {/* 会话列表 - 极简 */}
          <div className="flex-1 overflow-y-auto px-3">
            {mockConversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "px-3 py-2.5 rounded-lg cursor-pointer transition-all mb-0.5 text-sm",
                  conv.isActive 
                    ? "text-slate-100 bg-slate-800/30" 
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-900/30"
                )}
              >
                {conv.title}
              </div>
            ))}
          </div>

          {/* 底部 */}
          <div className="p-4">
            <button className="flex items-center gap-2 text-slate-600 hover:text-slate-400 text-sm transition-colors">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// 工具调用 - 极简内联
function ToolCallMinimal({ calls }: { calls: typeof mockMessages[1]['toolCalls'] }) {
  const [expanded, setExpanded] = useState(false);
  
  if (!calls || calls.length === 0) return null;
  
  return (
    <div className="mb-2">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-500 transition-colors"
      >
        {calls.every(c => c.status === 'success') ? (
          <Check className="w-3 h-3 text-slate-500" />
        ) : calls.some(c => c.status === 'running') ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <X className="w-3 h-3 text-red-500/50" />
        )}
        <span>{calls.length}个操作</span>
        <ChevronRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
      </button>
      
      {expanded && (
        <div className="mt-1.5 text-xs text-slate-600 space-y-0.5 pl-4">
          {calls.map((call, i) => (
            <div key={i}>{call.name} → {call.target}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// 消息组件 - 极简
function Message({ message, isFirst }: { message: typeof mockMessages[0]; isFirst?: boolean }) {
  const isUser = message.role === 'user';
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div 
      className={cn(
        "relative group",
        isUser ? "mt-12 mb-4" : "mb-4",
        isFirst && "mt-0"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 角色标识 - 仅用户消息显示，且极其微弱 */}
      {isUser && (
        <div className="text-[10px] text-slate-700 uppercase tracking-widest mb-2">
          你
        </div>
      )}
      
      {/* 工具调用 */}
      {'toolCalls' in message && <ToolCallMinimal calls={message.toolCalls} />}
      
      {/* 消息内容 */}
      <div className={cn(
        "text-[15px] leading-[1.8] whitespace-pre-wrap",
        isUser ? "text-slate-200" : "text-slate-400"
      )}>
        {message.content}
      </div>
      
      {/* 操作按钮 - 悬停显示 */}
      {!isUser && (
        <div className={cn(
          "absolute -right-12 top-0 flex flex-col gap-1 transition-opacity duration-200",
          isHovered ? "opacity-100" : "opacity-0"
        )}>
          <button className="p-1.5 text-slate-700 hover:text-slate-500 transition-colors">
            <Copy className="w-3 h-3" />
          </button>
          <button className="p-1.5 text-slate-700 hover:text-slate-500 transition-colors">
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// 输入框组件 - 极简
function InputArea() {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);
  
  return (
    <div className={cn(
      "p-6 transition-all duration-300",
      isFocused && "bg-slate-900/30"
    )}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-end gap-4">
          {/* 附件按钮 - 聚焦时显示 */}
          <button className={cn(
            "p-2 text-slate-700 hover:text-slate-500 transition-all shrink-0",
            isFocused ? "opacity-100" : "opacity-0"
          )}>
            <Paperclip className="w-4 h-4" />
          </button>
          
          {/* 输入框 */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="输入消息..."
              rows={1}
              className="w-full bg-transparent text-slate-200 placeholder:text-slate-700 text-[15px] resize-none focus:outline-none leading-relaxed"
              style={{ minHeight: '24px', maxHeight: '200px' }}
            />
            {/* 底部线 */}
            <div className={cn(
              "absolute bottom-0 left-0 right-0 h-px transition-all duration-300",
              isFocused ? "bg-slate-600" : "bg-slate-800"
            )} />
          </div>
          
          {/* 发送按钮 */}
          <button className={cn(
            "p-2 transition-all shrink-0",
            value.trim() 
              ? "text-slate-200 hover:text-white" 
              : "text-slate-700"
          )}>
            <Send className="w-4 h-4" />
          </button>
        </div>
        
        {/* 快捷键提示 - 聚焦时显示 */}
        <div className={cn(
          "flex items-center gap-4 mt-3 text-[10px] text-slate-700 transition-opacity duration-300",
          isFocused ? "opacity-100" : "opacity-0"
        )}>
          <span>⌘ + Enter 发送</span>
          <span>@ 提及MCP</span>
          <span># 使用技能</span>
        </div>
      </div>
    </div>
  );
}

// 顶部栏 - 悬停显示
function TopBar({ isVisible }: { isVisible: boolean }) {
  return (
    <div className={cn(
      "fixed top-0 left-0 right-0 z-30 transition-all duration-300",
      isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
    )}>
      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-slate-950 to-transparent">
        <div className="flex items-center gap-3">
          <button className="p-2 text-slate-600 hover:text-slate-400 transition-colors">
            <Menu className="w-4 h-4" />
          </button>
          <span className="text-slate-400 text-sm">新对话</span>
          <span className="text-slate-700 text-xs">·</span>
          <span className="text-slate-600 text-xs">qwen3-vl-30b</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 text-xs text-slate-600 hover:text-slate-400 transition-colors">
            提示词
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ImmersivePreview() {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [topBarVisible, setTopBarVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // 滚动到顶部时显示顶部栏
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      setTopBarVisible(container.scrollTop < 50);
    };
    
    container.addEventListener('scroll', handleScroll);
    handleScroll();
    
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);
  
  // 鼠标移动到顶部时显示顶部栏
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientY < 60) {
        setTopBarVisible(true);
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);
  
  return (
    <div className="h-screen bg-slate-950 text-slate-300 flex flex-col overflow-hidden">
      {/* 返回导航 - 固定在右上角 */}
      <div className="fixed top-4 right-4 z-50">
        <Link 
          href="/dev-tools/chat-redesign"
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>返回</span>
        </Link>
      </div>

      {/* 悬浮侧边栏 */}
      <FloatingSidebar isHovered={sidebarHovered} onHoverChange={setSidebarHovered} />

      {/* 渐隐顶部栏 */}
      <TopBar isVisible={topBarVisible} />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col">
        {/* 消息区域 - 大量留白 */}
        <div 
          ref={containerRef}
          className="flex-1 overflow-y-auto"
          onMouseEnter={() => setTopBarVisible(true)}
          onMouseLeave={() => setTopBarVisible(false)}
        >
          <div className="max-w-2xl mx-auto px-6 py-20">
            {mockMessages.map((msg, i) => (
              <Message key={msg.id} message={msg} isFirst={i === 0} />
            ))}
          </div>
        </div>

        {/* 输入区域 */}
        <InputArea />
      </div>

      {/* 设计说明 */}
      <div className="fixed bottom-4 right-4 max-w-xs p-4 bg-slate-900/50 backdrop-blur border border-slate-800/30 rounded-lg text-xs text-slate-600 z-50">
        <div className="text-slate-400 mb-2">Immersive</div>
        <ul className="space-y-1">
          <li>• 界面元素渐隐消失</li>
          <li>• 极致留白与呼吸感</li>
          <li>• 内容为绝对焦点</li>
          <li>• 操作按需显现</li>
          <li>• 禅意般的简洁</li>
        </ul>
      </div>
    </div>
  );
}
