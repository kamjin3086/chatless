export interface ContentAppender {
  append: (chunk: string) => void;
  flush: () => void;
  /** 当前累积的可见正文（不经过 store）。 */
  getContent: () => string;
}

/**
 * 流式正文的唯一写入者。
 *
 * 正文在本地字符串里累积，只有跨过自动保存阈值或显式 flush 时才写 store + DB。
 * 之前是"每个 chunk 都写一次全局 store"，那会让聊天页、布局和侧边栏每 chunk
 * 重渲染一次；UI 本来就以 segments 为准，正文只需要低频落盘。
 *
 * 流式期间 store 里的 content 允许短暂滞后（≤ AUTOSAVE_CHARS），
 * 流结束时由 StreamOrchestrator.finalizeStreamedMessage 写全量。
 */
export const CONTENT_AUTOSAVE_CHARS = 200;

export function createContentAppender(params: {
  assistantMessageId: string;
  /** 起始内容（通常来自 store，用于续写/重放）。 */
  initialContent: string;
  updateMessage: (id: string, patch: any) => Promise<void>;
}): ContentAppender {
  let content = String(params.initialContent || '');
  let persistedLength = content.length;

  const persist = () => {
    persistedLength = content.length;
    try {
      void params.updateMessage(params.assistantMessageId, { content });
    } catch {
      /* noop */
    }
  };

  return {
    append: (chunk: string) => {
      if (!chunk) return;
      content += chunk;
      if (content.length - persistedLength >= CONTENT_AUTOSAVE_CHARS) persist();
    },
    getContent: () => content,
    flush: persist,
  };
}


