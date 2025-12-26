"use client";

import React, { useMemo, useState } from 'react';
import type { Message } from '@/types/chat';
import { ChatMessage } from './ChatMessage';

interface VersionedAssistantGroupProps {
  versions: Message[]; // 按时间/版本序升序
  onEditMessage: (messageId: string, content: string) => void;
  onRetryMessage?: (messageId: string) => void;
  onSaveThinkingDuration?: (messageId: string, duration: number) => void;
}

export function VersionedAssistantGroup({ versions, onEditMessage, onRetryMessage, onSaveThinkingDuration }: VersionedAssistantGroupProps) {
  const sorted = useMemo(() => {
    const list = [...versions];
    list.sort((a, b) => (a.version_index ?? 0) - (b.version_index ?? 0));
    return list;
  }, [versions]);

  // 默认显示最新版本（版本数组的最后一个）
  const [index, setIndex] = useState(() => sorted.length - 1);
  
  // 当版本数组变化时，自动切换到最新版本
  React.useEffect(() => {
    setIndex(sorted.length - 1);
  }, [sorted.length]);

  const current = sorted[Math.max(0, Math.min(index, sorted.length - 1))];

  const go = (delta: number) => {
    setIndex((i) => {
      const next = Math.min(sorted.length - 1, Math.max(0, i + delta));
      return next;
    });
  };

  if (!current) return null;

  return (
    <div className="w-full">
      <ChatMessage
        id={current.id}
        content={current.content}
        role={current.role}
        timestamp={new Date(current.created_at).toISOString()}
        model={current.model}
        onEdit={() => onEditMessage(current.id, current.content)}
        onRetry={onRetryMessage ? (() => onRetryMessage(current.id)) : undefined}
        status={current.status}
        thinking_duration={current.thinking_duration}
        thinking_start_time={current.thinking_start_time}
        onSaveThinkingDuration={onSaveThinkingDuration}
        documentReference={current.document_reference as any}
        contextData={current.context_data}
        knowledgeBaseReference={current.knowledge_base_reference as any}
        images={current.images}
        segments={current.segments}
        viewModel={current.segments_vm}
        version_group_id={current.version_group_id}
        version_index={current.version_index}
        versionControls={{ current: (current.version_index ?? 0) + 1, total: sorted.length, onPrev: () => go(-1), onNext: () => go(1) }}
      />
    </div>
  );
}


