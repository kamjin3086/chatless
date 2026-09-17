//! Durable agent-run writes.
//!
//! The SQL plugin exposes one statement per WebView invocation.  A run event
//! needs an allocated sequence and an insert to be one durable boundary, so
//! these commands borrow the plugin's SQLite pool and use a real SQLx
//! transaction on one connection.

use serde::Deserialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use tauri::{State};
use tauri_plugin_sql::{DbInstances, DbPool};

async fn sqlite_pool(instances: State<'_, DbInstances>, db: String) -> Result<SqlitePool, String> {
  let pools = instances.0.read().await;
  match pools.get(&db) {
    Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
    None => Err(format!("database is not loaded: {db}")),
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBlockInput {
  id: String,
  block_index: i64,
  #[serde(rename = "type")]
  block_type: String,
  text: String,
  page: Option<i64>,
  section_path: Option<Vec<String>>,
  line_start: Option<i64>,
  line_end: Option<i64>,
  char_start: Option<i64>,
  char_end: Option<i64>,
  metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalChunkInput {
  id: String,
  source_start_block: i64,
  source_end_block: i64,
  source_text: String,
  search_text: String,
  metadata: Option<Value>,
  content_hash: String,
  chunk_index: i64,
  fts_text: String,
}

/// Publish one document's lexical index on one SQLite connection. The
/// WebView SQL plugin cannot make BEGIN / INSERT / COMMIT calls share a pool
/// connection, so the replacement must live here.
#[tauri::command]
pub async fn publish_document_index(
  instances: State<'_, DbInstances>,
  db: String,
  document_id: String,
  knowledge_base_id: String,
  blocks: Vec<SourceBlockInput>,
  chunks: Vec<RetrievalChunkInput>,
  created_at: i64,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let mapping = sqlx::query(
    "SELECT 1 FROM doc_knowledge_mappings WHERE document_id = ? AND knowledge_base_id = ? LIMIT 1",
  )
  .bind(&document_id)
  .bind(&knowledge_base_id)
  .fetch_optional(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;
  if mapping.is_none() {
    return Err("知识库文档关系已移除，取消发布索引".into());
  }

  sqlx::query("DELETE FROM retrieval_chunks_fts WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?)")
    .bind(&document_id).bind(&knowledge_base_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("DELETE FROM retrieval_chunks WHERE document_id = ? AND knowledge_base_id = ?")
    .bind(&document_id).bind(&knowledge_base_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("DELETE FROM source_blocks WHERE document_id = ? AND knowledge_base_id = ?")
    .bind(&document_id).bind(&knowledge_base_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("DELETE FROM knowledge_chunks WHERE document_id = ? AND knowledge_base_id = ?")
    .bind(&document_id).bind(&knowledge_base_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;

  for block in blocks {
    sqlx::query("INSERT INTO source_blocks (id, document_id, knowledge_base_id, block_index, block_type, text, page, section_path, line_start, line_end, char_start, char_end, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(block.id).bind(&document_id).bind(&knowledge_base_id).bind(block.block_index).bind(block.block_type).bind(block.text)
      .bind(block.page).bind(block.section_path.map(|value| serde_json::to_string(&value).unwrap_or_else(|_| "[]".into())))
      .bind(block.line_start).bind(block.line_end).bind(block.char_start).bind(block.char_end)
      .bind(serde_json::to_string(&block.metadata.unwrap_or(Value::Object(Default::default()))).unwrap_or_else(|_| "{}".into()))
      .bind(created_at).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }
  for chunk in chunks {
    let metadata = serde_json::to_string(&chunk.metadata.unwrap_or(Value::Object(Default::default()))).unwrap_or_else(|_| "{}".into());
    sqlx::query("INSERT INTO retrieval_chunks (id, document_id, knowledge_base_id, source_start_block, source_end_block, source_text, search_text, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(&chunk.id).bind(&document_id).bind(&knowledge_base_id).bind(chunk.source_start_block).bind(chunk.source_end_block)
      .bind(&chunk.source_text).bind(&chunk.search_text).bind(&metadata).bind(created_at)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO knowledge_chunks (id, knowledge_base_id, document_id, content, chunk_index, content_hash, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(&chunk.id).bind(&knowledge_base_id).bind(&document_id).bind(&chunk.source_text).bind(chunk.chunk_index)
      .bind(&chunk.content_hash).bind(&metadata).bind(created_at)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO retrieval_chunks_fts (chunk_id, search_text) VALUES (?, ?)")
      .bind(&chunk.id).bind(&chunk.fts_text).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }
  tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_create_run(
  instances: State<'_, DbInstances>,
  db: String,
  run_id: String,
  conversation_id: String,
  assistant_message_id: String,
  started_at: i64,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  sqlx::query(
    "INSERT OR IGNORE INTO agent_runs (id, conversation_id, assistant_message_id, status, started_at) VALUES (?, ?, ?, 'running', ?)",
  )
  .bind(run_id)
  .bind(conversation_id)
  .bind(assistant_message_id)
  .bind(started_at)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_append_event(
  instances: State<'_, DbInstances>,
  db: String,
  event_id: String,
  run_id: String,
  conversation_id: String,
  event_type: String,
  payload: String,
  created_at: i64,
) -> Result<i64, String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let row = sqlx::query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM agent_run_events WHERE run_id = ?")
    .bind(&run_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
  let seq: i64 = row.try_get("seq").map_err(|e| e.to_string())?;
  sqlx::query(
    "INSERT INTO agent_run_events (id, run_id, conversation_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  .bind(event_id)
  .bind(run_id)
  .bind(conversation_id)
  .bind(seq)
  .bind(event_type)
  .bind(payload)
  .bind(created_at)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())?;
  Ok(seq)
}

#[tauri::command]
pub async fn agent_set_run_status(
  instances: State<'_, DbInstances>,
  db: String,
  run_id: String,
  status: String,
  ended_at: Option<i64>,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE agent_runs SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?")
    .bind(status)
    .bind(ended_at)
    .bind(run_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}
