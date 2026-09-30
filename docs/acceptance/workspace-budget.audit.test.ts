/**
 * 工作目录语义与输出预算的验收门槛。
 *
 * 基线 e926e70 时这 8 条全部失败（见 docs/workspace-budget-acceptance-2026-09-22.md）。
 * 现在它们不再是"一次性探针"，而是随 `pnpm test` 常跑的回归；每条仍跑在生产入口上，
 * 只是入口按修复后的架构落位：
 *
 *  - 预算：`ModelParametersService`（生产参数转换入口）
 *  - 目录：Rust 命令的前端契约（`workspace_*` 的真实参数与返回值）
 *  - 持久化：`conversationAttachmentStore`
 *
 * Rust 实现本身（目录创建/找回/导出/回收站/文件历史）由 cargo 测试覆盖：
 * `src-tauri/src/workspace/commands.rs`、`naming.rs`、`src-tauri/src/filesystem/history.rs`。
 * 真实后端行为另由 `docs/acceptance/workspace-history-probe.py`（经 cmd_bridge）验证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import { ModelParametersService } from '@/lib/model-parameters';
import { DEFAULT_MODEL_PARAMETERS } from '@/types/model-params';
import {
  ensureConversationWorkspace,
  ensureConversationWorkspaceMaterialized,
  exportConversationWorkspace,
  trashConversationWorkspaces,
} from '@/lib/agentWorkspace/workspaceService';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';

const WORKSPACE_INFO = {
  ok: true,
  conversationId: 'conv-1',
  root: 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21',
  manifestPath: 'C:/Users/x/Documents/Chatless/线缆整改-3f9a21/manifest.json',
  created: false,
  adoptedLegacy: false,
};

beforeEach(() => {
  mocks.invoke.mockReset();
  useConversationAttachmentStore.setState({
    sessionDirByConversation: {},
    workspaceExistsByConversation: {},
    mountedDirByConversation: {},
    workspaceErrorByConversation: {},
    knowledgeBaseByConversation: {},
  } as never);
});

describe('output budget through production parameter conversion', () => {
  it('keeps input space for an 8K model with untouched defaults', () => {
    const parameters = { ...DEFAULT_MODEL_PARAMETERS, contextWindow: 8192 };
    const options = ModelParametersService.applyOutputBudget(
      ModelParametersService.convertToChatOptions(parameters), parameters,
    );
    // 默认（自动）不下发 max_tokens：不再用一个推算值替模型决定单次输出多久。
    // 这里的关键仍然是"不要给 8K 窗口钉死一个 8192"。
    expect(options.maxTokens).toBeUndefined();
    expect(options.contextWindowTokens).toBe(8192);
  });

  it('does not send the implicit default when the window is unknown', () => {
    const options = ModelParametersService.applyOutputBudget(
      ModelParametersService.convertToChatOptions(DEFAULT_MODEL_PARAMETERS), {},
    );
    expect(options.maxTokens).toBeUndefined();
  });

  it('honors the disabled output limit shown in the parameter dialog', () => {
    const parameters = { ...DEFAULT_MODEL_PARAMETERS, enableMaxTokens: false, contextWindow: 262144 };
    const options = ModelParametersService.applyOutputBudget(
      ModelParametersService.convertToChatOptions(parameters), parameters,
    );
    expect(options.maxTokens).toBeUndefined();
  });

  it('still sends an explicitly chosen value, clamped to the window', () => {
    const parameters = { ...DEFAULT_MODEL_PARAMETERS, enableMaxTokens: true, maxTokens: 4096, contextWindow: 262144 };
    const options = ModelParametersService.applyOutputBudget(
      ModelParametersService.convertToChatOptions(parameters), parameters,
    );
    expect(options.maxTokens).toBe(4096);

    const tooLarge = { ...parameters, maxTokens: 60000, contextWindow: 32768 };
    const clamped = ModelParametersService.applyOutputBudget(
      ModelParametersService.convertToChatOptions(tooLarge), tooLarge,
    );
    expect(clamped.maxTokens).toBe(32768);
  });

  it('takes the smaller of the user window and the reported window', () => {
    // A provider that shrinks its window must not be masked by a stale user value.
    expect(ModelParametersService.effectiveContextWindow({ contextWindow: 262144, observedContextWindow: 8192 }))
      .toBe(8192);
    expect(ModelParametersService.effectiveContextWindow({ contextWindow: 8192, observedContextWindow: 262144 }))
      .toBe(8192);
    expect(ModelParametersService.effectiveContextWindow({ observedContextWindow: 32768 })).toBe(32768);
    expect(ModelParametersService.effectiveContextWindow({})).toBeUndefined();
  });
});

describe('workspace command contract', () => {
  it('resolves a workspace through the backend and never invents a path', async () => {
    mocks.invoke.mockResolvedValue(WORKSPACE_INFO);
    const workspace = await ensureConversationWorkspace({ conversationId: 'conv-1', title: '线缆整改' });

    expect(mocks.invoke).toHaveBeenCalledWith('workspace_ensure', {
      payload: { conversation_id: 'conv-1', title: '线缆整改', materialize: false },
    });
    expect(workspace.root).toBe(WORKSPACE_INFO.root);
    expect(workspace.manifestPath).toBe(WORKSPACE_INFO.manifestPath);
  });

  it('decides where the folder will be without creating it', async () => {
    // A brand new chat only asks for the path: no folder in the user's documents
    // until something actually needs it.
    mocks.invoke.mockResolvedValue({ ...WORKSPACE_INFO, exists: false, created: false });
    const workspace = await ensureConversationWorkspace({ conversationId: 'conv-new', title: 'New chat' });

    expect(workspace.exists).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith('workspace_ensure', {
      payload: { conversation_id: 'conv-new', title: 'New chat', materialize: false },
    });
    expect(useConversationAttachmentStore.getState().isWorkspaceMaterialized('conv-new')).toBe(false);
  });

  it('creates the folder the first time the conversation needs it, and only once', async () => {
    mocks.invoke.mockResolvedValue({ ...WORKSPACE_INFO, exists: true, created: true });
    const root = await ensureConversationWorkspaceMaterialized('conv-1', 'New chat');

    expect(root).toBe(WORKSPACE_INFO.root);
    expect(mocks.invoke).toHaveBeenCalledWith('workspace_ensure', {
      payload: { conversation_id: 'conv-1', title: 'New chat', materialize: true },
    });
    expect(useConversationAttachmentStore.getState().isWorkspaceMaterialized('conv-1')).toBe(true);

    // Already on disk: no further IPC on every tool call.
    const callsAfterFirstUse = mocks.invoke.mock.calls.length;
    await ensureConversationWorkspaceMaterialized('conv-1', 'New chat');
    expect(mocks.invoke.mock.calls.length).toBe(callsAfterFirstUse);
  });

  it('exports through the backend and reports the real counts', async () => {
    // The old frontend copy read `entry.path`, which a Tauri v2 DirEntry does not
    // have, so it copied nothing and still said "done". Counting now happens in
    // Rust over real filesystem entries, and the UI shows what the command returned.
    mocks.invoke.mockResolvedValue({
      ok: true,
      source: WORKSPACE_INFO.root,
      destination: 'C:/out/线缆整改-3f9a21',
      files: 3,
      bytes: 4096,
      skippedSymlinks: 0,
      sourceMissing: false,
    });
    const result = await exportConversationWorkspace('conv-1', 'C:/out');

    expect(mocks.invoke).toHaveBeenCalledWith('workspace_export', {
      payload: { conversation_id: 'conv-1', destination_dir: 'C:/out' },
    });
    expect(result.files).toBe(3);
    expect(result.bytes).toBe(4096);
  });

  it('treats a never-used workspace as an empty export, not an error', async () => {
    mocks.invoke.mockResolvedValue({
      ok: true,
      source: WORKSPACE_INFO.root,
      destination: null,
      files: 0,
      bytes: 0,
      skippedSymlinks: 0,
      sourceMissing: true,
    });
    const result = await exportConversationWorkspace('conv-1', 'C:/out');
    expect(result.sourceMissing).toBe(true);
    expect(result.files).toBe(0);
  });

  it('reports a failed export instead of an empty successful one', async () => {
    mocks.invoke.mockRejectedValue(new Error('EXPORT_DESTINATION_INSIDE_SOURCE'));
    await expect(exportConversationWorkspace('conv-1', 'C:/out')).rejects.toThrow('EXPORT_DESTINATION_INSIDE_SOURCE');
  });

  it('reports cleanup failure instead of letting the UI report success', async () => {
    mocks.invoke.mockRejectedValue(new Error('WORKSPACE_TRASH_FAILED: 移入回收站失败'));
    const onRemoved = vi.fn();

    const outcome = await trashConversationWorkspaces(['conv-1'], onRemoved);

    expect(outcome.removed).toEqual([]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].error).toContain('WORKSPACE_TRASH_FAILED');
    // The record must survive a failed cleanup, otherwise there is nothing to retry.
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('drops the record only after the folder really moved to the recycle bin', async () => {
    mocks.invoke.mockResolvedValue({
      ok: true, conversationId: 'conv-1', path: WORKSPACE_INFO.root, movedToTrash: true,
    });
    const onRemoved = vi.fn();

    const outcome = await trashConversationWorkspaces(['conv-1'], onRemoved);

    expect(outcome.removed).toEqual(['conv-1']);
    expect(outcome.failed).toEqual([]);
    expect(onRemoved).toHaveBeenCalledWith('conv-1');
  });

  it('identifies a workspace by the full conversation id, not a short prefix', async () => {
    // Two conversations whose ids share the first six characters must not be
    // treated as the same folder: the backend keys its mapping on the full id.
    // (That they also get different folder names is asserted in Rust:
    // naming::tests::ids_sharing_a_six_character_prefix_get_different_folders.)
    mocks.invoke.mockResolvedValue(WORKSPACE_INFO);
    await ensureConversationWorkspace({ conversationId: 'abcdef00-1111-2222-3333-444455556666' });
    await ensureConversationWorkspace({ conversationId: 'abcdef99-7777-8888-9999-aaaabbbbcccc' });

    const conversationIds = mocks.invoke.mock.calls.map(
      (call) => (call[1] as { payload: { conversation_id: string } }).payload.conversation_id,
    );
    expect(conversationIds).toEqual([
      'abcdef00-1111-2222-3333-444455556666',
      'abcdef99-7777-8888-9999-aaaabbbbcccc',
    ]);
  });

  it('keeps the recorded directory when the title changes', async () => {
    // Auto-rename was removed: once a path is handed to the model it never moves,
    // and no code path may derive a new one from a directory scan.
    mocks.invoke.mockResolvedValue({ ...WORKSPACE_INFO, root: 'C:/Users/x/Documents/Chatless/Old-3f9a21' });
    const first = await ensureConversationWorkspace({ conversationId: 'conv-1', title: 'New chat' });
    const second = await ensureConversationWorkspace({ conversationId: 'conv-1', title: 'Renamed later' });

    expect(first.root).toBe(second.root);
    expect(mocks.invoke.mock.calls.every((call) => call[0] === 'workspace_ensure')).toBe(true);
  });
});

describe('workspace persistence', () => {
  it('keeps the selected working directory in the restart snapshot', () => {
    const state = useConversationAttachmentStore.getState();
    const persisted = useConversationAttachmentStore.persist.getOptions().partialize!({
      ...state, mountedDirByConversation: { chat: 'C:/audit/project' },
    }) as Record<string, unknown>;
    expect(persisted.mountedDirByConversation).toEqual({ chat: 'C:/audit/project' });
  });
});
