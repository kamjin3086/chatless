"use client";

import Link from 'next/link';
import { ArrowRight, Terminal, Waves, Layers, BookOpen, Focus, Layout, Grid3X3, Columns, PanelLeft, Minimize2 } from 'lucide-react';

const designs = [
  {
    id: 'terminal-minimal',
    name: '极简终端',
    subtitle: 'Terminal Minimal',
    description: '受终端启发的极简设计，单色调、高信息密度、零边框，适合技术用户',
    icon: Terminal,
    color: 'from-slate-500 to-slate-700',
    features: ['单色设计', '高密度布局', '零装饰元素', '等宽字体'],
  },
  {
    id: 'fluid-gradient',
    name: '流畅渐变',
    subtitle: 'Fluid Gradient',
    description: '柔和的渐变背景与流体动画，现代感与舒适感并存',
    icon: Waves,
    color: 'from-violet-500 to-indigo-600',
    features: ['渐变背景', '流体动画', '柔和阴影', '呼吸感设计'],
  },
  {
    id: 'clear-layers',
    name: '清晰层叠',
    subtitle: 'Clear Layers',
    description: '通过微妙的层次和阴影区分内容，无边框但层次分明',
    icon: Layers,
    color: 'from-slate-400 to-slate-600',
    features: ['层次阴影', '玻璃拟态', '无边框设计', '空间呼吸'],
  },
  {
    id: 'editorial',
    name: '优雅印刷',
    subtitle: 'Editorial',
    description: '借鉴杂志排版的优雅设计，注重阅读体验和版式美感',
    icon: BookOpen,
    color: 'from-amber-500 to-orange-600',
    features: ['衬线标题', '优雅间距', '版式美学', '阅读优先'],
  },
  {
    id: 'immersive',
    name: '沉浸对话',
    subtitle: 'Immersive',
    description: '极度克制的UI，让内容成为唯一焦点，界面几乎消失',
    icon: Focus,
    color: 'from-emerald-500 to-teal-600',
    features: ['内容聚焦', '渐隐界面', '极致留白', '禅意设计'],
  },
];

// 完整版方案 - 包含聊天、设置、提示词三个界面
const designsFull = [
  {
    id: 'terminal-minimal',
    name: '极简终端',
    subtitle: 'Terminal Minimal - Full',
    description: '受终端启发的极简设计，单色调、高信息密度、零边框。现已包含完整的聊天、设置、提示词管理三大界面',
    icon: Terminal,
    color: 'from-slate-500 to-slate-700',
    features: ['完整体系', '设置界面', '提示词管理', '亮暗切换', '等宽字体', '终端风格'],
    isFull: true,
  },
  {
    id: 'notion-style',
    name: '结构化笔记',
    subtitle: 'Notion Style - Full',
    description: '借鉴Notion的块状结构设计，清晰的层级和可折叠区域。现已包含完整的聊天、设置、提示词管理三大界面',
    icon: Layout,
    color: 'from-slate-600 to-slate-800',
    features: ['完整体系', '设置界面', '提示词管理', '块状结构', '可折叠区域', '亮暗切换'],
    isFull: true,
  },
];

const designsV2 = [
  {
    id: 'slack-inspired',
    name: '协作通讯',
    subtitle: 'Slack Inspired',
    description: '受Slack启发的紧凑对话设计，高效的信息展示和线程组织',
    icon: Grid3X3,
    color: 'from-purple-500 to-pink-600',
    features: ['紧凑消息', '线程组织', '状态指示', '快捷操作'],
    isNew: true,
  },
  {
    id: 'linear-clean',
    name: '线性简洁',
    subtitle: 'Linear Clean',
    description: '借鉴Linear的极简美学，精确的对齐和克制的视觉元素',
    icon: Minimize2,
    color: 'from-indigo-500 to-blue-600',
    features: ['精确对齐', '微妙动效', '键盘优先', '信息密度'],
    isNew: true,
  },
  {
    id: 'vscode-panel',
    name: '面板布局',
    subtitle: 'VSCode Panel',
    description: '借鉴VSCode的面板设计，灵活的分区和专业的工具感',
    icon: Columns,
    color: 'from-cyan-500 to-teal-600',
    features: ['面板分区', '可调大小', '标签导航', '状态栏'],
    isNew: true,
  },
  {
    id: 'arc-browser',
    name: '弧形现代',
    subtitle: 'Arc Browser',
    description: '借鉴Arc浏览器的大胆设计，色彩丰富且层次分明',
    icon: PanelLeft,
    color: 'from-rose-500 to-orange-500',
    features: ['大胆色彩', '圆润形状', '空间层次', '个性化'],
    isNew: true,
  },
];

