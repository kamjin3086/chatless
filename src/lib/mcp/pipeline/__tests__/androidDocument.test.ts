import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SqliteBridge } from '../../../../../docs/acceptance/sqliteBridge';
import {
  getAndroidDocumentAttachment,
  pickAndroidDocumentAttachment,
  removeAndroidDocumentAttachment,
} from '@/lib/documents/android/androidDocumentAttachment';
import { migration_021 } from '@/lib/migrations/scripts/021_android_document_attachments';
import { buildInitialPrompt } from '@/lib/mcp/injection/promptBuilder';
import { ToolExecutionPipeline } from '../ToolExecutionPipeline';
import { ToolInvocation } from '../ToolInvocation';
import { createDefaultAdapters } from '../adapters';

const edge = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
  pick: vi.fn(),
  ask: vi.fn(),
  platform: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  isTauri: () => true,
  invoke: edge.pick,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: edge.platform }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({ ...edge, getDatabase: () => edge }),
    }),
  },
}));
vi.mock('@/lib/mcp/chatIntegration', () => ({
  getEnabledConfiguredServers: async () => [],
}));
vi.mock('@/lib/mcp/authorizationConfig', () => ({
  shouldAutoAuthorize: async () => false,
}));
vi.mock('../approvalWait', () => ({ waitForCallApproval: edge.ask }));
vi.mock('@/lib/agentWorkspace/manifestService', () => ({
  appendWorkspaceToolStep: async () => {},
}));
vi.mock('../ToolCardUpdater', () => ({
  markError: vi.fn(),
  markPendingAuth: vi.fn(),
  markSuccess: vi.fn(),
}));

let directory: string;
let db: SqliteBridge;
let turn = 0;
async function openDatabase() {
  db = new SqliteBridge(join(directory, 'chat.db'));
  edge.select.mockImplementation((sql: string, params: unknown[]) =>
    db.select(sql, params),
  );
  edge.execute.mockImplementation((sql: string, params: unknown[]) =>
    db.query(sql, params),
  );
  await db.query('PRAGMA foreign_keys = ON');
}

beforeEach(async () => {
  vi.resetAllMocks();
  edge.platform.mockReturnValue('android');
  directory = await mkdtemp(join(tmpdir(), 'chatless-android-document-'));
  await openDatabase();
  await db.query('CREATE TABLE conversations (id TEXT PRIMARY KEY)');
  await db.query("INSERT INTO conversations VALUES ('one'), ('two')");
  for (const operation of migration_021.up) {
    if (operation.type === 'rawSQL') {
      for (const sql of [operation.sql].flat()) await db.query(sql);
    }
  }
});
afterEach(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

async function run(
  tool: string,
  args: Record<string, unknown>,
  conversationId = 'one',
  server = 'android_document',
) {
  const id = `document-test-${++turn}`;
  return new ToolExecutionPipeline({ adapters: createDefaultAdapters() }).run(
    new ToolInvocation({
      server,
      tool,
      args,
      conversationId,
      assistantMessageId: id,
      callId: id,
      provider: 'openai-compatible',
      model: 'fixture',
      historyForLlm: [],
      originalUserContent:
        'What does the attached document say about the river?',
      planOnly: true,
    }),
  );
}

function catalog(conversationId: string) {
  return buildInitialPrompt(
    {
      userContent: 'Where is the river?',
      phase: 'initial',
      providerName: 'OpenAI',
      modelName: 'gpt-4o',
      conversationId,
    },
    {
      hasExplicitMention: false,
      mentionedServers: [],
      webSearchEnabled: false,
      hasToolKeywords: false,
      hasPreviousToolUse: false,
      isTimeRelated: false,
    },
  );
}

function ready(format: 'pdf' | 'text', sections: string[]) {
  const name = format === 'pdf' ? 'survey.pdf' : 'survey.txt';
  edge.pick.mockResolvedValueOnce({ status: 'ready', name, format, sections });
}

it('advertises Android document reads only in the selected conversation, without putting text into the prompt', async () => {
  ready('pdf', ['private marker', 'The river is north.']);
  await pickAndroidDocumentAttachment('one');
  const native = await catalog('one');
  expect(native.nativeTools?.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      'android_document__search',
      'android_document__excerpt',
    ]),
  );
  expect(JSON.stringify(native)).not.toMatch(
    /private marker|The river is north/,
  );
  expect(
    (await catalog('two')).nativeTools?.map(({ name }) => name),
  ).not.toContain('android_document__search');
  expect(
    await run('search', { query: 'android_document' }, 'one', 'tools'),
  ).toMatchObject({
    results: [
      expect.objectContaining({ name: 'search', source: 'builtin' }),
      expect.objectContaining({ name: 'excerpt', source: 'builtin' }),
    ],
  });
  expect(
    await run('search', { query: 'android_document' }, 'two', 'tools'),
  ).toMatchObject({ results: [] });
  edge.platform.mockReturnValue('linux');
  expect(await run('search', { query: 'river' })).toMatchObject({
    error: 'NO_ADAPTER',
  });
  expect(
    await run('search', { query: 'android_document' }, 'one', 'tools'),
  ).toMatchObject({ results: [] });
  expect(
    (await catalog('one')).nativeTools?.map(({ name }) => name),
  ).not.toContain('android_document__search');
});

