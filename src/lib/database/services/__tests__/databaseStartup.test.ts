import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { migrationRegistry } from '@/lib/migrations/registry';
import { DatabaseService } from '../DatabaseService';

const sql = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ select: sql.select, execute: sql.execute }) },
}));
vi.mock('@/lib/indexing/SemanticIndexQueue', () => ({
  semanticIndexQueue: { resume: sql.resume },
}));

function installedThrough(version: number) {
  sql.select.mockImplementation(async (query: string) => {
    if (!query.includes('FROM schema_migrations')) return [];
    return migrationRegistry
      .getAllMigrations()
      .filter((migration) => migration.version <= version)
      .map((migration) => ({
        version: migration.version,
        name: migration.name,
        executed_at: 0,
        execution_time: 0,
        checksum: 'fixture',
      }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  sql.execute.mockResolvedValue({ rowsAffected: 0 });
  installedThrough(migrationRegistry.getLatestVersion());
});
afterEach(() => {
  DatabaseService.reset();
  vi.useRealTimers();
});

it('reads the migration ledger once before chat history can load on an up-to-date database', async () => {
  const service = DatabaseService.getInstance();
  await service.initialize();

  const ledgerReads = sql.select.mock.calls.filter(([query]) =>
    query.includes('FROM schema_migrations'),
  );
  expect(ledgerReads).toHaveLength(1);
  expect(sql.resume).toHaveBeenCalledOnce();
  expect(service.getConversationRepository()).toBeDefined();
});

it('still applies a pending migration before resuming the semantic queue', async () => {
  installedThrough(19);
  let migrationRecorded = false;
  sql.execute.mockImplementation(async (query: string) => {
    if (query.includes('INSERT INTO schema_migrations'))
      migrationRecorded = true;
    return { rowsAffected: 0 };
  });
  sql.resume.mockImplementation(async () =>
    expect(migrationRecorded).toBe(true),
  );
  await DatabaseService.getInstance().initialize();
  expect(
    sql.execute.mock.calls.some(([query]) =>
      query.includes('CREATE TABLE agent_delivered_evidence'),
    ),
  ).toBe(true);
  expect(sql.resume).toHaveBeenCalledOnce();
});

it('does not expose chat repositories when a pending migration fails', async () => {
  installedThrough(19);
  sql.execute.mockImplementation(async (query: string) => {
    if (query.includes('CREATE TABLE agent_delivered_evidence'))
      throw new Error('write failed');
    return { rowsAffected: 0 };
  });
  const service = DatabaseService.getInstance();
  await expect(service.initialize()).rejects.toThrow('write failed');
  expect(service.isInitialized()).toBe(false);
  expect(sql.resume).not.toHaveBeenCalled();
});
