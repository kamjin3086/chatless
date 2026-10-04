"use client";

import React, { useState } from 'react';
import { 
  MessageCircle, 
  Settings, 
  Database, 
  BarChart3, 
  Search, 
  PlusCircle, 
  Clock, 
  Star, 
  Flag,
  X,
  Send,
  Paperclip,
  Mic,
  MoreHorizontal,
  User,
  Bot
} from 'lucide-react';
import { cn } from "@/lib/utils";

export default function ChatLayoutPreviewPage() {
  const [selectedScheme, setSelectedScheme] = useState<'current' | 'modern' | 'light' | 'compact'>('current');

  // 模拟数据
  const conversations = [
    { id: 1, title: "新对话 13:55", time: "4分钟前", preview: "用户这次又发了一个你好..." },
    { id: 2, title: "新对话 13:34", time: "26分钟前", preview: "Okay, so I'm trying to figure out..." },
    { id: 3, title: "Ubuntu SSH服务配置", time: "1小时前", preview: "如何在Ubuntu上配置SSH服务..." },
  ];

  const messages = [
    {
      id: 1,
      type: 'user' as const,
      content: '好，我来想想用户的需求。他之前和我打招呼，现在发来了一个关于Ubuntu开SSH服务的文档解析结果',
      time: '10分钟前'
    },
    {
      id: 2,
      type: 'ai' as const,
      content: '首先，我要理解文档的内容。文档分为两部分：服务器能连外网和不能连外网的情况。对于能连外网的，主要是切换软件源为国内源，然后用apt-get命令安装openssh-server。',
      time: '10分钟前'
    }
  ];

  // 当前方案组件
  const CurrentScheme = () => (
    <div className="flex h-full bg-slate-50">
      {/* 左侧固定导航栏 */}
      <div className="w-16 bg-slate-900 flex flex-col items-center py-4 space-y-4">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-700 transition-colors">
          <Database className="w-5 h-5 text-slate-400" />
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-700 transition-colors">
          <BarChart3 className="w-5 h-5 text-slate-400" />
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-700 transition-colors">
          <Settings className="w-5 h-5 text-slate-400" />
        </div>
      </div>

      {/* 左侧边栏 */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col">
        {/* 头部 */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-300 rounded-full"></div>
            
          </div>
        </div>

        {/* 搜索框 */}
        <div className="p-3 border-b border-slate-200">
          <div className="flex items-center bg-slate-100 rounded-md px-3 py-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索对话..." 
              className="w-full border-0 bg-transparent ml-2 text-sm focus:outline-none"
            />
          </div>
        </div>

        {/* 新建对话按钮 */}
        <div className="p-3 border-b border-slate-200">
          <button className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-violet-700 bg-violet-100 border border-transparent rounded-md transition-all duration-200 hover:bg-violet-200">
            <PlusCircle className="w-4 h-4" />
            <span>新建对话</span>
          </button>
        </div>

        {/* 标签页 */}
        <div className="flex border-b border-slate-200 bg-white">
          <div className="flex-1 text-center py-2.5 text-xs font-medium text-blue-600 border-b-2 border-blue-600 bg-blue-50/50">
            <Clock className="w-3.5 h-3.5 inline mr-1" />
            最近
          </div>
          <div className="flex-1 text-center py-2.5 text-xs font-medium text-slate-500 hover:text-slate-700">
            <Star className="w-3.5 h-3.5 inline mr-1" />
            收藏
          </div>
          <div className="flex-1 text-center py-2.5 text-xs font-medium text-slate-500 hover:text-slate-700">
            <Flag className="w-3.5 h-3.5 inline mr-1" />
            重要
          </div>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div key={conv.id} className="p-4 hover:bg-slate-50 border-b border-slate-100 cursor-pointer">
              <div className="font-medium text-sm text-slate-800 mb-1">{conv.title}</div>
              <div className="text-xs text-slate-500 mb-1">{conv.time}</div>
              <div className="text-xs text-slate-400 truncate">{conv.preview}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col bg-slate-50">
        {/* 聊天头部 */}
        <div className="p-4 bg-white border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">AI</span>
              </div>
              <div>
                <div className="font-medium text-slate-800">deepseek-r1-32b</div>
                <div className="text-xs text-slate-500">Qllama</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 hover:bg-slate-100 rounded-lg">
                <MoreHorizontal className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={cn(
              "flex gap-3",
              message.type === 'user' ? "justify-end" : "justify-start"
            )}>
              {message.type === 'ai' && (
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div className={cn(
                "max-w-[70%] rounded-lg p-3",
                message.type === 'user' 
                  ? "bg-blue-500 text-white" 
                  : "bg-white border border-slate-100 text-slate-800 shadow-sm"
              )}>
                <div className="text-sm">{message.content}</div>
                <div className={cn(
                  "text-xs mt-2",
                  message.type === 'user' ? "text-blue-100" : "text-slate-500"
                )}>
                  {message.time}
                </div>
              </div>
              {message.type === 'user' && (
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 输入区域 */}
        <div className="p-4 bg-white border-t border-slate-200">
          <div className="flex items-end gap-3">
            <div className="flex-1 border border-slate-300 rounded-lg p-3">
              <textarea 
                placeholder="输入消息..."
                className="w-full resize-none border-0 focus:outline-none text-sm"
                rows={1}
              />
            </div>
            <button className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // 方案一：更宽的导航与更现代的边栏
  const ModernScheme = () => (
    <div className="flex h-full bg-slate-50">
      {/* 左侧固定导航栏 - 更宽 */}
      <div className="w-20 bg-slate-900 flex flex-col items-center py-4 space-y-4">
        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
          <MessageCircle className="w-6 h-6 text-white" />
        </div>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-slate-700 transition-colors group">
          <Database className="w-5 h-5 text-slate-400 group-hover:text-white" />
        </div>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-slate-700 transition-colors group">
          <BarChart3 className="w-5 h-5 text-slate-400 group-hover:text-white" />
        </div>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center hover:bg-slate-700 transition-colors group">
          <Settings className="w-5 h-5 text-slate-400 group-hover:text-white" />
        </div>
      </div>

      {/* 左侧边栏 - 优化排版 */}
      <div className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm">
        {/* 头部 - 更现代 */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">AI</span>
            </div>
            <div>
              <div className="font-medium text-slate-800">AI 助手</div>
              <div className="text-xs text-slate-500">在线</div>
            </div>
          </div>
        </div>

        {/* 搜索框 - 更精致 */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200 focus-within:border-blue-300 focus-within:bg-white transition-all">
            <Search className="w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索对话..." 
              className="w-full border-0 bg-transparent ml-3 text-sm focus:outline-none"
            />
          </div>
        </div>

        {/* 新建对话按钮 - 更现代 */}
        <div className="p-4 border-b border-slate-100">
          <button className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl transition-all duration-200 hover:from-blue-600 hover:to-purple-700 shadow-sm hover:shadow-md">
            <PlusCircle className="w-4 h-4" />
            <span>新建对话</span>
          </button>
        </div>

        {/* 标签页 - 更现代的指示器 */}
        <div className="flex border-b border-slate-100 bg-slate-50">
          <div className="flex-1 text-center py-3 text-xs font-medium text-blue-600 bg-white border-b-2 border-blue-500 rounded-t-lg mx-1">
            <Clock className="w-3.5 h-3.5 inline mr-1.5" />
            最近
          </div>
          <div className="flex-1 text-center py-3 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-t-lg mx-1 transition-colors">
            <Star className="w-3.5 h-3.5 inline mr-1.5" />
            收藏
          </div>
          <div className="flex-1 text-center py-3 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-t-lg mx-1 transition-colors">
            <Flag className="w-3.5 h-3.5 inline mr-1.5" />
            重要
          </div>
        </div>

        {/* 对话列表 - 更好的间距 */}
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div key={conv.id} className="p-4 hover:bg-slate-50 border-b border-slate-50 cursor-pointer transition-colors">
              <div className="font-medium text-sm text-slate-800 mb-2">{conv.title}</div>
              <div className="text-xs text-slate-500 mb-2">{conv.time}</div>
              <div className="text-xs text-slate-400 truncate leading-relaxed">{conv.preview}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区域 - 保持原样但优化细节 */}
      <div className="flex-1 flex flex-col bg-slate-50">
        <div className="p-4 bg-white border-b border-slate-100 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-teal-600 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="font-medium text-slate-800">deepseek-r1-32b</div>
                <div className="text-xs text-slate-500">Qllama • 在线</div>
              </div>
            </div>
            <button className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
              <MoreHorizontal className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((message) => (
            <div key={message.id} className={cn(
              "flex gap-4",
              message.type === 'user' ? "justify-end" : "justify-start"
            )}>
              {message.type === 'ai' && (
                <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-teal-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div className={cn(
                "max-w-[70%] rounded-2xl p-4 shadow-sm",
                message.type === 'user' 
                  ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white" 
                  : "bg-white border border-slate-100 text-slate-800"
              )}>
                <div className="text-sm leading-relaxed">{message.content}</div>
                <div className={cn(
                  "text-xs mt-3",
                  message.type === 'user' ? "text-blue-100" : "text-slate-500"
                )}>
                  {message.time}
                </div>
              </div>
              {message.type === 'user' && (
                <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 bg-white border-t border-slate-100">
          <div className="flex items-end gap-3">
            <div className="flex-1 border border-slate-200 rounded-2xl p-4 focus-within:border-blue-300 transition-colors">
              <textarea 
                placeholder="输入消息..."
                className="w-full resize-none border-0 focus:outline-none text-sm"
                rows={1}
              />
            </div>
            <button className="p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-2xl hover:from-blue-600 hover:to-purple-700 transition-all shadow-sm hover:shadow-md">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // 方案二：轻盈的浅色主题
  const LightScheme = () => (
    <div className="flex h-full bg-white">
      {/* 左侧固定导航栏 - 浅色 */}
      <div className="w-16 bg-white border-r border-slate-200 flex flex-col items-center py-4 space-y-4">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-sm">
          <MessageCircle className="w-5 h-5 text-white" />
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors">
          <Database className="w-5 h-5 text-slate-600" />
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors">
          <BarChart3 className="w-5 h-5 text-slate-600" />
        </div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors">
          <Settings className="w-5 h-5 text-slate-600" />
        </div>
      </div>

      {/* 左侧边栏 - 浅色主题 */}
      <div className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-blue-600 text-sm font-medium">AI</span>
            </div>
            <span className="text-sm text-slate-700">AI 助手</span>
          </div>
        </div>

        <div className="p-3 border-b border-slate-200 bg-white">
          <div className="flex items-center bg-white rounded-lg px-3 py-2 border border-slate-300 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
            <Search className="w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索对话..." 
              className="w-full border-0 bg-transparent ml-2 text-sm focus:outline-none"
            />
          </div>
        </div>

        <div className="p-3 border-b border-slate-200 bg-white">
          <button className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg transition-all duration-200 hover:bg-blue-100 hover:border-blue-300">
            <PlusCircle className="w-4 h-4" />
            <span>新建对话</span>
          </button>
        </div>

        <div className="flex border-b border-slate-200 bg-white">
          <div className="flex-1 text-center py-2.5 text-xs font-medium text-blue-600 border-b-2 border-blue-500 bg-blue-50">
            <Clock className="w-3.5 h-3.5 inline mr-1" />
            最近
          </div>
          <div className="flex-1 text-center py-2.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-50">
            <Star className="w-3.5 h-3.5 inline mr-1" />
            收藏
          </div>
          <div className="flex-1 text-center py-2.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-50">
            <Flag className="w-3.5 h-3.5 inline mr-1" />
            重要
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {conversations.map((conv) => (
            <div key={conv.id} className="p-4 hover:bg-slate-50 border-b border-slate-100 cursor-pointer">
              <div className="font-medium text-sm text-slate-800 mb-1">{conv.title}</div>
              <div className="text-xs text-slate-500 mb-1">{conv.time}</div>
              <div className="text-xs text-slate-400 truncate">{conv.preview}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区域 - 浅色主题 */}
      <div className="flex-1 flex flex-col bg-slate-50">
        <div className="p-4 bg-white border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <Bot className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <div className="font-medium text-slate-800">deepseek-r1-32b</div>
                <div className="text-xs text-slate-500">Qllama</div>
              </div>
            </div>
            <button className="p-2 hover:bg-slate-100 rounded-lg">
              <MoreHorizontal className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={cn(
              "flex gap-3",
              message.type === 'user' ? "justify-end" : "justify-start"
            )}>
              {message.type === 'ai' && (
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-green-600" />
                </div>
              )}
              <div className={cn(
                "max-w-[70%] rounded-lg p-3 shadow-sm",
                message.type === 'user' 
                  ? "bg-blue-500 text-white" 
                  : "bg-white border border-slate-200 text-slate-800"
              )}>
                <div className="text-sm">{message.content}</div>
                <div className={cn(
                  "text-xs mt-2",
                  message.type === 'user' ? "text-blue-100" : "text-slate-500"
                )}>
                  {message.time}
                </div>
              </div>
              {message.type === 'user' && (
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-blue-600" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 bg-white border-t border-slate-200">
          <div className="flex items-end gap-3">
            <div className="flex-1 border border-slate-300 rounded-lg p-3 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400">
              <textarea 
                placeholder="输入消息..."
                className="w-full resize-none border-0 focus:outline-none text-sm"
                rows={1}
              />
            </div>
            <button className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // 方案三：紧凑布局
  const CompactScheme = () => (
    <div className="flex h-full bg-slate-50">
      {/* 左侧固定导航栏 - 紧凑 */}
      <div className="w-12 bg-slate-900 flex flex-col items-center py-2 space-y-2">
        <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
          <MessageCircle className="w-4 h-4 text-white" />
        </div>
        <div className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-slate-700 transition-colors">
          <Database className="w-4 h-4 text-slate-400" />
        </div>
        <div className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-slate-700 transition-colors">
          <BarChart3 className="w-4 h-4 text-slate-400" />
        </div>
        <div className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-slate-700 transition-colors">
          <Settings className="w-4 h-4 text-slate-400" />
        </div>
      </div>

      {/* 左侧边栏 - 紧凑 */}
      <div className="w-56 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-2 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-slate-300 rounded-full"></div>
            <span className="text-xs text-slate-600">AI助手</span>
          </div>
        </div>

        <div className="p-2 border-b border-slate-200">
          <div className="flex items-center bg-slate-100 rounded-md px-2 py-1">
            <Search className="w-3 h-3 text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索..." 
              className="w-full border-0 bg-transparent ml-1 text-xs focus:outline-none"
            />
          </div>
        </div>

        <div className="p-2 border-b border-slate-200">
          <button className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-violet-700 bg-violet-100 rounded-md transition-all duration-200 hover:bg-violet-200">
            <PlusCircle className="w-3 h-3" />
            <span>新建</span>
          </button>
        </div>

        <div className="flex border-b border-slate-200 bg-white text-xs">
          <div className="flex-1 text-center py-1.5 font-medium text-blue-600 border-b border-blue-600 bg-blue-50/50">
            最近
          </div>
          <div className="flex-1 text-center py-1.5 font-medium text-slate-500 hover:text-slate-700">
            收藏
          </div>
          <div className="flex-1 text-center py-1.5 font-medium text-slate-500 hover:text-slate-700">
            重要
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div key={conv.id} className="p-2 hover:bg-slate-50 border-b border-slate-100 cursor-pointer">
              <div className="font-medium text-xs text-slate-800 mb-1 truncate">{conv.title}</div>
              <div className="text-xs text-slate-500 mb-1">{conv.time}</div>
              <div className="text-xs text-slate-400 truncate">{conv.preview}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区域 - 紧凑 */}
      <div className="flex-1 flex flex-col bg-slate-50">
        <div className="p-2 bg-white border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-xs">AI</span>
              </div>
              <div>
                <div className="font-medium text-xs text-slate-800">deepseek-r1-32b</div>
                <div className="text-xs text-slate-500">Qllama</div>
              </div>
            </div>
            <button className="p-1 hover:bg-slate-100 rounded-md">
              <MoreHorizontal className="w-3 h-3 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {messages.map((message) => (
            <div key={message.id} className={cn(
              "flex gap-2",
              message.type === 'user' ? "justify-end" : "justify-start"
            )}>
              {message.type === 'ai' && (
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3 h-3 text-white" />
                </div>
              )}
              <div className={cn(
                "max-w-[70%] rounded-md p-2",
                message.type === 'user' 
                  ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white" 
                  : "bg-white border border-slate-200 text-slate-800"
              )}>
                <div className="text-xs leading-relaxed">{message.content}</div>
                <div className={cn(
                  "text-xs mt-1",
                  message.type === 'user' ? "text-blue-100" : "text-slate-500"
                )}>
                  {message.time}
                </div>
              </div>
              {message.type === 'user' && (
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-2 bg-white border-t border-slate-200">
          <div className="flex items-end gap-2">
            <div className="flex-1 border border-slate-300 rounded-md p-2">
              <textarea 
                placeholder="输入消息..."
                className="w-full resize-none border-0 focus:outline-none text-xs"
                rows={1}
              />
            </div>
            <button className="p-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const schemes = {
    current: { name: '当前设计', component: CurrentScheme },
    modern: { name: '方案一：现代边栏', component: ModernScheme },
    light: { name: '方案二：轻盈浅色', component: LightScheme },
    compact: { name: '方案三：紧凑布局', component: CompactScheme },
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* 顶部选择器 */}
      <div className="bg-white border-b border-slate-200 p-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">
            聊天界面设计方案预览
          </h1>
          <div className="flex gap-2">
            {Object.entries(schemes).map(([key, scheme]) => (
              <button
                key={key}
                onClick={() => setSelectedScheme(key as any)}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200",
                  selectedScheme === key
                    ? "bg-blue-500 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                )}
              >
                {scheme.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 预览区域 */}
      <div className="h-[calc(100vh-120px)]">
        {React.createElement(schemes[selectedScheme].component)}
      </div>

      {/* 底部说明 */}
      <div className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div className="p-3 bg-slate-50 rounded-lg">
              <h3 className="font-medium text-slate-800 mb-2">当前设计</h3>
              <p className="text-slate-600 mb-2">现有的三栏布局，深色导航栏，标准间距</p>
              <ul className="text-xs text-slate-500 space-y-1">
                <li>• 导航栏宽度：64px</li>
                <li>• 边栏宽度：256px</li>
                <li>• 深色主题导航</li>
                <li>• 标准间距设计</li>
              </ul>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <h3 className="font-medium text-slate-800 mb-2">方案一：现代边栏</h3>
              <p className="text-slate-600 mb-2">更宽的导航栏，渐变按钮，圆角设计，更好的视觉层次</p>
              <ul className="text-xs text-slate-500 space-y-1">
                <li>• 导航栏宽度：80px</li>
                <li>• 更大的图标和按钮</li>
                <li>• 渐变色彩搭配</li>
                <li>• 圆角现代设计</li>
              </ul>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <h3 className="font-medium text-slate-800 mb-2">方案二：轻盈浅色</h3>
              <p className="text-slate-600 mb-2">浅色主题，去除渐变，更清新的视觉感受</p>
              <ul className="text-xs text-slate-500 space-y-1">
                <li>• 全浅色主题设计</li>
                <li>• 去除重渐变效果</li>
                <li>• 更好的对比度</li>
                <li>• 清新友好界面</li>
              </ul>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <h3 className="font-medium text-slate-800 mb-2">方案三：紧凑布局</h3>
              <p className="text-slate-600 mb-2">更小的间距和字体，在有限空间显示更多内容</p>
              <ul className="text-xs text-slate-500 space-y-1">
                <li>• 导航栏宽度：48px</li>
                <li>• 边栏宽度：224px</li>
                <li>• 紧凑间距设计</li>
                <li>• 高信息密度</li>
              </ul>
            </div>
          </div>
          
          {/* 使用说明 */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-medium text-slate-800 mb-2">💡 使用说明</h3>
            <div className="text-sm text-slate-600 space-y-1">
              <p>• 点击顶部按钮切换不同的设计方案</p>
              <p>• 每个方案都是完全可交互的预览</p>
              <p>• 可以测试悬浮效果、点击反馈等交互细节</p>
              <p>• 建议在不同屏幕尺寸下测试各方案的适应性</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 