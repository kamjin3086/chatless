"use client";

import React from 'react';
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
 * 工具调用列表组件
 * 
 * 简单列表展示，每个工具调用独立显示。
 * 单个卡片默认预览模式，点击可展开详情。
 */
export function ToolCallGroup({ cards, isStreaming: _isStreaming }: ToolCallGroupProps) {
  if (cards.length === 0) return null;

  return (
    <div className="space-y-0.5">
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

/**
 * 精简版工具调用列表（保留兼容性）
 */
export function ToolCallListCompact({ cards }: { cards: ToolCardData[] }) {
  return <ToolCallGroup cards={cards} />;
}
