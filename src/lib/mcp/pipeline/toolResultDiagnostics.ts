type ToolId = { server: string; tool: string };

function lc(s: unknown): string {
  if (s === null || s === undefined) return '';
  if (typeof s === 'string' || typeof s === 'number' || typeof s === 'boolean' || typeof s === 'bigint') return String(s).toLowerCase();
  return '';
}

export function isNonFatalNonOkResult(id: ToolId, result: any): boolean {
  if (!(result && typeof result === 'object' && typeof result.ok === 'boolean' && result.ok === false)) return false;
  const srv = lc(id.server);
  const tl = lc(id.tool);

  // filesystem 删除：ok=false 可能是“部分失败”，不应该走异常重试
  if ((srv === 'fs' || srv === 'filesystem') && (tl === 'rm' || tl.includes('delete'))) {
    if (
      typeof result.failedCount === 'number' ||
      typeof result.deletedCount === 'number' ||
      typeof result.matchedCount === 'number' ||
      Array.isArray(result.failed) ||
      Array.isArray(result.deleted) ||
      Array.isArray(result.matches)
    ) {
      return true;
    }
  }
  return false;
}

export function buildHelpfulNonOkMessage(id: ToolId, result: any): { message: string; hints: string[] } {
  const srv = lc(id.server);
  const tl = lc(id.tool);

  // filesystem 删除：展示失败样例 + 可操作建议
  if ((srv === 'fs' || srv === 'filesystem') && (tl === 'rm' || tl.includes('delete'))) {
    const failed = Array.isArray(result.failed) ? (result.failed as any[]) : [];
    const failedCount = typeof result.failedCount === 'number' ? result.failedCount : failed.length;
    const deletedCount = typeof result.deletedCount === 'number' ? result.deletedCount : (Array.isArray(result.deleted) ? result.deleted.length : 0);
    const matchedCount = typeof result.matchedCount === 'number' ? result.matchedCount : undefined;

    const samples = failed
      .slice(0, 3)
      .map((x) => {
        const p = String(x?.path || '').trim();
        const e = String(x?.error || '').trim();
        return `- ${p || '(unknown path)'}: ${e || '(unknown error)'}`;
      })
      .filter(Boolean);

    const head =
      `删除结果：deleted=${deletedCount}, failed=${failedCount}` +
      (typeof matchedCount === 'number' ? `, matched=${matchedCount}` : '');
    const detail = samples.length ? `失败样例（前${samples.length}条）：\n${samples.join('\n')}` : '';
    const hints = [
      '如果是权限/白名单问题：先对目标目录授权（allowlist）再重试。',
      '如果是占用/锁定：关闭相关程序（或重启）后再删。',
      '规模删除建议：先 dryRun=true（dir+pattern）确认范围；或用 paths[] 传入精确路径列表。',
    ];

    const message = [head, detail].filter(Boolean).join('\n');
    return { message: message || '删除失败（ok=false）', hints };
  }

  // 通用兜底：尽量把对象结构“读得懂”
  const keys = result && typeof result === 'object' ? Object.keys(result).slice(0, 12) : [];
  const message = `工具返回 ok=false，但缺少明确的 error/message。可用字段：${keys.join(', ') || '(none)'}`;
  const hints = [
    '检查工具参数是否完整/拼写正确（必要时先用 ls 确认路径存在）。',
    '如果涉及授权：确认已对目录授权（allowlist）后重试。',
    '若仍失败：请让工具返回 failed/error 字段或展开失败样例。',
  ];
  return { message, hints };
}

export function detectFatalFailure(id: ToolId, result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r: any = result as any;

  // shell 风格
  if (typeof r.success === 'boolean' && r.success === false) {
    const parts: string[] = [];
    if (typeof r.error === 'string' && r.error) parts.push(r.error);
    if (typeof r.stderr === 'string' && r.stderr.trim()) parts.push(`stderr: ${r.stderr.trim().slice(0, 400)}`);
    if (typeof r.exitCode === 'number') parts.push(`exitCode: ${r.exitCode}`);
    return parts.join('\n') || 'command failed';
  }

  // ok=false：默认 fatal，但“部分失败”不 fatal
  if (typeof r.ok === 'boolean' && r.ok === false) {
    if (isNonFatalNonOkResult(id, r)) return undefined;
    if (typeof r.error === 'string' && r.error) return r.error;
    if (typeof r.message === 'string' && r.message) return r.message;
    if (r.error && typeof r.error === 'object' && typeof r.error.message === 'string') return String(r.error.message);
    return '工具返回 ok=false（缺少详细错误信息）';
  }

  return undefined;
}

export function buildFatalErrorHints(id: ToolId, message: string): string[] {
  const srv = lc(id.server);
  const tl = lc(id.tool);
  const m = lc(message);
  const out: string[] = [];

  if (m.includes('program not found')) {
    out.push('看起来是可执行程序找不到：检查命令是否为真实可执行文件，或换成正确的启动方式。');
    // Windows：提示用参数选择 shell，而不是让模型手写多层包裹
    out.push('建议：在 shell.run 里显式传 shell（Windows: "cmd"/"powershell"，macOS/Linux: "bash"），避免语义歧义与转义复杂度。');
  }
  if (m.includes('auth') || m.includes('denied') || m.includes('forbidden')) {
    out.push('看起来是权限/授权问题：请对目标目录授权（allowlist）后重试。');
  }
  if (m.includes('not found') || m.includes('path_not_found') || m.includes('no such file')) {
    out.push('看起来是路径不存在：先用 ls 确认路径是否正确，再重试。');
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    out.push('看起来是超时：缩小范围（limit 更小）或分批执行。');
  }
  if ((srv === 'fs' || srv === 'filesystem') && (tl === 'ls' || tl.includes('list'))) {
    out.push('大目录建议加 pattern+limit，避免一次列出太多。');
  }
  if ((srv === 'fs' || srv === 'filesystem') && (tl === 'rm' || tl.includes('delete'))) {
    out.push('删除建议先 dryRun=true（dir+pattern）确认匹配范围；或用 paths[] 批量精确删除。');
  }

  return out.length ? out : ['请检查参数与权限；必要时缩小范围后重试。'];
}

/**
 * A tool that returned a structured failure already told us what happened.
 * Keep every field it produced (stdout, stderr, exit code, candidates) and only
 * add the outcome marker, so a known failure is never downgraded into "the side
 * effect may or may not have happened".
 */
export function markKnownFailure(id: ToolId, result: unknown, failure: string): Record<string, unknown> {
  const base = result && typeof result === 'object' ? (result as Record<string, unknown>) : { value: result };
  const existing = base.errorDetails;
  const hasStructuredError =
    !!existing && typeof existing === 'object' ||
    (!!base.error && typeof base.error === 'object');
  return {
    ...base,
    resultStatus: 'failed',
    errorDetails: hasStructuredError
      ? existing ?? base.error
      : {
          code: 'TOOL_FAILED',
          message: failure,
          hints: buildFatalErrorHints(id, failure),
          server: id.server,
          tool: id.tool,
        },
  };
}

