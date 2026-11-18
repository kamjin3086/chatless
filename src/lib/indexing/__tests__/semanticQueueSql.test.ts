import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SqliteBridge } from '../../../../docs/acceptance/sqliteBridge';
import { migration_019 } from '@/lib/migrations/scripts/019_semantic_model_identity';
import { SemanticIndexQueue } from '../SemanticIndexQueue';

const mocked = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
  getRuntime: vi.fn(),
  lease: vi.fn(),
  reindex: vi.fn(),
  getConnectionUrl: () => ':memory:',
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ getDbManager: () => mocked }) },
}));
vi.mock('@/lib/rag/ragServiceInstance', () => ({
  refreshRAGService: async () => {},
  withRAGService: mocked.lease,
  getRAGService: mocked.getRuntime,
}));
vi.mock('../DocumentIndexer', () => ({
  DocumentIndexer: class {
    reindexDocument = mocked.reindex;
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => true }));
let db: SqliteBridge;

beforeEach(async () => {
  db = new SqliteBridge(':memory:');
  mocked.getRuntime.mockReset();
  mocked.lease.mockReset();
  mocked.reindex.mockReset();
  mocked.getRuntime.mockResolvedValue({
    getEmbeddingService: () => ({
      getEmbeddingFingerprint: () => 'selected-model',
    }),
  });
  mocked.select.mockImplementation((sql: string, params: unknown[]) =>
    db.select(sql, params),
  );
  mocked.execute.mockImplementation(async (sql: string, params: unknown[]) => {
    await db.query(sql, params);
    const rows = await db.select<{ n: number }>('SELECT changes() AS n');
    return { rowsAffected: rows[0].n };
  });
  await db.query(
    'CREATE TABLE documents (id TEXT PRIMARY KEY, index_version INTEGER, active_index_batch_id TEXT, semantic_status TEXT)',
  );
  await db.query(
    'CREATE TABLE document_index_tasks (id TEXT PRIMARY KEY, document_id TEXT, document_version INTEGER, task_type TEXT, status TEXT, error TEXT, created_at INTEGER, updated_at INTEGER)',
  );
});
afterEach(async () => {
  await db.close();
  vi.unstubAllGlobals();
});
async function migrate() {
  for (const operation of migration_019.up) {
    if (operation.type === 'rawSQL')
      for (const sql of typeof operation.sql === 'string'
        ? [operation.sql]
        : operation.sql)
        await db.query(sql);
  }
}
async function task(
  id: string,
  doc: string,
  version: number,
  status: string,
  time: number,
  type = 'semantic',
) {
  await db.query(
    'INSERT INTO document_index_tasks (id,document_id,document_version,task_type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, doc, version, type, status, time, time],
  );
}

it('reconciles a selected model at cold start even when all old-model jobs are completed', async () => {
  await db.query("INSERT INTO documents VALUES ('doc',1,'batch','ready')");
  await task('old-completed', 'doc', 1, 'completed', 1);
  await migrate();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const queue = new SemanticIndexQueue();
  const wake = vi.spyOn(queue, 'wakeWaiting').mockResolvedValue();
  await queue.resume();
  await db.select('SELECT 1');
  expect(mocked.getRuntime).toHaveBeenCalledTimes(1);
  expect(wake).toHaveBeenCalledWith('selected-model');
});

it('migrates duplicate active jobs and enqueue reuses the actual persisted task ID', async () => {
  await db.query("INSERT INTO documents VALUES ('doc',1,'batch','pending')");
  await task('old', 'doc', 1, 'pending', 1);
  await task('latest', 'doc', 1, 'pending', 2);
  await migrate();
  expect(
    await db.select(
      'SELECT id,status FROM document_index_tasks ORDER BY created_at',
    ),
  ).toEqual([
    { id: 'old', status: 'cancelled' },
    { id: 'latest', status: 'pending' },
  ]);
  expect(await new SemanticIndexQueue().enqueue('doc')).toBe('latest');
  expect((await db.select('SELECT id FROM document_index_tasks')).length).toBe(
    2,
  );
});

it('retries only one current-version task and does not requeue obsolete work', async () => {
  await db.query("INSERT INTO documents VALUES ('doc',2,'batch','pending')");
  await task('obsolete', 'doc', 1, 'failed', 1);
  await task('cancelled-a', 'doc', 2, 'cancelled', 2);
  await task('cancelled-b', 'doc', 2, 'cancelled', 3);
  await migrate();
  const queue = new SemanticIndexQueue();
  expect(await queue.retryForDocument('doc')).toBe(true);
  expect(
    await db.select(
      "SELECT id FROM document_index_tasks WHERE status='pending'",
    ),
  ).toEqual([{ id: 'cancelled-b' }]);
  expect(await queue.retry('obsolete')).toBe(false);
});

it.each([false, true])(
  'keeps the adaptation parent live until publication and preserves concurrent cancellation (%s)',
  async (cancelDuringAdaptation) => {
    await db.query("INSERT INTO documents VALUES ('doc',1,'batch','pending')");
    await migrate();
    await db.query(
      "ALTER TABLE documents ADD COLUMN file_path TEXT DEFAULT 'managed.txt'",
    );
    await db.query(
      'CREATE TABLE document_chunks (id TEXT,document_id TEXT,batch_id TEXT,chunk_index INTEGER,search_text TEXT)',
    );
    await db.query(
      "INSERT INTO document_chunks VALUES ('chunk','doc','batch',0,'oversized')",
    );
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const queue = new SemanticIndexQueue();
    let observedStatus: string | undefined;
    let finished = false;
    mocked.reindex.mockImplementation(async (_doc, _path, options) => {
      observedStatus = (
        await db.select<{ status: string }>(
          'SELECT status FROM document_index_tasks WHERE id=?',
          [options.semanticParentTaskId],
        )
      )[0].status;
      if (cancelDuringAdaptation)
        await queue.cancel(options.semanticParentTaskId);
      return {
        success: !cancelDuringAdaptation,
        error: 'Adaptation cancelled',
      };
    });
    mocked.lease.mockImplementationOnce(async (work) => {
      try {
        return await work(
          {
            getEmbeddingService: () => ({
              isUsableForRag: () => true,
              getEmbeddingFingerprint: () => 'selected-model',
              getTokenCounter: () => async () => [513],
              getMaxInputTokens: () => 512,
            }),
          },
          () => true,
        );
      } finally {
        finished = true;
      }
    });
    const id = await queue.enqueue('doc');
    await vi.waitFor(() => expect(finished).toBe(true));
    await vi.waitFor(async () => {
      const row = (
        await db.select<{ status: string }>(
          'SELECT status FROM document_index_tasks WHERE id=?',
          [id],
        )
      )[0];
      expect(row.status).toBe(cancelDuringAdaptation ? 'cancelled' : 'running');
    });
    expect(observedStatus).toBe('running');
    if (cancelDuringAdaptation)
      expect(await db.select('SELECT semantic_status FROM documents')).toEqual([
        { semantic_status: 'pending' },
      ]);
  },
);

it('repairs missing jobs and interrupted lexical work without undoing explicit cancellation', async () => {
  await db.query(
    "INSERT INTO documents VALUES ('missing',1,'b1','pending'),('stopped',1,'b2','pending'),('lexical',0,NULL,'pending')",
  );
  await task('stop', 'stopped', 1, 'cancelled', 1);
  await task('lex', 'lexical', 0, 'running', 1, 'lexical');
  await migrate();
  await new SemanticIndexQueue().resume();
  expect(
    await db.select(
      "SELECT document_id FROM document_index_tasks WHERE task_type='semantic' AND status='pending'",
    ),
  ).toEqual([{ document_id: 'missing' }]);
  expect(
    await db.select("SELECT status FROM document_index_tasks WHERE id='lex'"),
  ).toEqual([{ status: 'pending' }]);
  expect(
    await db.select("SELECT status FROM document_index_tasks WHERE id='stop'"),
  ).toEqual([{ status: 'cancelled' }]);
});