it('reads matched PDF pages and plain text lines across reopen without reselecting or asking for read approvals', async () => {
  ready('pdf', ['', 'The river is north.', 'Another topic.']);
  await pickAndroidDocumentAttachment('one');
  await db.query('COMMIT');
  await db.close();
  await openDatabase();
  const pdf = await getAndroidDocumentAttachment('one');
  expect(pdf).toMatchObject({ name: 'survey.pdf', format: 'pdf' });
  expect(await run('search', { query: 'River' })).toMatchObject({
    name: 'survey.pdf',
    handle: pdf?.handle,
    matches: [{ source: { page: 2 }, text: 'The river is north.' }],
  });
  expect(await run('excerpt', { handle: pdf?.handle, start: 2 })).toMatchObject(
    { source: { page: 2 }, text: 'The river is north.' },
  );
  ready('text', ['Header\r\n\r\nThe river flows east.\nEnd']);
  await pickAndroidDocumentAttachment('one');
  const text = await getAndroidDocumentAttachment('one');
  expect(await run('search', { query: 'river' })).toMatchObject({
    matches: [
      { source: { lineStart: 3, lineEnd: 3 }, text: 'The river flows east.' },
    ],
  });
  expect(
    await run('excerpt', { handle: text?.handle, start: 3, end: 4 }),
  ).toMatchObject({
    source: { lineStart: 3, lineEnd: 4 },
    text: 'The river flows east.\nEnd',
  });
  expect(edge.ask).not.toHaveBeenCalled();
  expect(edge.pick).toHaveBeenCalledTimes(2);
});

it('bounds disclosure, rejects invalid ranges and cannot dereference a foreign, forged or replaced handle', async () => {
  ready('text', [
    Array.from(
      { length: 30 },
      () => `${'x'.repeat(400)}river${'y'.repeat(2000)}`,
    ).join('\n'),
  ]);
  await pickAndroidDocumentAttachment('one');
  const old = await getAndroidDocumentAttachment('one');
  expect(await run('search', { query: '' })).toMatchObject({ ok: false });
  const result = (await run('search', { query: 'river' })) as {
    matches: { text: string }[];
    truncated: boolean;
  };
  expect(result.matches).toHaveLength(3);
  expect(result.truncated).toBe(true);
  expect(
    result.matches.every(
      ({ text }) => text.includes('river') && text.length <= 240,
    ),
  ).toBe(true);
  expect(
    await run('excerpt', { handle: old?.handle, start: 1, end: 30 }),
  ).toMatchObject({ ok: false });
  expect(
    await run('excerpt', { handle: old?.handle, start: 1.5 }),
  ).toMatchObject({ ok: false });
  expect(await run('excerpt', { handle: old?.handle, start: 1 })).toMatchObject(
    { truncated: true, text: 'x'.repeat(400) + 'river' + 'y'.repeat(795) },
  );
  ready('text', ['Other conversation']);
  await pickAndroidDocumentAttachment('two');
  for (const handle of [old?.handle, 'forged']) {
    expect(await run('excerpt', { handle, start: 1 }, 'two')).toMatchObject({
      ok: false,
    });
  }
  ready('text', ['Replacement']);
  await pickAndroidDocumentAttachment('one');
  expect(await run('excerpt', { handle: old?.handle, start: 1 })).toMatchObject(
    { ok: false },
  );
});

it('preserves the existing attachment on cancellation and file errors, and cleans up removed and deleted attachments', async () => {
  ready('text', ['Keep me']);
  await pickAndroidDocumentAttachment('one');
  const initial = await getAndroidDocumentAttachment('one');
  for (const status of [
    'cancelled',
    'inaccessible',
    'unsupported',
    'scanned',
    'oversized',
    'empty',
  ] as const) {
    edge.pick.mockResolvedValueOnce({ status });
    expect(await pickAndroidDocumentAttachment('one')).toEqual({ status });
    expect(await getAndroidDocumentAttachment('one')).toEqual(initial);
  }
  const stillInScope = vi.fn(() => false);
  ready('text', ['Do not save a late result']);
  expect(await pickAndroidDocumentAttachment('one', stillInScope)).toEqual({
    status: 'cancelled',
  });
  expect(await getAndroidDocumentAttachment('one')).toEqual(initial);
  await removeAndroidDocumentAttachment('one', initial!.handle);
  expect(await run('search', { query: 'keep' })).toMatchObject({ ok: false });
  ready('text', ['Delete me']);
  await pickAndroidDocumentAttachment('one');
  await db.query("DELETE FROM conversations WHERE id = 'one'");
  expect(
    await db.select('SELECT handle FROM android_document_attachments'),
  ).toEqual([]);
  ready('text', ['Late result for deleted conversation']);
  expect(await pickAndroidDocumentAttachment('one')).toEqual({
    status: 'cancelled',
  });
  expect(
    await db.select('SELECT handle FROM android_document_attachments'),
  ).toEqual([]);
});
