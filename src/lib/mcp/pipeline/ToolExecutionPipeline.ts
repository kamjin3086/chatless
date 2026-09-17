import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';
import { getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import { isShellCommandTrusted, useShellAuthStore } from '@/store/shellAuthStore';
import { isPathWithinDirectory, resolveAllowlistPath } from '@/lib/filesystemAllowlist';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import { syncFilesystemAllowlistToBackend } from '@/lib/filesystemAllowlist/backendSync';
import { markError, markPendingAuth, markSuccess } from './ToolCardUpdater';
import type { ToolAdapter } from './ToolAdapter';
import { ToolInvocation } from './ToolInvocation';
import { appendWorkspaceToolStep } from '@/lib/agentWorkspace/manifestService';
import { buildFatalErrorHints, buildHelpfulNonOkMessage, detectFatalFailure, isNonFatalNonOkResult } from './toolResultDiagnostics';
import { isDirectorySemanticFsTool, isFilesystemServer, isShellServer, normalizeServerName } from '@/lib/mcp/toolNaming';

function normalizeSlashPath(p: unknown): string {
  if (typeof p === 'string') return p.trim().replace(/\\/g, '/');
  if (typeof p === 'number' || typeof p === 'boolean' || typeof p === 'bigint') return String(p).trim();
  return '';
}

function dirnamePath(p: string): string {
  const s = normalizeSlashPath(p);
  if (!s) return '';
  // keep drive root like C:/ intact
  if (/^[A-Za-z]:\/$/.test(s)) return s;
  const i = s.lastIndexOf('/');
  if (i <= 0) return s;
  return s.slice(0, i);
}

function buildAuthDeniedResult(params: {
  server: string;
  tool: string;
  message: string;
  conversationId?: string;
  assistantMessageId?: string;
  cardId?: string;
  args?: Record<string, unknown>;
  fs?: { op?: string; inputPath?: string; resolvedPath?: string; suggestDir?: string };
}) {
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

export type ToolExecutionPipelineDeps = {
  adapters: ToolAdapter[];
};

function isForcedApproval(server: string, tool: string, args?: Record<string, unknown>): boolean {
  const srv = normalizeServerName(server);
  const tl = String(tool || '').toLowerCase();

  // filesystem：仅 delete 强制人工确认（你选择的策略）
  if (isFilesystemServer(srv)) {
    return tl === 'delete_file' || tl === 'delete';
  }

  // shell_executor：涉及安装运行时/改环境变量/下载脚本等高风险动作，强制确认
  if (isShellServer(srv)) {
    const cmd = typeof (args as any)?.command === 'string' ? String((args as any).command).toLowerCase() : '';
    if (!cmd) return false;
    if (cmd.includes('winget ') || cmd.includes('choco ')) return true;
    if (cmd.includes('setx ') || cmd.includes('set environmentvariable') || cmd.includes('set-itemproperty')) return true;
    // 下载脚本执行（curl|bash / iwr|iex 等）
    if (cmd.includes('| bash') || cmd.includes('| sh') || cmd.includes('|iex') || cmd.includes('| iex')) return true;
  }

  return false;
}

function needsAuthorization(server: string, tool: string, autoAuth: boolean, args?: Record<string, unknown>): boolean {
  const srv = normalizeServerName(server);
  const tl = String(tool || '').toLowerCase();

  if (isForcedApproval(server, tool, args)) return true;

  // shell_executor：若用户已“信任该工作目录”，且命令属于低风险清单，则可免重复审批
  if (isShellServer(srv)) {
    try {
      if (isShellCommandTrusted({ command: (args as any)?.command, workingDir: (args as any)?.workingDir })) {
        return false;
      }
    } catch {
      // ignore
    }
  }

  // user_fs：保持现有行为——仅写入需要确认（读/list 属于“在已授权目录内的低风险操作”）
  if (srv === 'user_fs') {
    return tl === 'write_user_file' && !autoAuth;
  }

  // Skill installation and modification change the local execution
  // environment.  Only inspection remains approval-free.
  if (srv === 'skills_fs') {
    return !/^(read_skill_resource|list_skill_resources|list_files)$/.test(tl);
  }
  if (srv === 'skills' || srv === 'skill') {
    return !/^(list|guide|read_file|list_files|check_deps|use)$/.test(tl);
  }

  // tools: auto-approve
  if (srv === 'tools') {
    return false;
  }

  // System reads are safe; prompt and skill administration is not.
  if (srv === 'system') {
    return !/^(list_prompts|get_prompt|list_skills)$/.test(tl);
  }

  // filesystem：授权由 allowlist gate 统一管理，这里不参与（返回 false 以避免“全局 autoAuth”影响文件系统安全边界）
  if (isFilesystemServer(srv)) {
    return false;
  }

  // 其余：按 server 粒度控制
  return !autoAuth;
}

function isPlanOnlyAllowed(server: string, tool: string): boolean {
  const srv = normalizeServerName(server).toLowerCase();
  const tl = String(tool || '').toLowerCase();
  if (isFilesystemServer(srv)) return /^(read|read_file|list|list_directory|ls|dir|stat|exists|search)$/.test(tl);
  if (srv === 'knowledge') return /^(list|search|read)$/.test(tl);
  if (srv === 'web_search' || srv === 'web') return /^(search|fetch)$/.test(tl);
  if (srv === 'tools') return tl === 'search';
  if (srv === 'skill') return /^(list|guide|use|read_file|list_files|check_deps)$/.test(tl);
  if (srv === 'system') return /^(list_prompts|get_prompt)$/.test(tl);
  return false;
}

function getFilesystemOp(tool: string): 'read' | 'write' | 'create' | 'delete' {
  const tl = String(tool || '').toLowerCase();
  if (tl === 'delete_file' || tl === 'delete' || tl === 'rm') return 'delete';
  // MCP filesystem 常见工具名：read_file / list_directory / write_file
  if (tl === 'read_file' || tl === 'read' || tl === 'list_directory' || tl === 'list' || tl === 'dir' || tl === 'ls') return 'read';
  // rename/move 视为写入类操作
  if (tl === 'rename_file' || tl === 'rename' || tl === 'move_file' || tl === 'move' || tl === 'mv') return 'write';
  if (tl === 'write_file' || tl === 'write') return 'write';
  if (tl === 'mkdir' || tl === 'create_directory' || tl === 'create') return 'create';
  return 'read';
}

function isDirectoryScopedFilesystemTool(tool: string): boolean {
  return isDirectorySemanticFsTool(tool);
}

/**
 * 统一工具执行管线：去重 -> 授权 -> 执行 -> 更新卡片 -> 返回结果
 *
 * 多工具顺序和下一模型步由 AgentLoopRunner 统一承担；Pipeline 只负责一次调用。
 */
export class ToolExecutionPipeline {
  private coordinator = ToolCallCoordinator.getInstance();
  private adapters: ToolAdapter[];

  constructor(deps: ToolExecutionPipelineDeps) {
    this.adapters = deps.adapters;
  }

  private findAdapter(invocation: ToolInvocation): ToolAdapter | null {
    for (const a of this.adapters) {
      if (a.canHandle(invocation)) return a;
    }
    return null;
  }

  async run(invocation: ToolInvocation): Promise<unknown> {
    const { assistantMessageId, server, tool, args, callId } = invocation;
    if (this.coordinator.isMessageCancelled(assistantMessageId)) {
      return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
    }
    const cardId = invocation.ensureCardId();
    if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
      return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
    }
    const lockResult = invocation.lockKey
      ? { acquired: true, key: invocation.lockKey }
      : this.coordinator.tryAcquireToolCallLock({
          messageId: assistantMessageId,
          server,
          tool,
          args,
          callId,
          cardId,
          source: 'execute',
        });

    // 去重（若未拿到锁则直接返回）
    if (!lockResult.acquired) {
      return { skipped: true, reason: 'DUPLICATE_CALL', callKey: lockResult.key };
    }
    const callKey = lockResult.key;

    const adapter = this.findAdapter(invocation);
    if (!adapter) {
      const msg = `No adapter for tool: ${server}.${tool}`;
      markError({ assistantMessageId, server, tool, cardId }, msg);
      this.coordinator.markToolCallComplete(callKey, 'failed');
      return { error: 'NO_ADAPTER', message: msg };
    }

    if (invocation.planOnly && !isPlanOnlyAllowed(server, tool)) {
      const blocked = {
        ok: false,
        error: {
          code: 'PLAN_ONLY_BLOCKED',
          message: `计划模式禁止执行有副作用的工具: ${server}.${tool}`,
          server,
          tool,
        },
      };
      markError({ assistantMessageId, server, tool, cardId }, blocked.error.message);
      this.coordinator.markToolCallComplete(callKey, 'failed');
      return blocked;
    }

    // 预加载：shell 授权记忆（用于 needsAuthorization 的同步判断）
    try {
      if (isShellServer(normalizeServerName(server))) {
        await useShellAuthStore.getState().load();
      }
    } catch {
      // ignore
    }

    // 授权 + filesystem allowlist gate（统一文件系统安全边界）
    let execInvocation: ToolInvocation = invocation;
    const srvLower = normalizeServerName(server);

    // 预处理：shell_executor 的 workingDir 和 command 支持 @WorkDir / @Alias / 相对路径
    if (isShellServer(srvLower)) {
      try {
        const allowlist = useFilesystemAllowlistStore.getState();
        await allowlist.load();
        const dirsForResolve = [...allowlist.directories];
        let shellWorkDir: string | undefined;
        try {
          const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
          const wd = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
          if (wd) {
            shellWorkDir = String(wd).replace(/\\/g, '/');
            dirsForResolve.unshift({
              id: `session:${invocation.conversationId}:workdir`,
              path: shellWorkDir,
              alias: 'WorkDir',
              permissions: { read: true, write: true, create: true, delete: false },
              source: 'workdir',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            } as any);
          }
        } catch {
          // ignore
        }

        const execArgs: Record<string, unknown> = { ...(args || {}) };

        // 解析 workingDir 参数中的别名
        const workingDirInput = typeof (args as any)?.workingDir === 'string' ? String((args as any).workingDir) : '';
        if (workingDirInput) {
          const shellResolved = resolveAllowlistPath({ inputPath: workingDirInput, directories: dirsForResolve as any, workingDir: shellWorkDir });
          execArgs.workingDir = shellResolved.absolutePath;
        }

        // 解析 command 参数中的 @WorkDir / @Alias 别名
        const commandInput = typeof (args as any)?.command === 'string' ? String((args as any).command) : '';
        if (commandInput && commandInput.includes('@')) {
          let resolvedCommand = commandInput;
          // 替换 @WorkDir 别名（支持 @WorkDir、@WorkDir/、@WorkDir\）
          if (shellWorkDir) {
            // 使用全局替换，支持多种后缀形式
            resolvedCommand = resolvedCommand.replace(/@WorkDir(?=[\/\\]|$|\s|"|')/g, shellWorkDir);
          }
          // 替换其他 @Alias 别名（格式：@AliasName 或 @AliasName/path）
          for (const dir of dirsForResolve) {
            if (dir.alias && dir.path) {
              const aliasName = String(dir.alias);
              // 使用动态正则，匹配 @AliasName 后跟路径分隔符、空白、引号或字符串结尾
              const pattern = new RegExp(`@${aliasName}(?=[/\\\\]|$|\\s|"|')`, 'g'); // eslint-disable-line no-useless-escape
              resolvedCommand = resolvedCommand.replace(pattern, String(dir.path).replace(/\\/g, '/'));
            }
          }
          if (resolvedCommand !== commandInput) {
            execArgs.command = resolvedCommand;
          }
        }

        execInvocation = new ToolInvocation({
          assistantMessageId: invocation.assistantMessageId,
          conversationId: invocation.conversationId,
          server: invocation.server,
          tool: invocation.tool,
          args: execArgs,
          provider: invocation.provider,
          model: invocation.model,
          historyForLlm: invocation.historyForLlm,
          originalUserContent: invocation.originalUserContent,
          callId: invocation.callId,
          cardId,
          lockKey: invocation.lockKey,
          providerData: invocation.providerData,
          planOnly: invocation.planOnly,
        });
      } catch {
        // ignore: best-effort（解析失败则保持原参数，让后续校验/授权处理）
      }
    }

    if (isFilesystemServer(srvLower)) {
      // 提取所有可能的路径参数
      const rawPath = typeof (args as any)?.path === 'string' ? String((args as any).path) : '';
      const rawDir = typeof (args as any)?.dir === 'string' ? String((args as any).dir) : '';
      const rawOldPath = typeof (args as any)?.oldPath === 'string' ? String((args as any).oldPath) : '';
      const rawNewPath = typeof (args as any)?.newPath === 'string' ? String((args as any).newPath) : '';
      const rawPaths = Array.isArray((args as any)?.paths)
        ? ((args as any).paths as unknown[]).map((p) => String(p ?? '').trim()).filter(Boolean)
        : [];
      
      // 主路径用于权限检查
      const inputPath = rawPath || rawDir || rawOldPath || '';
      const op = getFilesystemOp(tool);
      
      // 判断是否有任何需要解析的路径
      const hasPathsToResolve = inputPath || rawNewPath || rawPaths.length > 0;

      if (hasPathsToResolve) {
        try {
          const allowlist = useFilesystemAllowlistStore.getState();
          await allowlist.load();
          // 会话级别名：@WorkDir（来自附件菜单）
          const dirsForResolve = [...allowlist.directories];
          let workingDir: string | undefined;
          try {
            const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
            const wd = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
            if (wd) {
              workingDir = String(wd).replace(/\\/g, '/');
              dirsForResolve.unshift({
                id: `session:${invocation.conversationId}:workdir`,
                path: workingDir,
                alias: 'WorkDir',
                permissions: { read: true, write: true, create: true, delete: false },
                source: 'workdir',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              } as any);
            }
          } catch {
            // ignore
          }

          // 确保后端 allowlist 与前端一致（避免后端最终校验拦截）
          try {
            await syncFilesystemAllowlistToBackend(dirsForResolve as any);
          } catch {
            // ignore: best-effort sync
          }

          // 路径解析辅助函数：支持相对路径、别名路径、绝对路径
          const resolvePath = (p: string) => {
            if (!p.trim()) return '';
            return resolveAllowlistPath({ inputPath: p, directories: dirsForResolve as any, workingDir }).absolutePath;
          };

          // 解析主路径用于权限检查
          const resolved = inputPath
            ? resolveAllowlistPath({ inputPath, directories: dirsForResolve as any, workingDir })
            : null;

          // 构建执行参数，解析所有路径
          const execArgs: Record<string, unknown> = { ...(args || {}) };
          
          // 解析 path/dir 参数
          if (resolved) {
            if (rawPath) execArgs.path = resolved.absolutePath;
            if (rawDir) execArgs.dir = resolved.absolutePath;
          }
          
          // 解析 rename/move 的 oldPath 和 newPath
          if (rawOldPath) execArgs.oldPath = resolvePath(rawOldPath);
          if (rawNewPath) execArgs.newPath = resolvePath(rawNewPath);
          
          // 解析 paths 数组（用于 delete_many 等）
          if (rawPaths.length > 0) {
            execArgs.paths = rawPaths.map(resolvePath).filter(Boolean);
          }

          execInvocation = new ToolInvocation({
            assistantMessageId: invocation.assistantMessageId,
            conversationId: invocation.conversationId,
            server: invocation.server,
            tool: invocation.tool,
            args: execArgs,
            provider: invocation.provider,
            model: invocation.model,
            historyForLlm: invocation.historyForLlm,
            originalUserContent: invocation.originalUserContent,
            callId: invocation.callId,
            cardId,
            lockKey: invocation.lockKey,
          });

          // 获取主路径的绝对路径（用于权限检查和授权）
          const primaryAbsolutePath = resolved?.absolutePath || '';
          
          const forceApproval = op === 'delete';
          const hasDir = !!resolved?.directory;
          const hasPerm = hasDir ? !!resolved?.directory?.permissions?.[op] : false;
          const needAuth = primaryAbsolutePath && (forceApproval || !hasDir || !hasPerm);

          if (needAuth) {
            markPendingAuth({ assistantMessageId, server, tool, cardId });
            const authorized = await new Promise<boolean>((resolve) => {
              const authId = `${assistantMessageId}:${cardId}`;
              useAuthorizationStore.getState().addPendingAuthorization({
                id: authId,
                messageId: assistantMessageId,
                server,
                tool,
                args: args || {},
                createdAt: Date.now(),
                onApprove: () => resolve(true),
                onReject: () => resolve(false),
              });
            });

            if (this.coordinator.isMessageCancelled(assistantMessageId)) {
              this.coordinator.markToolCallComplete(callKey, 'failed');
              return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
            }
            if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
              this.coordinator.markToolCallComplete(callKey, 'failed');
              return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
            }
            if (!authorized) {
              const suggestDir = normalizeSlashPath(resolved?.directory?.path) || dirnamePath(primaryAbsolutePath);
              markError(
                { assistantMessageId, server, tool, cardId },
                `用户拒绝授权此文件系统操作（${op}）：${suggestDir || primaryAbsolutePath}`
              );
              this.coordinator.markToolCallComplete(callKey, 'failed');
              const denied = buildAuthDeniedResult({
                server,
                tool,
                message: 'User denied authorization',
                conversationId: invocation.conversationId,
                assistantMessageId,
                cardId,
                args: args || {},
                fs: {
                  op,
                  inputPath,
                  resolvedPath: primaryAbsolutePath,
                  suggestDir,
                },
              });
              try {
                await appendWorkspaceToolStep({
                  conversationId: invocation.conversationId,
                  assistantMessageId,
                  cardId,
                  callId,
                  server,
                  tool,
                  args: args || {},
                  result: denied,
                });
              } catch {
                // ignore
              }
              return denied;
            }

            // 用户确认后：把目录加入 allowlist（或补齐权限），并同步到 Rust 后端
            try {
              const st = useFilesystemAllowlistStore.getState();
              const hasDirArg = typeof (args as any)?.dir === 'string';
              const dirScopedByTool = isDirectoryScopedFilesystemTool(tool);

              // 规则：
              // - dir+pattern 或 ls/mkdir 这类“目录语义”工具：授权目录本身（避免更具体条目覆盖父目录权限造成 forbidden）
              // - 其余（文件语义）：授权其所在目录（目录白名单模型）
              if (hasDirArg || dirScopedByTool) {
                await st.upsertDirectory({ directoryPath: primaryAbsolutePath, op: op as any, source: 'manual' } as any);
              } else {
                await st.upsertDirectoryForPath({ absolutePath: primaryAbsolutePath, op: op as any, source: 'manual' });
              }

              // 删除动作需要“读取目录/枚举条目”才能执行（尤其 dir+pattern / 删除目录），否则后端会先 Read 再 Delete。
              // UX：用户既然确认了 delete，这里为同一目录补齐 read（不扩大到其它目录）。
              if (op === 'delete') {
                if (hasDirArg || dirScopedByTool) {
                  await st.upsertDirectory({ directoryPath: primaryAbsolutePath, op: 'read' as any, source: 'manual' } as any);
                } else {
                  await st.upsertDirectoryForPath({ absolutePath: primaryAbsolutePath, op: 'read' as any, source: 'manual' });
                }
              }
              const allowDeleteInWorkDir =
                op === 'delete' && !!workingDir && isPathWithinDirectory({ absolutePath: primaryAbsolutePath, directoryPath: workingDir });

              const extra = workingDir
                ? [
                    {
                      id: `session:${invocation.conversationId}:workdir`,
                      path: workingDir,
                      alias: 'WorkDir',
                      // 默认 WorkDir 不允许 delete；但若用户对 WorkDir 范围内的删除操作明确确认，则本次同步升级 delete 权限
                      permissions: { read: true, write: true, create: true, delete: allowDeleteInWorkDir },
                      source: 'workdir',
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    } as any,
                  ]
                : [];
              await syncFilesystemAllowlistToBackend([...st.directories, ...extra] as any);
            } catch {
              // ignore: best-effort
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          markError({ assistantMessageId, server, tool, cardId }, msg);
          this.coordinator.markToolCallComplete(callKey, 'failed');
          const gateFailed = {
            ok: false,
            error: {
              code: 'FILESYSTEM_GATE_FAILED',
              message: msg,
              server,
              tool,
              args: args || {},
            },
          };
          try {
            await appendWorkspaceToolStep({
              conversationId: invocation.conversationId,
              assistantMessageId,
              cardId,
              callId,
              server,
              tool,
              args: args || {},
              result: gateFailed,
            });
          } catch {
            // ignore
          }
          return gateFailed;
        }
      }
    } else {
      const autoAuth = await shouldAutoAuthorize(server);
      const effectiveArgs = (execInvocation.args || args || {}) as any;
      if (needsAuthorization(server, tool, autoAuth, effectiveArgs || {})) {
        markPendingAuth({ assistantMessageId, server, tool, cardId });
        const authorized = await new Promise<boolean>((resolve) => {
          const authId = `${assistantMessageId}:${cardId}`;
          useAuthorizationStore.getState().addPendingAuthorization({
            id: authId,
            messageId: assistantMessageId,
            server,
            tool,
            args: effectiveArgs || {},
            createdAt: Date.now(),
            onApprove: () => resolve(true),
            onReject: () => resolve(false),
          });
        });
        if (this.coordinator.isMessageCancelled(assistantMessageId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
        }
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        if (!authorized) {
          markError({ assistantMessageId, server, tool, cardId }, '用户拒绝授权此工具调用');
          this.coordinator.markToolCallComplete(callKey, 'failed');
          const denied = buildAuthDeniedResult({
            server,
            tool,
            message: 'User denied authorization',
            conversationId: invocation.conversationId,
            assistantMessageId,
            cardId,
            args: effectiveArgs || {},
          });
          try {
            await appendWorkspaceToolStep({
              conversationId: invocation.conversationId,
              assistantMessageId,
              cardId,
              callId,
              server,
              tool,
              args: effectiveArgs || {},
              result: denied,
            });
          } catch {
            // ignore
          }
          return denied;
        }

        // UX：shell_executor 同意后，若提供了 workingDir，则“记住该工作目录”（降低后续重复确认）
        try {
          const srv = String(server || '').toLowerCase();
          if (srv === 'shell_executor') {
            const wd = typeof (effectiveArgs as any)?.workingDir === 'string' ? String((effectiveArgs as any).workingDir) : '';
            const cmd = typeof (effectiveArgs as any)?.command === 'string' ? String((effectiveArgs as any).command) : '';
            if (wd.trim() && cmd.trim()) {
              // 仅对低风险命令进行“记忆”，高风险仍会被 isForcedApproval 拦下
              if (!isForcedApproval(server, tool, effectiveArgs || {}) && isShellCommandTrusted({ command: cmd, workingDir: wd })) {
                // already trusted: no-op
              } else {
                // 只记目录，不记具体命令；后续仍受 SAFE_EXECUTABLES 限制
                await useShellAuthStore.getState().addTrustedWorkingDir(wd);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    const cfg = await getAgentExperienceConfig();
    const srvForRetry = normalizeServerName(server).toLowerCase();
    const toolForRetry = String(tool || '').toLowerCase();
    const isReadOnlyRetry =
      (isFilesystemServer(srvForRetry) && /^(read|read_file|list|list_directory|ls|dir|stat|exists|search)$/.test(toolForRetry)) ||
      (srvForRetry === 'knowledge' && /^(list|search|read)$/.test(toolForRetry)) ||
      (srvForRetry === 'web_search' && /^(search|fetch)$/.test(toolForRetry)) ||
      (srvForRetry === 'tools' && toolForRetry === 'search');
    // A timeout after a write, shell command, or unknown MCP operation does not
    // tell us whether the side effect happened. Never replay those calls.
    const maxRetries = isReadOnlyRetry && typeof cfg.maxToolRetries === 'number'
      ? Math.max(0, Math.min(5, cfg.maxToolRetries))
      : 0;

    const toolId = { server, tool };

    const isRetryable = (message: string): boolean => {
      const m = String(message || '').toLowerCase();
      // 常见瞬态失败：超时/网络抖动/后端忙
      if (m.includes('timeout') || m.includes('超时')) return true;
      if (m.includes('econnreset') || m.includes('etimedout') || m.includes('network')) return true;
      if (m.includes('502') || m.includes('503') || m.includes('429')) return true;
      // 偶发：资源占用/锁
      if (m.includes('ebusy') || m.includes('resource busy') || m.includes('temporarily')) return true;
      return false;
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    let attempt = 0;
    let lastErr = '';
    while (attempt <= maxRetries) {
      if (this.coordinator.isMessageCancelled(assistantMessageId)) {
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
      }
      if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
      }

      try {
        const raw = await adapter.execute(execInvocation);
        const result: any = raw as any;

        // ok=false 但包含部分失败细节：不异常重试；直接标记为 error 并把细节回灌给模型/用户
        if (result && typeof result === 'object' && typeof result.ok === 'boolean' && result.ok === false && isNonFatalNonOkResult(toolId, result)) {
          const extra = buildHelpfulNonOkMessage(toolId, result);
          const enriched = {
            ...result,
            error: {
              code: 'TOOL_PARTIAL_FAILURE',
              message: extra.message,
              hints: extra.hints,
              server,
              tool,
            },
          };

          markError({ assistantMessageId, server, tool, cardId }, extra.message);
          try {
            await appendWorkspaceToolStep({
              conversationId: invocation.conversationId,
              assistantMessageId,
              cardId,
              callId,
              server,
              tool,
              args: (execInvocation.args || args || {}) as any,
              result: enriched,
            });
          } catch {
            // ignore
          }
          this.coordinator.markToolCallComplete(callKey, 'completed');
          return enriched;
        }

        const failure = detectFatalFailure(toolId, result);
        if (failure) throw new Error(failure);
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        markSuccess({ assistantMessageId, server, tool, cardId }, result);
        try {
          await appendWorkspaceToolStep({
            conversationId: invocation.conversationId,
            assistantMessageId,
            cardId,
            callId,
            server,
            tool,
            args: (execInvocation.args || args || {}) as any,
            result,
          });
        } catch {
          // ignore
        }
        this.coordinator.markToolCallComplete(callKey, 'completed');
        return result;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        const canRetry = attempt < maxRetries && isRetryable(lastErr);
        if (canRetry) {
          attempt += 1;
          // 轻量退避，避免立即撞同样的错误
          await sleep(300 * attempt);
          continue;
        }

        // 最终失败：返回“可行动”的结构化错误，避免 AI 乱猜
        const hints = buildFatalErrorHints(toolId, lastErr);
        const summary = {
          ok: false,
          // 保持兼容：仍提供扁平字段（旧逻辑可能读取它们）
          error: 'TOOL_EXEC_FAILED',
          message: lastErr,
          attempts: attempt + 1,
          maxRetries,
          hints,
          // 新增：结构化错误（便于 UI/模型直接读懂）
          errorDetails: {
            code: isReadOnlyRetry ? 'TOOL_EXEC_FAILED' : 'TOOL_RESULT_UNKNOWN',
            message: lastErr,
            hints,
            attempts: attempt + 1,
            maxRetries,
            server,
            tool,
          },
          resultStatus: isReadOnlyRetry ? 'failed' : 'unknown',
        };
        markError({ assistantMessageId, server, tool, cardId }, lastErr);
        try {
          await appendWorkspaceToolStep({
            conversationId: invocation.conversationId,
            assistantMessageId,
            cardId,
            callId,
            server,
            tool,
            args: (execInvocation.args || args || {}) as any,
            result: summary,
          });
        } catch {
          // ignore
        }
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return summary;
      }
    }

    // 理论上不会走到这里
    const hints = buildFatalErrorHints(toolId, lastErr || 'Unknown error');
    const summary = {
      ok: false,
      error: 'TOOL_EXEC_FAILED',
      message: lastErr || 'Unknown error',
      attempts: maxRetries + 1,
      maxRetries,
      hints,
      errorDetails: {
        code: 'TOOL_EXEC_FAILED',
        message: lastErr || 'Unknown error',
        hints,
        attempts: maxRetries + 1,
        maxRetries,
        server,
        tool,
      },
    };
    markError({ assistantMessageId, server, tool, cardId }, summary.message);
    this.coordinator.markToolCallComplete(callKey, 'failed');
    return summary;
  }
}

