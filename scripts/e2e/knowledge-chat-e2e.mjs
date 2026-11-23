#!/usr/bin/env node
/**
 * Non-destructive knowledge/chat acceptance against an already running Tauri
 * WebDriver session. Keeps the corpus, settings and test conversation afterward.
 *
 * Required: CHATLESS_KB_SESSION_ID, CHATLESS_KB_ID, CHATLESS_KB_CONVERSATION_ID.
 * Optional: CHATLESS_KB_DRIVER_URL (http://127.0.0.1:4444), CHATLESS_KB_QUERY,
 * CHATLESS_KB_EXPECT (a source fact expected in the answer), CHATLESS_KB_REPORT.
 * The selected chat model is real; no model response or retrieval is mocked.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const sessionId = required('CHATLESS_KB_SESSION_ID');
const kbId = required('CHATLESS_KB_ID');
const conversationId = required('CHATLESS_KB_CONVERSATION_ID');
const base = `${process.env.CHATLESS_KB_DRIVER_URL || 'http://127.0.0.1:4444'}/session/${sessionId}`;
const question =
  process.env.CHATLESS_KB_QUERY ||
  '请检索当前知识库：埃塞俄比亚咖啡有什么特点？只根据文档回答并引用来源。';
const expected = process.env.CHATLESS_KB_EXPECT || '耶加雪菲';
const reportPath =
  process.env.CHATLESS_KB_REPORT ||
  path.join(os.tmpdir(), 'chatless-knowledge-chat-report.json');
const expectSemantic = process.env.CHATLESS_KB_EXPECT_SEMANTIC === '1';
const approvalChoice = process.env.CHATLESS_KB_APPROVAL_CHOICE || 'once';
assert(
  ['once', 'conversation'].includes(approvalChoice),
  'Invalid approval choice',
);
let approvedCalls = 0;
const expectedDimension = Number(process.env.CHATLESS_KB_EXPECT_DIMENSION || 0);
if (process.env.CHATLESS_KB_EXPECT_DIMENSION)
  assert(
    Number.isSafeInteger(expectedDimension) && expectedDimension > 0,
    'Invalid expected dimension',
  );
const report = {
  startedAt: new Date().toISOString(),
  expectSemantic,
  checks: [],
};
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
let selectedFingerprint;
let sampleDocumentId;

async function wd(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result.value));
  return result.value;
}
const evaluate = (script, args = []) => wd('/execute/sync', { script, args });
async function query(sql, values = []) {
  const result = await wd('/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
        db: 'sqlite:mychat.db', query: arguments[0], values: arguments[1]
      }).then(rows => done({ rows }), error => done({ error: String(error) }));`,
    args: [sql, values],
  });
  if (result.error) throw new Error(result.error);
  return result.rows;
}
async function wait(label, probe, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout: ${label}`);
}
async function click(selector) {
  const element = await wd('/element', {
    using: 'css selector',
    value: selector,
  });
  await wd(`/element/${element[elementKey]}/click`, {});
}
async function navigate(route) {
  await wd('/url', { url: `tauri://localhost${route}` });
}
function record(name, details = {}) {
  report.checks.push({ name, ...details });
  console.log(`PASS ${name}`);
}
async function mounted(name) {
  return evaluate(
    `return [...document.querySelectorAll('button')].some(button => button.textContent.trim() === arguments[0]);`,
    [name],
  );
}

try {
  // A full navigation resets JS services, exercising the cold-route bug.
  await navigate('/knowledge?tab=knowledge');
  const libraries = await query(
    'SELECT id, name FROM knowledge_bases WHERE id = ?',
    [kbId],
  );
  assert.equal(libraries.length, 1, 'Knowledge base must already exist');
  const name = libraries[0].name;
  await wait('cold knowledge route lists the persisted library', () =>
    evaluate('return document.body.innerText.includes(arguments[0]);', [name]),
  );
  record('cold knowledge route lists persisted library');
  const frames = await wd('/execute/async', {
    script: `const done = arguments[arguments.length - 1]; let settled = false;
      requestAnimationFrame(() => { if (!settled) { settled = true; done(true); } });
      setTimeout(() => { if (!settled) { settled = true; done(false); } }, 2000);`,
    args: [],
  });
  assert(
    frames,
    'WebView animation frames are suspended: keep the app visible or run the driver under Xvfb',
  );

  const importName = process.env.CHATLESS_KB_IMPORT_NAME;
  if (importName) {
    const documents = await query('SELECT id FROM documents WHERE title = ?', [
      importName,
    ]);
    assert.equal(
      documents.length,
      1,
      'Import fixture must be a stored document',
    );
    const documentId = documents[0].id;
    const existingMappings = await query(
      'SELECT status FROM doc_knowledge_mappings WHERE document_id = ? AND knowledge_base_id = ?',
      [documentId, kbId],
    );
    if (!existingMappings.length) {
      await navigate(`/knowledge/detail?id=${encodeURIComponent(kbId)}`);
      await wait('knowledge detail ready', () =>
        evaluate(
          'return !!document.querySelector(\'button[title="添加文档"]\');',
        ),
      );
      await click('button[title="添加文档"]');
      const checkbox = await wait('stored document is offered for import', () =>
        evaluate(
          `const label = [...document.querySelectorAll('label')].find(label => label.innerText.includes(arguments[0]));
        return label?.querySelector('[role="checkbox"]');`,
          [importName],
        ),
      );
      await wd(`/element/${checkbox[elementKey]}/click`, {});
      const confirm = await evaluate(
        `return [...document.querySelectorAll('button')].find(button => button.textContent.startsWith('确认添加'));`,
      );
      await wd(`/element/${confirm[elementKey]}/click`, {});
    }
    await wait('document is indexed in the library', async () => {
      const rows = await query(
        'SELECT status FROM doc_knowledge_mappings WHERE document_id = ? AND knowledge_base_id = ?',
        [documentId, kbId],
      );
      return rows[0]?.status === 'indexed';
    });
    record('stored document imported and indexed', {
      documentId,
      reused: existingMappings.length > 0,
    });
  }

  const indexed = await query(
    `SELECT d.id, COUNT(c.id) AS chunks FROM documents d
    JOIN doc_knowledge_mappings m ON m.document_id = d.id
    JOIN document_chunks c ON c.batch_id = d.active_index_batch_id
    WHERE m.knowledge_base_id = ? AND m.status = 'indexed' AND d.lexical_status = 'ready'
    GROUP BY d.id`,
    [kbId],
  );
  assert(indexed.length > 0, 'Corpus must have a published keyword index');
  record('imported documents have active keyword chunks', {
    documents: indexed.length,
    chunks: indexed.reduce((sum, row) => sum + row.chunks, 0),
  });

  const chatRoute = `/chat?conversation=${encodeURIComponent(conversationId)}`;
  await navigate(chatRoute);
  await wait('conversation mount restored without knowledgeBase URL', () =>
    mounted(name),
  );
  await wait('enabled composer', () =>
    evaluate(
      `return !!document.querySelector('textarea:not(:disabled)') && !!document.querySelector('button[aria-label="发送消息"]');`,
    ),
  );
  record('conversation mount restored after reload');

  if (expectSemantic) {
    const coverage = await wait(
      'selected real model covers every active chunk',
      async () => {
        const rows = await query(
          `SELECT d.id,d.semantic_status,d.embedding_fingerprint,COUNT(c.id) AS chunks,
        COUNT(e.chunk_id) AS vectors,MIN(e.dimension) AS dimension FROM documents d
        JOIN doc_knowledge_mappings m ON m.document_id=d.id JOIN document_chunks c ON c.batch_id=d.active_index_batch_id
        LEFT JOIN document_chunk_embeddings e ON e.chunk_id=c.id AND e.fingerprint=d.embedding_fingerprint
        WHERE m.knowledge_base_id=? GROUP BY d.id`,
          [kbId],
        );
        return rows.length === indexed.length &&
          rows.every(
            (row) =>
              row.semantic_status === 'ready' &&
              row.chunks > 0 &&
              row.vectors === row.chunks &&
              (!expectedDimension || row.dimension === expectedDimension),
          )
          ? rows
          : false;
      },
      120000,
    );
    assert.equal(
      new Set(coverage.map((row) => row.embedding_fingerprint)).size,
      1,
    );
    selectedFingerprint = coverage[0].embedding_fingerprint;
    sampleDocumentId = coverage.find((row) => row.chunks === 1)?.id;
    record('selected embedding fingerprint has complete real-vector coverage', {
      coverage,
    });
  }

  const before = await query(
    'SELECT id FROM messages WHERE conversation_id = ? AND role = ?',
    [conversationId, 'assistant'],
  );
  const existing = new Set(before.map((row) => row.id));
  const textarea = await wd('/element', {
    using: 'css selector',
    value: 'textarea',
  });
  await wd(`/element/${textarea[elementKey]}/value`, {
    text: question,
    value: [...question],
  });
  await click('button[aria-label="发送消息"]');

  const answer = await wait(
    'real model finishes knowledge answer',
    async () => {
      const rows = await query(
        'SELECT id, content, citations, status FROM messages WHERE conversation_id = ? AND role = ? ORDER BY created_at DESC',
        [conversationId, 'assistant'],
      );
      const latest = rows.find((row) => !existing.has(row.id));
      if (!latest) return false;
      const runs = await query(
        'SELECT status FROM agent_runs WHERE assistant_message_id = ?',
        [latest.id],
      );
      const status = runs[0]?.status;
      if (status === 'waiting_approval') {
        // Respect the app's existing policy. Only approve this run's knowledge
        // reads, never a filesystem/shell/web action or a global trust setting.
        const approvals = await query(
          "SELECT server FROM agent_approvals WHERE run_id = ? AND status = 'pending'",
          [latest.id],
        );
        assert(
          approvals.every((row) => row.server === 'knowledge'),
          'Unexpected non-knowledge approval',
        );
        const selector = `button[data-approval-choice="${approvalChoice}"][data-approval-run="${latest.id}"]`;
        if (
          approvals.length &&
          (await evaluate('return !!document.querySelector(arguments[0]);', [
            selector,
          ]))
        ) {
          if (approvalChoice === 'conversation')
            assert.equal(
              approvedCalls,
              0,
              'Conversation grant still asks for another Knowledge read',
            );
          await click(selector);
          approvedCalls++;
        }
      }
      if (status === 'failed' || status === 'cancelled')
        throw new Error(`Agent run ${status}`);
      if (
        status === 'completed' &&
        latest.content &&
        latest.status === 'sent'
      ) {
        assert(
          latest.citations && JSON.parse(latest.citations).length > 0,
          `Completed answer ${latest.id} has no validated source citation`,
        );
        return latest;
      }
      return false;
    },
    180000,
  );
  assert(
    answer.content.includes(expected),
    'Answer did not contain the expected source fact',
  );
  const citations = JSON.parse(answer.citations);
  assert(
    citations.some((citation) => citation.quote.includes(expected)),
    'Citation did not support the source fact',
  );
  const outputs = await query(
    "SELECT payload FROM agent_run_events WHERE run_id = ? AND event_type = 'tool_call_output'",
    [answer.id],
  );
  assert(
    outputs.some((row) => {
      const event = JSON.parse(row.payload);
      return (
        event.server === 'knowledge' &&
        event.tool === 'search' &&
        event.output?.ok
      );
    }),
    'No successful knowledge search recorded',
  );
  if (expectSemantic) {
    const searches = outputs
      .map((row) => JSON.parse(row.payload))
      .filter(
        (event) =>
          event.server === 'knowledge' &&
          event.tool === 'search' &&
          event.output?.ok,
      );
    assert(
      searches.some(
        (event) =>
          event.output.diagnostics?.denseHits > 0 &&
          event.output.diagnostics?.embeddingFingerprint ===
            selectedFingerprint,
      ),
      'No actual Dense contribution recorded',
    );
    assert(
      outputs.some((row) => {
        const event = JSON.parse(row.payload);
        return (
          event.server === 'knowledge' &&
          event.tool === 'read' &&
          event.output?.ok
        );
      }),
      'No successful model-requested source read recorded',
    );
    assert(
      citations.every((citation) => citation.range?.chunks?.length),
      'Citation lost its delivered source identity',
    );
    record('real query embedding contributed Dense results', {
      diagnostics: searches.map((event) => event.output.diagnostics),
    });
  }
  if (approvalChoice === 'conversation') {
    assert.equal(
      approvedCalls,
      1,
      'Expected one explicit Knowledge conversation approval',
    );
    record('one conversation approval covers Knowledge search and read');
  }
  record('real model searched corpus and persisted a supported answer', {
    messageId: answer.id,
    citations: citations.length,
    sessionAttachments: (
      await query(
        'SELECT document_id FROM conversation_document_mappings WHERE conversation_id = ?',
        [conversationId],
      )
    ).length,
  });

  const citationSelector = `[data-message-id="${answer.id}"] button[aria-label="查看引用 1"]`;
  await wait('source buttons render', () =>
    evaluate('return !!document.querySelector(arguments[0]);', [
      citationSelector,
    ]),
  );
  assert.equal(
    await evaluate(`return [...document.querySelectorAll('[data-slot="assistant-answer"]')].some(block => {
      const copy = block.cloneNode(true); copy.querySelectorAll('code,pre').forEach(node => node.remove());
      return /\\[\\[E\\d+\\]\\]/.test(copy.textContent || '');
    });`),
    false,
    'Raw evidence marker leaked into rendered answer',
  );
  await click(citationSelector);
  await wait('source quote opens', () =>
    evaluate(
      'return [...document.querySelectorAll(\'[role="dialog"]\')].some(dialog => dialog.innerText.includes(arguments[0]));',
      [expected],
    ),
  );
  record('citation opens source quote');
  if (expectSemantic) {
    const openSource = await evaluate(
      "return [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent === '查看原文');",
    );
    assert(openSource?.[elementKey], 'Missing original-source entry');
    await wd(`/element/${openSource[elementKey]}/click`, {});
    await wait('source sheet reopens the actual delivered range', () =>
      evaluate(
        `return document.querySelector('[data-citation-source-text]')?.innerText.includes(arguments[0]) && !document.querySelector('[role="alert"]');`,
        [expected],
      ),
    );
    record('source sheet revalidates and reads the original source');
  }

  const modelPath = process.env.CHATLESS_KB_MODEL_PATH;
  const tokenizerPath = process.env.CHATLESS_KB_TOKENIZER_PATH;
  if (expectSemantic && modelPath && tokenizerPath) {
    const handle = `reload_probe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const native = (command, args) =>
      wd('/execute/async', {
        script: `const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({failure:String(error)}));`,
        args: [command, args],
      });
    try {
      const initialized = await native('init_onnx_session', {
        sessionId: handle,
        modelPath,
        tokenizerPath,
      });
      assert(!initialized.failure, initialized.failure);
      assert(
        selectedFingerprint.includes(initialized.value.modelHash) &&
          selectedFingerprint.includes(initialized.value.tokenizerHash),
        'The real model artifacts do not match the indexed fingerprint',
      );
      if (sampleDocumentId) {
        const samples = await query(
          `SELECT c.search_text,hex(e.embedding) AS bytes,e.dimension FROM document_chunks c
          JOIN documents d ON d.active_index_batch_id=c.batch_id
          JOIN document_chunk_embeddings e ON e.chunk_id=c.id AND e.fingerprint=d.embedding_fingerprint
          WHERE d.id=? LIMIT 1`,
          [sampleDocumentId],
        );
        assert.equal(samples.length, 1);
        const sample = samples[0];
        const tokens = await native('tokenize_batch', {
          sessionId: handle,
          tokenizerPath,
          texts: [sample.search_text],
          maxLength: Number(selectedFingerprint.split(':')[3]),
        });
        assert(!tokens.failure, tokens.failure);
        const generated = await native('generate_embedding', {
          sessionId: handle,
          input: tokens.value,
        });
        assert(!generated.failure, generated.failure);
        const vector = generated.value[0];
        const bytes = Buffer.from(sample.bytes, 'hex');
        assert.equal(bytes.length, sample.dimension * 4);
        assert.equal(vector.length, sample.dimension);
        let dot = 0,
          storedNorm = 0,
          generatedNorm = 0;
        for (let index = 0; index < vector.length; index++) {
          const stored = bytes.readFloatLE(index * 4);
          dot += stored * vector[index];
          storedNorm += stored * stored;
          generatedNorm += vector[index] * vector[index];
        }
        const cosine = dot / Math.sqrt(storedNorm * generatedNorm);
        assert(
          cosine > 0.999,
          'Stored vectors do not match real ONNX inference',
        );
        record('stored vector matches independent real-model inference', {
          documentId: sampleDocumentId,
          dimension: sample.dimension,
          cosine,
        });
      }
      assert(
        citations.some((citation) => citation.documentId),
        'No source document identity',
      );
      await navigate(chatRoute);
      await wait('reloaded desktop ready', () =>
        evaluate('return !!document.querySelector("textarea");'),
      );
      const oldHandle = await native('count_embedding_tokens', {
        sessionId: handle,
        tokenizerPath,
        texts: ['after reload'],
      });
      assert(
        String(oldHandle.failure || '').includes('not initialized'),
        'A departed page retained an orphaned ONNX session',
      );
      record('page reload releases only its departed model handles');
    } finally {
      await native('release_onnx_session', { sessionId: handle });
    }
  }

  await navigate(chatRoute);
  await wait(
    'mount and citations survive reload',
    async () =>
      (await mounted(name)) &&
      (await evaluate('return !!document.querySelector(arguments[0]);', [
        citationSelector,
      ])),
  );
  record('mount and clickable citations survive reload');

  // Exercise the actual library-to-chat entry path, not just a clean chat URL.
  await navigate(`${chatRoute}&knowledgeBase=${encodeURIComponent(kbId)}`);
  await wait(
    'deep link consumed for its destination',
    async () =>
      (await mounted(name)) &&
      (await evaluate(
        'return !new URLSearchParams(location.search).has("knowledgeBase");',
      )),
  );
  await click('button[title="新建对话"]');
  await wait(
    'new conversation has no inherited library',
    async () => !(await mounted(name)),
  );
  await navigate(chatRoute);
  await wait('original conversation retains its own library', () =>
    mounted(name),
  );
  record('conversation switching does not leak or lose the mount');

  const remove = await evaluate(
    `const chip = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === arguments[0]);
    return chip?.querySelector('svg.lucide-x');`,
    [name],
  );
  assert(remove?.[elementKey], 'No remove control on the mounted library chip');
  await wd(`/element/${remove[elementKey]}/click`, {});
  await wait('library removed immediately', async () => !(await mounted(name)));
  assert.equal(
    await evaluate(
      `const saved = JSON.parse(localStorage.getItem('conversation-knowledge-mounts') || '{}');
    return !!saved.state?.knowledgeBaseByConversation?.[arguments[0]];`,
      [conversationId],
    ),
    false,
  );
  await navigate(chatRoute);
  await wait('chat reloaded', () =>
    evaluate('return !!document.querySelector("textarea");'),
  );
  assert.equal(
    await mounted(name),
    false,
    'Removed library reappeared on reload',
  );
  // Restore the explicit selection, leaving the test conversation usable.
  await navigate(`${chatRoute}&knowledgeBase=${encodeURIComponent(kbId)}`);
  await wait('explicit mount restored', () => mounted(name));
  record('removal persists and explicit selection can remount');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
}
