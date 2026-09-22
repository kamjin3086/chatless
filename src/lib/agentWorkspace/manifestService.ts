import { ensureConversationWorkspace } from '@/lib/agentWorkspace/workspaceService';

type FileChangeOp = 'read' | 'list' | 'write' | 'create' | 'delete' | 'rename' | 'other';

export type WorkspaceToolStep = {
  id: string;
  createdAt: number;
  assistantMessageId: string;
  cardId: string;
  callId?: string;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: 'success' | 'error' | 'skipped';
  error?: unknown;
  resultPreview?: unknown;
  fileChanges?: Array<{ op: FileChangeOp; path: string }>;
};

type WorkspaceManifest = {
  version?: number;
  conversationId?: string;
  createdAt?: number;
  updatedAt?: number;
  notes?: string;
  scripts?: Array<{ path: string; purpose?: string; createdAt: number }>;
  commands?: Array<{ command: string; workingDir?: string; createdAt: number }>;
  inputs?: Array<{ path: string; description?: string }>;
  outputs?: Array<{ path: string; description?: string }>;
  // New (non-breaking): step-level records
  steps?: WorkspaceToolStep[];
};

function normalize(p: unknown): string {
  return String(p || '').trim().replace(/\\/g, '/');
}

function normKey(p: unknown): string {
  return normalize(p).replace(/\/*$/g, '').toLowerCase();
}

function safeJsonParse(input: string): any | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function summarizeResult(output: unknown): unknown {
  try {
    if (typeof output === 'string') {
      const s = output;
      if (s.length > 1500) return `${s.slice(0, 1500)}\n... (truncated, ${s.length} chars)`;
      return s;
    }
    if (Array.isArray(output)) {
      const arr = output as any[];
      if (arr.length <= 20) return output;
      return { summary: `Array(${arr.length})`, head: arr.slice(0, 10), tail: arr.slice(-5) };
    }
    if (output && typeof output === 'object') {
      const s = JSON.stringify(output);
      if (s.length > 2500) return { summary: `Object(${s.length} chars)`, preview: s.slice(0, 2500) };
      return output;
    }
  } catch {
    // ignore
  }
  return output;
}

function inferFileChanges(server: string, tool: string, args: Record<string, unknown>): Array<{ op: FileChangeOp; path: string }> {
  const srv = String(server || '').toLowerCase();
  const tl = String(tool || '').toLowerCase();
  const out: Array<{ op: FileChangeOp; path: string }> = [];

  if (srv !== 'filesystem') return out;

  const pick = (v: unknown) => {
    const p = normalize(v);
    if (p) out.push({ op: 'other', path: p });
  };

  const path = typeof (args as any).path === 'string' ? normalize((args as any).path) : '';
  if (path) pick(path);

  const oldPath = typeof (args as any).oldPath === 'string' ? normalize((args as any).oldPath) : '';
  const newPath = typeof (args as any).newPath === 'string' ? normalize((args as any).newPath) : '';
  if (oldPath) out.push({ op: 'rename', path: oldPath });
  if (newPath) out.push({ op: 'rename', path: newPath });

  // refine op based on tool
  const op: FileChangeOp =
    tl === 'read_file' || tl === 'read' ? 'read' :
    tl === 'list_directory' || tl === 'list' || tl === 'dir' ? 'list' :
    tl === 'write_file' || tl === 'write' ? 'write' :
    tl === 'create_directory' || tl === 'mkdir' || tl === 'create' ? 'create' :
    tl === 'delete_file' || tl === 'delete' ? 'delete' :
    (tl === 'rename_file' || tl === 'move_file' || tl === 'move' || tl === 'rename') ? 'rename' :
    'other';

  // apply op for main path entries
  for (const item of out) {
    if (item.op === 'other') item.op = op;
  }

  // uniq by path
  const seen = new Set<string>();
  const uniq: typeof out = [];
  for (const c of out) {
    const k = normKey(c.path);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  return uniq;
}

const _queueByConversation = new Map<string, Promise<void>>();

async function enqueue(conversationId: string, fn: () => Promise<void>): Promise<void> {
  const cid = String(conversationId || '').trim();
  const prev = _queueByConversation.get(cid) || Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  _queueByConversation.set(cid, next);
  await next;
}

export async function appendWorkspaceToolStep(params: {
  conversationId: string;
  assistantMessageId: string;
  cardId: string;
  callId?: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
}): Promise<void> {
  const cid = String(params.conversationId || '').trim();
  if (!cid) return;

  await enqueue(cid, async () => {
    // The manifest belongs to the session's own folder. It must never be written
    // into a directory the user mounted (that would drop app metadata into their
    // project), so this uses the session directory rather than @WorkDir.
    const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
    const { useChatStore } = await import('@/store/chatStore');
    const attachment = useConversationAttachmentStore.getState();
    const ws = await ensureConversationWorkspace({
      conversationId: cid,
      title: useChatStore.getState().conversations.find((c) => c.id === cid)?.title,
      knownRoot: attachment.getSessionDir(cid),
    });
    if (attachment.getSessionDir(cid) !== ws.root) {
      attachment.setWorkingDir(cid, ws.root);
    }
    const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');

    let manifest: WorkspaceManifest | null = null;
    try {
      const txt = await readTextFile(ws.manifestPath);
      manifest = safeJsonParse(String(txt || '')) as any;
    } catch {
      manifest = null;
    }
    if (!manifest || typeof manifest !== 'object') {
      const now = Date.now();
      manifest = {
        version: 1,
        conversationId: cid,
        createdAt: now,
        updatedAt: now,
        notes: 'Auto-generated workspace manifest',
        scripts: [],
        commands: [],
        inputs: [],
        outputs: [],
        steps: [],
      };
    }

    const now = Date.now();
    const server = String(params.server || '');
    const tool = String(params.tool || '');
    const args = (params.args && typeof params.args === 'object') ? (params.args as Record<string, unknown>) : {};

    const isError = !!(params.result && typeof params.result === 'object' && ((params.result as any).error || (params.result as any).ok === false || (params.result as any).success === false));
    const outcome: WorkspaceToolStep['outcome'] = (params.result as any)?.skipped ? 'skipped' : (isError ? 'error' : 'success');

    const step: WorkspaceToolStep = {
      id: `${params.assistantMessageId}:${params.cardId}`,
      createdAt: now,
      assistantMessageId: String(params.assistantMessageId || ''),
      cardId: String(params.cardId || ''),
      callId: params.callId ? String(params.callId) : undefined,
      server,
      tool,
      args,
      outcome,
      error: isError ? (params.result as any) : undefined,
      resultPreview: summarizeResult(params.result),
      fileChanges: inferFileChanges(server, tool, args),
    };

    // Update commands list (shell executor)
    if (String(server || '').toLowerCase() === 'shell_executor') {
      const cmd = typeof (args as any).command === 'string' ? String((args as any).command) : '';
      const wd = typeof (args as any).workingDir === 'string' ? normalize((args as any).workingDir) : undefined;
      if (cmd.trim()) {
        const key = `${cmd.trim()}|${wd || ''}`;
        const existing = (manifest.commands || []).some((c) => `${String(c.command || '').trim()}|${normalize((c as any).workingDir || '')}` === key);
        if (!existing) {
          (manifest.commands ||= []).push({ command: cmd.trim(), workingDir: wd, createdAt: now });
        }
      }
    }

    // Outputs: any filesystem write/create/rename that landed inside the
    // session's own folder. A mounted project directory is the user's, so it is
    // not listed as "generated output".
    const sessionDir = normKey(ws.root);
    for (const fc of step.fileChanges || []) {
      if (fc.op !== 'write' && fc.op !== 'create' && fc.op !== 'rename' && fc.op !== 'delete') continue;
      const pKey = normKey(fc.path);
      if (!pKey || !sessionDir) continue;
      if (!pKey.startsWith(sessionDir)) continue;
      const exists = (manifest.outputs || []).some((o) => normKey(o.path) === pKey);
      if (!exists) {
        (manifest.outputs ||= []).push({ path: normalize(fc.path), description: 'Generated in the session workspace' });
      }
    }

    // Append steps (cap to avoid unbounded growth)
    const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
    steps.push(step);
    const CAP = 200;
    manifest.steps = steps.length > CAP ? steps.slice(-CAP) : steps;
    manifest.updatedAt = now;

    try {
      await writeTextFile(ws.manifestPath, JSON.stringify(manifest, null, 2));
    } catch {
      // ignore
    }
  });
}

