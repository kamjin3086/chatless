"use client";

import React from 'react';
import { PlusCircle, Eye, Play } from 'lucide-react';

export default function ButtonPreviewPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
          按钮样式设计对比预览
        </h1>
        
        <div className="space-y-12">
          {/* 当前设计 */}
          <section className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">
              当前设计
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              渐变背景 + 阴影效果，视觉重量较重
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="gradient-btn rounded-lg py-3 px-4 flex items-center justify-center gap-2 text-sm font-medium shadow-md btn-click-effect text-white">
                <PlusCircle className="w-4 h-4" />
                <span>新建知识库</span>
              </button>
              <button className="gradient-btn rounded-lg py-2 px-3 flex items-center justify-center gap-2 text-xs font-medium shadow-md btn-click-effect text-white">
                <Eye className="w-3 h-3" />
                <span>查看</span>
              </button>
              <button className="gradient-btn rounded-lg py-2 px-3 flex items-center justify-center gap-2 text-xs font-medium shadow-md btn-click-effect text-white">
                <Play className="w-3 h-3" />
                <span>使用</span>
              </button>
            </div>
          </section>

          {/* 方案一：简约现代风 */}
          <section className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">
              方案一：简约现代风（推荐）
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              纯色背景，白色文字，悬浮时轻微上浮 + 柔和光晕
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-violet-500 border-none rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/30 active:translate-y-0 active:bg-violet-700">
                <PlusCircle className="w-4 h-4" />
                <span>新建知识库</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-slate-500 border-none rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-600 hover:-translate-y-px hover:shadow-md hover:shadow-slate-500/30">
                <Eye className="w-3 h-3" />
                <span>查看</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-white bg-slate-500 border-none rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-600 hover:-translate-y-px hover:shadow-md hover:shadow-slate-500/30">
                <Play className="w-3 h-3" />
                <span>使用</span>
              </button>
            </div>
          </section>

          {/* 方案二：轻盈柔和风 */}
          <section className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">
              方案二：轻盈柔和风
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              淡色背景，深色文字，整体感觉更加轻松友好
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-violet-700 bg-violet-100 border border-transparent rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-200 hover:border-violet-300 hover:text-violet-800 active:bg-violet-300 active:text-violet-800">
                <PlusCircle className="w-4 h-4" />
                <span>新建知识库</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 border border-transparent rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-200 hover:border-slate-300 hover:text-slate-700">
                <Eye className="w-3 h-3" />
                <span>查看</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 border border-transparent rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-200 hover:border-slate-300 hover:text-slate-700">
                <Play className="w-3 h-3" />
                <span>使用</span>
              </button>
            </div>
          </section>

          {/* 方案三：幽灵按钮风格 */}
          <section className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">
              方案三：幽灵按钮风格
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              透明背景 + 彩色边框，适合次要操作，悬浮时填充背景
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-violet-500 bg-transparent border border-violet-300 rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-500 hover:text-white hover:border-violet-500">
                <PlusCircle className="w-4 h-4" />
                <span>新建知识库</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-500 bg-transparent border border-slate-400 rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-500 hover:text-white hover:border-slate-500">
                <Eye className="w-3 h-3" />
                <span>查看</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-500 bg-transparent border border-slate-400 rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-500 hover:text-white hover:border-slate-500">
                <Play className="w-3 h-3" />
                <span>使用</span>
              </button>
            </div>
          </section>

          {/* 混合方案展示 */}
          <section className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">
              推荐组合方案
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              主要操作使用简约现代风，次要操作使用幽灵按钮，建立清晰的视觉层级
            </p>
            <div className="flex flex-wrap gap-4">
              {/* 主要操作 */}
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-violet-500 border-none rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/30 active:translate-y-0 active:bg-violet-700">
                <PlusCircle className="w-4 h-4" />
                <span>新建知识库</span>
              </button>
              {/* 次要操作 */}
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-500 bg-transparent border border-slate-400 rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-500 hover:text-white hover:border-slate-500">
                <Eye className="w-3 h-3" />
                <span>查看</span>
              </button>
              <button className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-500 bg-transparent border border-slate-400 rounded-md cursor-pointer transition-all duration-200 hover:bg-slate-500 hover:text-white hover:border-slate-500">
                <Play className="w-3 h-3" />
                <span>使用</span>
              </button>
            </div>
          </section>

          {/* 暗色模式展示 */}
          <section className="bg-slate-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-white">
              暗色模式效果
            </h2>
            <p className="text-slate-300 mb-6">
              在暗色背景下的按钮效果展示
            </p>
            <div className="flex flex-wrap gap-4">
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-violet-500 border-none rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/30 active:translate-y-0 active:bg-violet-700">
                <PlusCircle className="w-4 h-4" />
                <span>简约现代</span>
              </button>
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-violet-700 bg-violet-100 border border-transparent rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-200 hover:border-violet-300 hover:text-violet-800 active:bg-violet-300 active:text-violet-800">
                <PlusCircle className="w-4 h-4" />
                <span>轻盈柔和</span>
              </button>
              <button className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-violet-500 bg-transparent border border-violet-300 rounded-lg cursor-pointer transition-all duration-200 hover:bg-violet-500 hover:text-white hover:border-violet-500">
                <PlusCircle className="w-4 h-4" />
                <span>幽灵按钮</span>
              </button>
            </div>
          </section>
        </div>
      </div>


    </div>
  );
} 