"use client";

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Check, X, Loader2, FileText, FolderOpen, Terminal, Search, Wrench } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';

type ToolCallStatus = 'success' | 'error' | 'running' | 'pending_auth' | 'stopped';

interface ToolCardData {
  id: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  resultPreview?: string;
  errorMessage?: string;
  schemaHint?: string;
  messageId: string;
}

interface ToolCallGroupProps {
  cards: ToolCardData[];
  /** 是否正在流式生成中 */
  isStreaming?: boolean;
}

/**
 * 判断工具调用的优先级
 * - high: 用户关心的结果（文件创建/修改/删除、命令执行结果）
 * - low: 中间过程（列出技能、查看说明、列目录等探索性操作）
 */
function getToolPriority(card: ToolCardData): 'high' | 'low' {
  const srv = String(card.server || '').toLowerCase();
  const tool = String(card.tool || '').toLowerCase();

  // Skills 相关操作通常是低优先级
  if (srv === 'skills') {
    // 除非是 execute_action，否则都是低优先级
    if (tool.includes('execute') || tool.includes('run')) return 'high';
    return 'low';
  }

  // 文件系统操作
  if (srv === 'filesystem' || srv === 'fs') {
    // 写入/创建/删除是高优先级
    if (tool.includes('write') || tool.includes('create') || tool.includes('delete')) {
      return 'high';
    }
    // 读取和列目录是低优先级（探索性）
    if (tool.includes('read') || tool.includes('list')) {
      return 'low';
    }
    return 'high';
  }

  // Shell 命令通常是高优先级（有实际效果）
  if (srv === 'shell_executor' || srv === 'shell-executor') {
    return 'high';
  }

  // 网络搜索是高优先级
  if (srv === 'web_search') {
    return 'high';
  }

  return 'low';
}

/**
 * 获取工具类型图标
 */
function getToolIcon(card: ToolCardData): React.ReactNode {
  const srv = String(card.server || '').toLowerCase();
  const tool = String(card.tool || '').toLowerCase();

  if (srv === 'filesystem' || srv === 'fs') {
    if (tool.includes('list') || tool.includes('dir')) {
      return <FolderOpen className="w-3.5 h-3.5" />;
    }
    return <FileText className="w-3.5 h-3.5" />;
  }

  if (srv === 'shell_executor' || srv === 'shell-executor') {
    return <Terminal className="w-3.5 h-3.5" />;
  }

  if (srv === 'web_search') {
    return <Search className="w-3.5 h-3.5" />;
  }

  if (srv === 'skills') {
    return <Wrench className="w-3.5 h-3.5" />;
  }

  return <Wrench className="w-3.5 h-3.5" />;
}

/**
 * 获取简洁的操作描述
 */
function getShortDescription(card: ToolCardData): string {
  const srv = String(card.server || '').toLowerCase();
  const tool = String(card.tool || '').toLowerCase();
  const args = card.args || {};

  // 文件系统操作
  if (srv === 'filesystem' || srv === 'fs') {
    const path = String((args as any).path || '').split(/[/\\]/).pop() || '';
    if (tool.includes('write')) return `写入 ${path}`;
    if (tool.includes('create_directory')) return `创建目录 ${path}`;
    if (tool.includes('delete')) return `删除 ${path}`;
    if (tool.includes('read')) return `读取 ${path}`;
    if (tool.includes('list')) return `列目录`;
    return `文件操作`;
  }

  // Shell 命令
  if (srv === 'shell_executor' || srv === 'shell-executor') {
    const cmd = String((args as any).command || '');
    const short = cmd.length > 30 ? cmd.slice(0, 30) + '...' : cmd;
    return `执行 ${short}`;
  }

  // 网络搜索
  if (srv === 'web_search') {
    const query = String((args as any).query || (args as any).search_term || '');
    const short = query.length > 20 ? query.slice(0, 20) + '...' : query;
    return `搜索 ${short}`;
  }

  // Skills
  if (srv === 'skills') {
    if (tool.includes('list_available')) return '列出技能';
    if (tool.includes('get_skill')) return '查看技能说明';
    if (tool.includes('list_skill_actions')) return '列出技能动作';
    if (tool.includes('execute')) return '执行技能动作';
    return '技能操作';
  }

  return `${srv}.${tool}`;
}

/**
 * 工具调用分组组件
 * 
 * 将连续的工具调用智能分组，默认折叠低优先级操作，
 * 突出显示高优先级结果。
 */
