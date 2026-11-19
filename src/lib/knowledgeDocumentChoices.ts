import { UnifiedFileService } from './unifiedFileService';
import { KnowledgeService } from './knowledgeService';

export interface KnowledgeDocumentChoice {
  id: string;
  name: string;
  type: 'document' | 'chat';
  isAlreadyInKB: boolean;
}

/** Offer real stored documents, including durable chat attachments. Message
 * references alone have no file bytes and must not masquerade as importable IDs.
 */
export async function listKnowledgeDocumentChoices(
  knowledgeBaseId: string,
): Promise<KnowledgeDocumentChoice[]> {
  const [files, mappings] = await Promise.all([
    UnifiedFileService.getAllFiles(),
    KnowledgeService.getKnowledgeBaseDocuments(knowledgeBaseId),
  ]);
  const mounted = new Set(mappings.map((mapping) => mapping.documentId));
  return files
    .filter((file) => !mounted.has(file.id))
    .map((file) => ({
      id: file.id,
      name: file.name,
      type: file.source === 'chat' ? 'chat' : 'document',
      isAlreadyInKB: !!file.knowledgeBaseId,
    }));
}
