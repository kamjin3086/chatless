"""Retain a 50K FTS-only performance corpus; never replace an existing DB.

Usage: python3 docs/acceptance/build-lexical-perf-db.py /outside/repo/lexical-50k.sqlite
The 26 annotated chunks are copied verbatim. Padding is explicitly synthetic;
this file measures scale and is not real-model semantic-quality evidence.
"""
import json
import pathlib
import shutil
import sqlite3
import sys

root = pathlib.Path(__file__).resolve().parent
target = pathlib.Path(sys.argv[1])
if target.exists():
    with sqlite3.connect(target) as db:
        count = db.execute('SELECT COUNT(*) FROM document_chunks').fetchone()[0]
    if count != 50_000:
        raise SystemExit(f'Refusing to replace existing {target}: {count} chunks')
    print(f'Reusing {target}: {count} chunks')
    raise SystemExit(0)
source = root / 'retrieval-eval.sqlite'
if not source.exists():
    raise SystemExit('First run python3 docs/acceptance/build-eval-db.py')
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, target)
with sqlite3.connect(target) as db:
    count = db.execute('SELECT COUNT(*) FROM document_chunks').fetchone()[0]
    doc, batch = db.execute('SELECT d.id,d.active_index_batch_id FROM documents d JOIN doc_knowledge_mappings m ON m.document_id=d.id WHERE m.knowledge_base_id=? LIMIT 1', ('kb-eval',)).fetchone()
    chunks = []
    fts = []
    for index in range(50_000-count):
        ident = f'perf-padding-{index:06d}'
        text = f'Neutral benchmark record {index:06d}. Synthetic padding for FTS scan measurement only.'
        chunks.append((ident, doc, batch, 1000+index, text, text, json.dumps({'documentName':'Synthetic performance padding','chunkIndex':1000+index}), '{}'))
        fts.append((ident, text.lower()))
    db.executemany('INSERT INTO document_chunks VALUES (?,?,?,?,?,?,?,?)', chunks)
    db.executemany('INSERT INTO document_chunks_fts VALUES (?,?)', fts)
    db.execute('CREATE INDEX IF NOT EXISTS idx_perf_chunk_document ON document_chunks(document_id,batch_id,chunk_index)')
    db.execute('CREATE INDEX IF NOT EXISTS idx_perf_mapping ON doc_knowledge_mappings(knowledge_base_id,document_id)')
    db.execute("INSERT INTO document_chunks_fts(document_chunks_fts) VALUES ('optimize')")
    db.commit()
print(f'Built and retained {target}: 50000 chunks ({count} annotated, {50000-count} synthetic padding)')
