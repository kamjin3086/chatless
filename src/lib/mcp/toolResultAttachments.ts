import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { generateId } from '@/lib/utils/id';
import { sha256Hex } from '@/lib/utils/sha256';

const INLINE_LIMIT = 16_000;
/// Preview budget split between the start and the end of a large result: the
/// error that matters usually prints last.
const PREVIEW_HEAD = 4_000;
const PREVIEW_TAIL = 4_000;

export function buildResultPreview(serialized: string): string {
  if (serialized.length <= PREVIEW_HEAD + PREVIEW_TAIL) return serialized;
  const head = serialized.slice(0, PREVIEW_HEAD);
  const tail = serialized.slice(-PREVIEW_TAIL);
  const omitted = serialized.length - head.length - tail.length;
  return `${head}\n[…已省略 ${omitted} 字符，完整内容见附件…]\n${tail}`;
}

export async function externalizeLargeToolResult(params: {
  conversationId: string; runId: string; callId: string; output: unknown;
}): Promise<unknown> {
  const serialized = typeof params.output === 'string' ? params.output : JSON.stringify(params.output);
  if (!serialized || serialized.length <= INLINE_LIMIT || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return params.output;
  }
  const id = `result_${generateId()}`;
  const directory = await join(await appDataDir(), 'tool-results', params.conversationId, params.runId);
  await mkdir(directory, { recursive: true });
  const filePath = await join(directory, `${id}.txt`);
  await writeTextFile(filePath, serialized);
  const db = DatabaseService.getInstance().getDbManager();
  await db.execute(`INSERT INTO tool_result_attachments
    (id, conversation_id, run_id, call_id, file_path, byte_size, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, params.conversationId, params.runId, params.callId,
    filePath, new TextEncoder().encode(serialized).length, await sha256Hex(serialized), Date.now()]);
  return { ok: true, truncated: true, attachmentId: id, totalChars: serialized.length,
    preview: buildResultPreview(serialized), message: '完整工具结果已保存。需要更多内容时使用 tool_result__read。' };
}

export async function readToolResultAttachment(params: {
  id: string; conversationId: string; runId: string; offset?: number; limit?: number;
}) {
  const db = DatabaseService.getInstance().getDbManager();
  const rows = await db.select<{ file_path: string; byte_size: number }>(`WITH RECURSIVE lineage(id) AS (
      SELECT ? UNION SELECT r.parent_run_id FROM agent_runs r JOIN lineage l ON r.id = l.id
      WHERE r.parent_run_id IS NOT NULL
    )
    SELECT a.file_path, a.byte_size FROM tool_result_attachments a JOIN lineage l ON l.id = a.run_id
    WHERE a.id = ? AND a.conversation_id = ? LIMIT 1`,
    [params.runId, params.id, params.conversationId]);
  if (!rows.length) return { ok: false, error: 'RESULT_ATTACHMENT_NOT_FOUND' };
  const content = await readTextFile(rows[0].file_path);
  const offset = Math.max(0, Math.floor(params.offset || 0));
  const limit = Math.min(16000, Math.max(1000, Math.floor(params.limit || 8000)));
  const text = content.slice(offset, offset + limit);
  return { ok: true, attachmentId: params.id, offset, text,
    nextOffset: offset + text.length < content.length ? offset + text.length : undefined,
    complete: offset + text.length >= content.length };
}
