import { beforeEach, expect, it, vi } from 'vitest';
import { listKnowledgeDocumentChoices } from '../knowledgeDocumentChoices';

const { files, mappings } = vi.hoisted(() => ({
  files: vi.fn(),
  mappings: vi.fn(),
}));
vi.mock('../unifiedFileService', () => ({
  UnifiedFileService: { getAllFiles: files },
}));
vi.mock('../knowledgeService', () => ({
  KnowledgeService: { getKnowledgeBaseDocuments: mappings },
}));

beforeEach(() => {
  vi.resetAllMocks();
  files.mockResolvedValue([
    { id: 'uploaded', name: 'Guide.md', source: 'upload' },
    { id: 'attachment', name: 'Chat.txt', source: 'chat' },
    {
      id: 'shared',
      name: 'Shared.md',
      source: 'upload',
      knowledgeBaseId: 'another-kb',
    },
  ]);
  mappings.mockResolvedValue([]);
});

it('offers durable chat document IDs rather than synthetic message-reference IDs', async () => {
  expect(await listKnowledgeDocumentChoices('kb')).toContainEqual({
    id: 'attachment',
    name: 'Chat.txt',
    type: 'chat',
    isAlreadyInKB: false,
  });
});

it('excludes documents already mapped to this library even if their primary library differs', async () => {
  mappings.mockResolvedValue([{ documentId: 'shared' }]);
  expect(
    (await listKnowledgeDocumentChoices('kb')).map((choice) => choice.id),
  ).toEqual(['uploaded', 'attachment']);
  expect(mappings).toHaveBeenCalledWith('kb');
});

it('allows attaching a document to more than one library', async () => {
  expect(await listKnowledgeDocumentChoices('kb')).toContainEqual({
    id: 'shared',
    name: 'Shared.md',
    type: 'document',
    isAlreadyInKB: true,
  });
});

it('does not pretend the library is empty when loading its mappings fails', async () => {
  mappings.mockRejectedValue(new Error('Database unavailable'));
  await expect(listKnowledgeDocumentChoices('kb')).rejects.toThrow(
    'Database unavailable',
  );
});
