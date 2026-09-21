"""Build the retrieval evaluation database from the frozen case set.

Run: python docs/acceptance/build-eval-db.py [db-path]

The schema mirrors the production document-owned tables that the lexical
retriever queries, including the FTS5 table the publish transaction writes.
"""
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parent

SCHEMA = """
CREATE TABLE documents(
  id TEXT PRIMARY KEY, title TEXT, file_type TEXT, file_size INTEGER, file_hash TEXT,
  active_index_batch_id TEXT, lexical_status TEXT, semantic_status TEXT, index_version INTEGER);
CREATE TABLE document_chunks(
  id TEXT PRIMARY KEY, document_id TEXT, batch_id TEXT, chunk_index INTEGER,
  source_text TEXT, search_text TEXT, metadata TEXT, locator TEXT);
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(chunk_id UNINDEXED, search_text);
CREATE TABLE doc_knowledge_mappings(document_id TEXT, knowledge_base_id TEXT);
CREATE TABLE conversation_document_mappings(conversation_id TEXT, document_id TEXT);
"""


def main() -> None:
    cases = json.loads((ROOT / "retrieval-cases.json").read_text(encoding="utf-8"))
    token_path = ROOT / "retrieval-tokens.json"
    if not token_path.exists():
        raise SystemExit(
            "retrieval-tokens.json is missing. Generate it with the production tokenizer:\n"
            "  cd src-tauri && cargo test --lib generate_retrieval_token_fixture -- --ignored --nocapture"
        )
    fixture = json.loads(token_path.read_text(encoding="utf-8"))
    chunk_tokens = fixture["chunks"]
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "retrieval-eval.sqlite"
    if target.exists():
        target.unlink()

    db = sqlite3.connect(target)
    db.executescript(SCHEMA)
    for document in cases["documents"]:
        batch = f"{document['id']}-b1"
        db.execute(
            "INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)",
            (document["id"], document["title"], document["type"], 4096,
             f"hash-{document['id']}", batch, "ready", "ready", 1),
        )
        if document["scope"] == "library":
            db.execute("INSERT INTO doc_knowledge_mappings VALUES (?,?)", (document["id"], "kb-eval"))
        else:
            db.execute("INSERT INTO conversation_document_mappings VALUES (?,?)", ("conv-eval", document["id"]))
        for index, chunk in enumerate(document["chunks"]):
            locator = {"page": chunk.get("page"), "sectionPath": [chunk["heading"]] if chunk.get("heading") else None,
                       "paragraphIndex": index}
            metadata = {"documentName": document["title"], "chunkIndex": index}
            tokenized = chunk_tokens.get(chunk["id"], {})
            search_text = tokenized.get("searchText", chunk["text"])
            fts_text = tokenized.get("ftsText", chunk["text"].lower())
            db.execute(
                "INSERT INTO document_chunks VALUES (?,?,?,?,?,?,?,?)",
                (chunk["id"], document["id"], batch, index, chunk["text"], search_text,
                 json.dumps(metadata, ensure_ascii=False), json.dumps({k: v for k, v in locator.items() if v is not None})),
            )
            db.execute("INSERT INTO document_chunks_fts VALUES (?,?)", (chunk["id"], fts_text))
    db.commit()
    db.close()
    print(f"built {target} with {sum(len(d['chunks']) for d in cases['documents'])} chunks")


if __name__ == "__main__":
    main()
