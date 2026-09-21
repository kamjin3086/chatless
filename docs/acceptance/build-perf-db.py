"""Build the 50k-chunk performance database.

Run: python docs/acceptance/build-perf-db.py [db-path] [chunk-count]

Chunk text mirrors the production shape: a heading-like prefix plus a body with
Chinese and English tokens, one embedding-free row per chunk, indexed in FTS5.
"""
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SCHEMA = """
CREATE TABLE documents(id TEXT PRIMARY KEY, active_index_batch_id TEXT);
CREATE TABLE document_chunks(
  id TEXT PRIMARY KEY, document_id TEXT, batch_id TEXT, chunk_index INTEGER,
  source_text TEXT, search_text TEXT, metadata TEXT, locator TEXT);
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(chunk_id UNINDEXED, search_text);
CREATE TABLE doc_knowledge_mappings(document_id TEXT, knowledge_base_id TEXT);
"""
CN_TOPICS = ["主轴温升", "冷却回路", "过载保护", "熔断器更换", "折旧计提", "巡检记录",
             "编码器屏蔽", "低压报警", "保养周期", "备件库存", "线缆整改", "扭矩校验"]
EN_TOPICS = ["spindle alarm", "coolant pressure", "encoder shield", "brake resistor",
             "response target", "lockout tagout", "alarm export", "spare kit",
             "deceleration ramp", "consumable filter", "torque value", "shift handover"]


def main() -> None:
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "retrieval-perf.sqlite"
    total = int(sys.argv[2]) if len(sys.argv) > 2 else 50000
    if target.exists():
        target.unlink()
    db = sqlite3.connect(target)
    db.executescript(SCHEMA)
    db.execute("PRAGMA journal_mode=WAL")
    per_document = 200
    documents = total // per_document
    for d in range(documents):
        doc_id = f"perf-doc-{d:04d}"
        batch = f"{doc_id}-b1"
        db.execute("INSERT INTO documents VALUES (?,?)", (doc_id, batch))
        db.execute("INSERT INTO doc_knowledge_mappings VALUES (?,?)", (doc_id, "kb-perf"))
        for index in range(per_document):
            cn = CN_TOPICS[(d + index) % len(CN_TOPICS)]
            en = EN_TOPICS[(d * 3 + index) % len(EN_TOPICS)]
            code = f"E-{1000 + ((d * per_document + index) % 4000)}"
            chunk_id = f"{doc_id}-c{index:03d}"
            text = (f"{cn} 与 {en}。参考 {code}，设备编号 HX-{400 + (index % 60)}，"
                    f"第 {index} 段记录扭矩 {80 + (index % 40)} 牛米。")
            tokens = text.replace("。", " ").replace("，", " ").replace("与", " ").replace("。", " ")
            db.execute("INSERT INTO document_chunks VALUES (?,?,?,?,?,?,?,?)",
                       (chunk_id, doc_id, batch, index, text, tokens, "{}", "{}"))
            db.execute("INSERT INTO document_chunks_fts VALUES (?,?)", (chunk_id, tokens))
        if d % 20 == 0:
            db.commit()
    db.commit()
    queries = {
        "cn_topic": ["主轴温升", "冷却回路 压力", "熔断器更换", "折旧计提"],
        "code": ["E-1042", "E-2500", "E-3777", "E-1999"],
        "mixed": ["编码器屏蔽 E-1042", "spindle alarm HX-420", "保养周期 牛米", "低压报警 E-2207"],
        "english": ["spindle alarm", "coolant pressure", "lockout tagout"],
        "short_cn": ["过载", "熔断", "折旧"],
    }
    (ROOT / "retrieval-perf-queries.json").write_text(
        json.dumps(queries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    db.close()
    print(f"built {target} with {documents * per_document} chunks")


if __name__ == "__main__":
    main()
