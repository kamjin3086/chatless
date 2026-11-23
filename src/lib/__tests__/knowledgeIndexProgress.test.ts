import { expect, it, vi } from 'vitest';
import { KnowledgeService } from '../knowledgeService';

const repo = vi.hoisted(() => ({
  getKnowledgeBaseDocuments: vi.fn(async () => [{ documentId: 'doc' }]),
  addDocumentToKnowledgeBase: vi.fn(async () => ({ documentId: 'doc' })),
  isDocumentInKnowledgeBase: vi.fn(async () => true),
  updateDocumentMappingStatus: vi.fn(async () => {}),
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      initialize: async () => {},
      getKnowledgeBaseRepository: () => repo,
    }),
  },
}));
vi.mock('../unifiedFileService', () => ({
  UnifiedFileService: {
    getFile: async () => ({ filePath: '/fixture.txt' }),
    updateFile: async () => {},
  },
}));
vi.mock('../indexing/DocumentIndexer', () => ({
  DocumentIndexer: class {
    async indexDocument(
      _id: string,
      _path: string,
      {
        progressCallback,
      }: {
        progressCallback: (task: { progress: number; status: string }) => void;
      },
    ) {
      progressCallback({ progress: 50, status: 'embedding' });
      return { success: true, chunksProcessed: 3 };
    }
  },
}));

it('forwards structured import progress through the rebuild and keeps its progress cap', async () => {
  const onProgress = vi.fn();
  await expect(
    KnowledgeService.rebuildKnowledgeBase('kb', { onProgress }),
  ).resolves.toBe(true);

  expect(onProgress.mock.calls).toEqual([
    [0, { stage: 'preparingRebuild', current: 1, total: 1 }],
    [10, { stage: 'preparing' }],
    [20, { stage: 'loadingDocument' }],
    [30, { stage: 'initializing' }],
    [40, { stage: 'starting' }],
    [65, { stage: 'embedding' }],
    [95, { stage: 'updating' }],
    [99, { stage: 'complete', chunks: 3 }],
    [100, { stage: 'rebuildComplete' }],
  ]);
  expect(repo.updateDocumentMappingStatus.mock.calls).toEqual([
    ['doc', 'kb', 'indexing'],
    ['doc', 'kb', 'indexed'],
  ]);
});