export default function ChatRedesignIndex() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-light tracking-tight mb-3">
            聊天界面重设计
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl">
            点击预览并选择最适合的风格。完整版方案包含聊天、设置、提示词管理三大界面，体系化呈现设计风格。
          </p>
        </div>

        {/* Full Design Cards - Recommended */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-medium text-slate-200">完整版方案</h2>
            <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded-full">推荐 · 含设置和提示词界面</span>
          </div>
          <div className="grid gap-4">
            {designsFull.map((design, index) => {
              const Icon = design.icon;
              return (
                <Link
                  key={design.id}
                  href={`/dev-tools/chat-redesign/${design.id}`}
                  className="group block"
                >
                  <div className="relative overflow-hidden rounded-2xl bg-slate-900/50 border border-blue-500/30 p-6 transition-all duration-300 hover:bg-slate-900/80 hover:border-blue-500/50 hover:shadow-2xl hover:shadow-blue-900/20">
                    <div className="flex items-start gap-6">
                      {/* Icon */}
                      <div className={`shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br ${design.color} flex items-center justify-center shadow-lg`}>
                        <Icon className="w-7 h-7 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 mb-2">
                          <span className="text-slate-500 text-sm font-mono">★{index + 1}</span>
                          <h2 className="text-xl font-medium text-slate-100">
                            {design.name}
                          </h2>
                          <span className="text-slate-500 text-sm">
                            {design.subtitle}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded-md">完整</span>
                        </div>
                        <p className="text-slate-400 mb-4">
                          {design.description}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {design.features.map((feature) => (
                            <span
                              key={feature}
                              className={`px-2.5 py-1 text-xs rounded-full border ${
                                ['完整体系', '设置界面', '提示词管理'].includes(feature)
                                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                  : 'bg-slate-800/80 text-slate-400 border-slate-700/50'
                              }`}
                            >
                              {feature}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="shrink-0 self-center">
                        <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all duration-200" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* V2 Design Cards - New */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-medium text-slate-200">其他新版方案</h2>
            <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">聊天界面预览</span>
          </div>
          <div className="grid gap-4">
            {designsV2.map((design, index) => {
              const Icon = design.icon;
              return (
                <Link
                  key={design.id}
                  href={`/dev-tools/chat-redesign/${design.id}`}
                  className="group block"
                >
                  <div className="relative overflow-hidden rounded-2xl bg-slate-900/50 border border-slate-800/50 p-5 transition-all duration-300 hover:bg-slate-900/80 hover:border-slate-700/50">
                    <div className="flex items-start gap-5">
                      {/* Icon */}
                      <div className={`shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${design.color} flex items-center justify-center shadow-lg`}>
                        <Icon className="w-6 h-6 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 mb-1">
                          <span className="text-slate-600 text-sm font-mono">0{index + 3}</span>
                          <h2 className="text-lg font-medium text-slate-200">
                            {design.name}
                          </h2>
                          <span className="text-slate-600 text-sm">
                            {design.subtitle}
                          </span>
                        </div>
                        <p className="text-slate-500 text-sm">
                          {design.description}
                        </p>
                      </div>

                      {/* Arrow */}
                      <div className="shrink-0 self-center">
                        <ArrowRight className="w-4 h-4 text-slate-700 group-hover:text-slate-500 group-hover:translate-x-1 transition-all duration-200" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* V1 Design Cards */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-medium text-slate-200">初版方案</h2>
            <span className="px-2 py-0.5 text-xs bg-slate-700 text-slate-400 rounded-full">聊天界面预览</span>
          </div>
          <div className="grid gap-3 opacity-60">
            {designs.filter(d => d.id !== 'terminal-minimal').map((design) => {
              const Icon = design.icon;
              return (
                <Link
                  key={design.id}
                  href={`/dev-tools/chat-redesign/${design.id}`}
                  className="group block"
                >
                  <div className="relative overflow-hidden rounded-xl bg-slate-900/50 border border-slate-800/50 p-4 transition-all duration-300 hover:bg-slate-900/80 hover:border-slate-700/50">
                    <div className="flex items-center gap-4">
                      <div className={`shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${design.color} flex items-center justify-center shadow-lg`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <h2 className="text-sm font-medium text-slate-300">{design.name}</h2>
                          <span className="text-slate-600 text-xs">{design.subtitle}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-700 group-hover:text-slate-500 group-hover:translate-x-1 transition-all duration-200 shrink-0" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Design Principles */}
        <div className="pt-8 border-t border-slate-800/50">
          <h3 className="text-lg font-medium text-slate-300 mb-6">完整版方案特性</h3>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-blue-900/10 border border-blue-800/30">
              <h4 className="text-blue-300 font-medium mb-2">三大界面</h4>
              <p className="text-slate-500 text-sm">包含聊天、设置、提示词管理界面，全面体验设计风格体系</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/30">
              <h4 className="text-slate-200 font-medium mb-2">完整交互</h4>
              <p className="text-slate-500 text-sm">菜单可点击、下拉可操作、弹窗可关闭，真实体验设计效果</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/30">
              <h4 className="text-slate-200 font-medium mb-2">亮暗切换</h4>
              <p className="text-slate-500 text-sm">右上角主题切换按钮，预览亮色和暗色模式下的界面表现</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/30">
              <h4 className="text-slate-200 font-medium mb-2">功能复刻</h4>
              <p className="text-slate-500 text-sm">模拟现有功能的表面效果，评估不同风格的实际承载能力</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
