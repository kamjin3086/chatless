/**
 * 拒绝一次调用时回给模型的载荷。形状属于对模型的契约：
 * `public/tool-docs/fs.txt` 承诺了 `AUTH_DENIED` 的含义，`AgentLoopRunner` 读的是
 * 嵌套的 `error.code`，所以不能拿字符串 `error` 或扁平的 `code` 顶替。
 */
export type AuthDeniedParams = {
  server: string;
  tool: string;
  message: string;
  conversationId?: string;
  assistantMessageId?: string;
  cardId?: string;
  args?: Record<string, unknown>;
  fs?: { op?: string; inputPath?: string; resolvedPath?: string; suggestDir?: string };
};

/** 函数体自 main 原样搬来、未作改写；形状由 present.test.ts 钉住。 */
export function buildAuthDeniedResult(params: AuthDeniedParams) {
  return {
    ok: false,
    error: {
      code: 'AUTH_DENIED',
      message: params.message,
      server: params.server,
      tool: params.tool,
      conversationId: params.conversationId,
      assistantMessageId: params.assistantMessageId,
      cardId: params.cardId,
      args: params.args || {},
      fs: params.fs,
      suggestion:
        params.server === 'filesystem' || params.server === 'fs'
          ? {
              action: 'REQUEST_DIRECTORY_AUTH',
              directory: params.fs?.suggestDir,
              note: '需要用户授权该目录（加入 allowlist）后才能继续执行 filesystem 操作。',
            }
          : {
              action: 'REQUEST_TOOL_APPROVAL',
              note: '需要用户批准该工具调用后才能继续执行。',
            },
    },
  };
}
