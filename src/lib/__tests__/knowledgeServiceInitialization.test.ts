import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ready: false,
  initialize: vi.fn(),
  repo: {
    getAllKnowledgeBases: vi.fn(),
    getKnowledgeBaseById: vi.fn(),
    createKnowledgeBase: vi.fn(),
  },
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      initialize: state.initialize,
      getKnowledgeBaseRepository: () => {
        if (!state.ready) throw new Error('Database not initialized');
        return state.repo;
      },
      getDbManager: () => {
        if (!state.ready) throw new Error('Database not initialized');
        return {
          select: async () => [{ test: 1 }],
          execute: async () => ({ rowsAffected: 0 }),
        };
      },
    }),
  },
}));
import { KnowledgeService } from '../knowledgeService';

beforeEach(() => {
  state.ready = false;
  vi.clearAllMocks();
  state.initialize.mockImplementation(async () => {
    state.ready = true;
  });
  state.repo.getAllKnowledgeBases.mockResolvedValue([
    { id: 'kb', name: 'Existing library' },
  ]);
  state.repo.getKnowledgeBaseById.mockResolvedValue({
    id: 'kb',
    name: 'Existing library',
  });
  state.repo.createKnowledgeBase.mockResolvedValue({
    id: 'new',
    name: 'New library',
  });
});

it('loads libraries on a cold knowledge route without first visiting chat', async () => {
  await expect(KnowledgeService.getAllKnowledgeBases()).resolves.toEqual([
    { id: 'kb', name: 'Existing library' },
  ]);
});

it('opens a knowledge deep link on a cold start', async () => {
  await expect(KnowledgeService.getKnowledgeBase('kb')).resolves.toMatchObject({
    id: 'kb',
  });
});

it('can create a library without relying on composer initialization', async () => {
  await expect(
    KnowledgeService.createKnowledgeBase('New library', ''),
  ).resolves.toMatchObject({ id: 'new' });
});

it('propagates initialization failures instead of returning an empty library', async () => {
  state.initialize.mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(KnowledgeService.getAllKnowledgeBases()).rejects.toThrow(
    'Database unavailable',
  );
  expect(state.repo.getAllKnowledgeBases).not.toHaveBeenCalled();
});
