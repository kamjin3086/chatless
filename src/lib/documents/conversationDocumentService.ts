import { UnifiedFileService } from '@/lib/unifiedFileService';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { DocumentIndexer } from '@/lib/indexing/DocumentIndexer';

/** Persist and index a conversation attachment before it enters a model run. */
export async function attachDocumentToConversation(params: {
  conversationId: string;
  name: string;
  bytes: Uint8Array;
}): Promise<{ documentId: string; filePath: string }> {
  const stored = await UnifiedFileService.saveFile(params.bytes, params.name, 'chat');
  const database = DatabaseService.getInstance();
  await database.getDocumentRepository().createDocument({
    id: stored.id,
    title: stored.name,
    file_path: stored.filePath,
    file_type: stored.fileType,
    file_size: stored.fileSize,
    tags: stored.tags,
  });
  await database.getDbManager().execute(
    `INSERT INTO conversation_document_mappings (conversation_id, document_id, created_at)
     VALUES (?, ?, ?) ON CONFLICT(conversation_id, document_id) DO NOTHING`,
    [params.conversationId, stored.id, Date.now()],
  );
  const result = await new DocumentIndexer().indexDocument(stored.id, stored.filePath);
  if (!result.success) throw new Error(result.error || '附件索引失败');
  return { documentId: stored.id, filePath: stored.filePath };
}

export async function detachConversationDocuments(conversationId: string): Promise<void> {
  await DatabaseService.getInstance().getDbManager().execute(
    'DELETE FROM conversation_document_mappings WHERE conversation_id = ?', [conversationId],
  );
}