export function ToolCallGroup({ cards, isStreaming: _isStreaming }: ToolCallGroupProps) {
  // 使用 ref 追踪用户是否手动操作过，避免自动切换干扰
  const userInteractedRef = React.useRef(false);
  const [expanded, setExpanded] = useState(false);
  
  // 记录首次达到可折叠状态时的卡片数量，防止后续卡片增加时重新触发展开
  const initialCollapseCountRef = React.useRef<number | null>(null);

  // 分析卡片状态
  const analysis = useMemo(() => {
    const highPriority = cards.filter(c => getToolPriority(c) === 'high');
    const lowPriority = cards.filter(c => getToolPriority(c) === 'low');
    
    const hasRunning = cards.some(c => c.status === 'running');
    const hasPendingAuth = cards.some(c => c.status === 'pending_auth');
    const hasError = cards.some(c => c.status === 'error');
    const allSuccess = cards.every(c => c.status === 'success' || c.status === 'stopped');

    // 找到最后一个高优先级的成功操作作为主要结果
    const mainResult = [...highPriority].reverse().find(c => c.status === 'success');

    return {
      total: cards.length,
      highPriority,
      lowPriority,
      hasRunning,
      hasPendingAuth,
      hasError,
      allSuccess,
      mainResult,
    };
  }, [cards]);

  // 核心改进：折叠逻辑稳定化
  // 1. 待授权时必须展开（用户需要操作）
  // 2. 卡片数 <= 2 时不折叠
  // 3. 用户手动操作后，保持用户的选择
  // 4. 正在运行时，不强制展开（这是导致抖动的根源）
  const canCollapse = !analysis.hasPendingAuth && cards.length > 2;
  
  // 首次达到可折叠条件时，记录并自动折叠
  React.useEffect(() => {
    if (canCollapse && initialCollapseCountRef.current === null && !userInteractedRef.current) {
      initialCollapseCountRef.current = cards.length;
      // 初始状态：折叠
      setExpanded(false);
    }
  }, [canCollapse, cards.length]);
  
  // 包装 setExpanded，标记用户已交互
  const handleToggle = React.useCallback(() => {
    userInteractedRef.current = true;
    setExpanded(prev => !prev);
  }, []);

  const shouldCollapse = canCollapse;

  // 如果不需要折叠，直接渲染所有卡片
  if (!shouldCollapse) {
    return (
      <div className="flex flex-col gap-2">
        {cards.map((card, idx) => (
          <ToolCallCard
            key={`card-${card.id || idx}`}
            server={card.server}
            tool={card.tool}
            status={card.status}
            args={card.args}
            resultPreview={card.resultPreview}
            errorMessage={card.errorMessage}
            schemaHint={card.schemaHint}
            messageId={card.messageId}
            cardId={card.id}
          />
        ))}
      </div>
    );
  }

  // 折叠视图
  return (
    <div className="space-y-2">
      {/* 主要结果（高优先级操作） */}
      {analysis.mainResult && !expanded && (
        <ToolCallCard
          server={analysis.mainResult.server}
          tool={analysis.mainResult.tool}
          status={analysis.mainResult.status}
          args={analysis.mainResult.args}
          resultPreview={analysis.mainResult.resultPreview}
          errorMessage={analysis.mainResult.errorMessage}
          schemaHint={analysis.mainResult.schemaHint}
          messageId={analysis.mainResult.messageId}
          cardId={analysis.mainResult.id}
        />
      )}

      {/* 折叠的步骤摘要 */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
          'bg-slate-50/30 hover:bg-slate-50/60 dark:bg-slate-900/10 dark:hover:bg-slate-900/20',
          'text-slate-500 dark:text-slate-400'
        )}
        onClick={handleToggle}
      >
        {/* 展开/折叠图标 */}
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" />
        )}

        {/* 状态图标 */}
        {analysis.hasError ? (
          <X className="w-3.5 h-3.5 text-red-500" />
        ) : analysis.allSuccess ? (
          <Check className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
        )}

        {/* 摘要文本 */}
        <span className="text-[12px]">
          {expanded ? '收起详细步骤' : (
            <>
              执行了 {analysis.total} 个步骤
              {analysis.lowPriority.length > 0 && (
                <span className="text-slate-400 dark:text-slate-500">
                  （含 {analysis.lowPriority.length} 个准备步骤）
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {/* 展开的详细步骤 */}
      {expanded && (
        <div className="ml-4 border-l-2 border-slate-200/60 dark:border-slate-700/60 pl-3 space-y-2">
          {cards.map((card, idx) => (
            <ToolCallCard
              key={`card-expanded-${card.id || idx}`}
              server={card.server}
              tool={card.tool}
              status={card.status}
              args={card.args}
              resultPreview={card.resultPreview}
              errorMessage={card.errorMessage}
              schemaHint={card.schemaHint}
              messageId={card.messageId}
              cardId={card.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 精简版工具调用列表
 * 
 * 用于在需要极简展示时使用，只显示图标和简短描述
 */
export function ToolCallListCompact({ cards }: { cards: ToolCardData[] }) {
  const [expanded, setExpanded] = useState(false);

  if (cards.length === 0) return null;

  // 只有1个卡片时直接显示
  if (cards.length === 1) {
    const card = cards[0];
    return (
      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        {card.status === 'success' && <Check className="w-3 h-3 text-green-500" />}
        {card.status === 'error' && <X className="w-3 h-3 text-red-500" />}
        {card.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
        {getToolIcon(card)}
        <span>{getShortDescription(card)}</span>
      </div>
    );
  }

  // 多个卡片时显示折叠列表
  const successCount = cards.filter(c => c.status === 'success').length;
  const errorCount = cards.filter(c => c.status === 'error').length;

  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>
          {successCount > 0 && <span className="text-green-600">✓{successCount}</span>}
          {errorCount > 0 && <span className="text-red-600 ml-1">✗{errorCount}</span>}
          <span className="ml-1">{cards.length} 个操作</span>
        </span>
      </div>

      {expanded && (
        <div className="ml-4 space-y-0.5">
          {cards.map((card, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500"
            >
              {card.status === 'success' && <Check className="w-2.5 h-2.5 text-green-500" />}
              {card.status === 'error' && <X className="w-2.5 h-2.5 text-red-500" />}
              {card.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-500" />}
              {getToolIcon(card)}
              <span className="truncate">{getShortDescription(card)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
