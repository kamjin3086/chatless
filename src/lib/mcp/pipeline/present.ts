/**
 * 拒绝一次调用时回给模型的载荷。形状属于对模型的契约：
 * `public/tool-docs/fs.txt` 把 `AUTH_DENIED` 写成了对模型的承诺。仓库里目前没有任何代码
 * 读这个 code（`AgentLoopRunner` 读的是 `EXECUTION_UNKNOWN`），所以它的嵌套形状——
 * `error.code` 而不是扁平 `code` 或字符串 `error`——只能由 present.test.ts 钉住。
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
