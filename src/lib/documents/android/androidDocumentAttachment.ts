import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';

export type AndroidDocumentAttachment = {
  handle: string;
  name: string;
  format: 'pdf' | 'text';
};

export type AndroidDocumentPickStatus =
  | 'cancelled'
  | 'empty'
  | 'inaccessible'
  | 'oversized'
  | 'scanned'
  | 'unsupported';

type PickedDocument =
  | (Omit<AndroidDocumentAttachment, 'handle'> & {
      status: 'ready';
      sections: string[];
    })
  | { status: AndroidDocumentPickStatus };

export type AndroidDocumentPickResult =
  | { status: 'ready'; attachment: AndroidDocumentAttachment }
  | { status: AndroidDocumentPickStatus };

async function getDatabase() {
  const { DatabaseService } = await import(
    '@/lib/database/services/DatabaseService'
  );
  return DatabaseService.getInstance().getDbManager();
}

export async function getAndroidDocumentAttachment(
  conversationId: string,
): Promise<AndroidDocumentAttachment | undefined> {
  const db = await getDatabase();
  const [row] = await db.select<AndroidDocumentAttachment>(
    `SELECT a.handle, a.name, a.format FROM android_document_attachments AS a
     JOIN conversations AS c ON c.id = a.conversation_id WHERE a.conversation_id = ?`,
    [conversationId],
  );
  return row;
}

export async function hasAndroidDocumentAttachment(
  conversationId?: string,
): Promise<boolean> {
  if (!conversationId || !isAndroidTauri()) return false;
  try {
    return Boolean(await getAndroidDocumentAttachment(conversationId));
  } catch {
    return false;
  }
}

export async function pickAndroidDocumentAttachment(
  conversationId: string,
  stillInScope: () => boolean = () => true,
): Promise<AndroidDocumentPickResult> {
  const selected = await invoke<PickedDocument>('pick_android_document');
  if (!stillInScope()) return { status: 'cancelled' };
  if (selected.status !== 'ready') return selected;

  const db = await getDatabase();
  if (!stillInScope()) return { status: 'cancelled' };
  const { name, format, sections } = selected;
  // The manager includes bound values in query-error diagnostics; do not log document text.
  const [attachment] = await db.getDatabase().select<AndroidDocumentAttachment>(
    `INSERT INTO android_document_attachments (conversation_id, handle, name, format, sections)
     SELECT id, ?, ?, ?, ? FROM conversations WHERE id = ?
     ON CONFLICT(conversation_id) DO UPDATE SET
       handle = excluded.handle, name = excluded.name, format = excluded.format, sections = excluded.sections
     RETURNING handle, name, format`,
    [uuidv4(), name, format, JSON.stringify(sections), conversationId],
  );
  return attachment ? { status: 'ready', attachment } : { status: 'cancelled' };
}

export async function removeAndroidDocumentAttachment(
  conversationId: string,
  handle: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    'DELETE FROM android_document_attachments WHERE conversation_id = ? AND handle = ?',
    [conversationId, handle],
  );
}

export async function readAndroidDocumentAttachment(
  conversationId: string,
  handle?: string,
) {
  const db = await getDatabase();
  const [row] = await db.select<
    AndroidDocumentAttachment & { sections: string }
  >(
    `SELECT a.handle, a.name, a.format, a.sections FROM android_document_attachments AS a
     JOIN conversations AS c ON c.id = a.conversation_id
     WHERE a.conversation_id = ? AND (? IS NULL OR a.handle = ?)`,
    [conversationId, handle ?? null, handle ?? null],
  );
  return row && { ...row, sections: JSON.parse(row.sections) as string[] };
}
