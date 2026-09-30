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
use dashmap::DashMap;
use futures_util::TryStreamExt;
use lazy_static::lazy_static;

lazy_static! {
  static ref DENSE_CANCELLATIONS: DashMap<String, bool> = DashMap::new();
}

async fn sqlite_pool(instances: State<'_, DbInstances>, db: String) -> Result<SqlitePool, String> {
  let pools = instances.0.read().await;
  match pools.get(&db) {
    Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
    None => Err(format!("database is not loaded: {db}")),
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunkInput {
  id: String,
  chunk_index: i64,
  source_text: String,
  search_text: String,
  locator: Option<Value>,
  metadata: Option<Value>,
  fts_text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkEmbeddingInput { chunk_id: String, embedding: Vec<f32> }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenseSearchHit { pub(crate) chunk_id: String, pub(crate) score: f32 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventInput { event_id: String, event_type: String, payload: String, created_at: i64 }

#[tauri::command]
pub async fn store_document_embeddings(
  instances: State<'_, DbInstances>, db: String, task_id: String, document_id: String,
  batch_id: String, document_version: i64, fingerprint: String,
  embeddings: Vec<ChunkEmbeddingInput>, created_at: i64, replace_existing: bool, complete: bool,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let valid = sqlx::query("SELECT 1 FROM documents d JOIN document_index_tasks t ON t.document_id = d.id WHERE d.id = ? AND d.active_index_batch_id = ? AND d.index_version = ? AND t.id = ? AND t.status IN ('pending','running')")
    .bind(&document_id).bind(&batch_id).bind(document_version).bind(&task_id)
    .fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
  if valid.is_none() { return Err("语义索引任务已取消或文档版本已变化".into()); }
  let dimension = embeddings.first().map(|item| item.embedding.len()).unwrap_or(0);
  if dimension == 0 || embeddings.iter().any(|item| item.embedding.len() != dimension) {
    return Err("embedding 维度为空或不一致".into());
  }
  if replace_existing {
    sqlx::query("DELETE FROM document_chunk_embeddings WHERE batch_id = ? AND fingerprint = ?")
      .bind(&batch_id).bind(&fingerprint).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }
  for item in embeddings {
    let bytes: Vec<u8> = item.embedding.iter().flat_map(|value| value.to_le_bytes()).collect();
    sqlx::query("INSERT INTO document_chunk_embeddings (chunk_id, batch_id, fingerprint, dimension, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(item.chunk_id).bind(&batch_id).bind(&fingerprint).bind(dimension as i64).bind(bytes).bind(created_at)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }
  if complete {
    sqlx::query("UPDATE document_index_tasks SET status = 'completed', updated_at = ?, error = NULL WHERE id = ?")
      .bind(created_at).bind(&task_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE documents SET semantic_status = 'ready', embedding_fingerprint = ?, embedding_dimension = ? WHERE id = ? AND active_index_batch_id = ?")
      .bind(&fingerprint).bind(dimension as i64).bind(&document_id).bind(&batch_id)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }
  tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dense_search_document_chunks(
  instances: State<'_, DbInstances>, db: String, request_id: String, query_embedding: Vec<f32>,
  document_ids: Vec<String>, fingerprint: String, top_k: usize,
) -> Result<Vec<DenseSearchHit>, String> {
  if query_embedding.is_empty() || document_ids.is_empty() || top_k == 0 { return Ok(vec![]); }
  // A cancel that arrives before the scan starts must win. Overwriting the flag
  // with `false` here used to lose that cancellation entirely.
  if DENSE_CANCELLATIONS.get(&request_id).is_some_and(|flag| *flag) {
    DENSE_CANCELLATIONS.remove(&request_id);
    return Err("DENSE_SEARCH_CANCELLED".into());
  }
  DENSE_CANCELLATIONS.entry(request_id.clone()).or_insert(false);
  // The wrapper owns the registry entry, so every exit path (including `?`
  // failures) still clears it.
  let pool = sqlite_pool(instances, db).await?;
  let result = dense_scan(&pool, &request_id, &query_embedding, &document_ids, &fingerprint, top_k).await;
  DENSE_CANCELLATIONS.remove(&request_id);
  result
}

/// Exact dense scan over the authorised documents of the active batch, keeping
/// only the top K in memory.  Takes the pool directly so the acceptance
/// benchmark measures this production statement shape.
pub(crate) async fn dense_scan(
  pool: &SqlitePool, request_id: &str, query_embedding: &[f32],
  document_ids: &[String], fingerprint: &str, top_k: usize,
) -> Result<Vec<DenseSearchHit>, String> {
  let mut builder = sqlx::QueryBuilder::new("SELECT e.chunk_id, e.dimension, e.embedding FROM document_chunk_embeddings e JOIN document_chunks c ON c.id = e.chunk_id JOIN documents d ON d.active_index_batch_id = c.batch_id WHERE e.fingerprint = ");
  builder.push_bind(fingerprint).push(" AND c.document_id IN (");
  let mut separated = builder.separated(",");
  for id in document_ids { separated.push_bind(id); }
  separated.push_unseparated(")");
  let mut rows = builder.build().fetch(pool);
  let query_norm = query_embedding.iter().map(|v| v * v).sum::<f32>().sqrt();
  let mut best: Vec<DenseSearchHit> = Vec::with_capacity(top_k);
  while let Some(row) = rows.try_next().await.map_err(|e| e.to_string())? {
    if DENSE_CANCELLATIONS.get(request_id).is_some_and(|flag| *flag) {
      return Err("DENSE_SEARCH_CANCELLED".into());
    }
    let dimension = row.get::<i64, _>("dimension") as usize;
    let bytes = row.get::<Vec<u8>, _>("embedding");
    if dimension != query_embedding.len() || bytes.len() != dimension * 4 { continue; }
    let mut dot = 0.0f32; let mut norm = 0.0f32;
    for (index, query) in query_embedding.iter().enumerate() {
      let offset = index * 4;
      let value = f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
      dot += query * value; norm += value * value;
    }
    let score = if query_norm > 0.0 && norm > 0.0 { dot / (query_norm * norm.sqrt()) } else { 0.0 };
    best.push(DenseSearchHit { chunk_id: row.get("chunk_id"), score });
    best.sort_by(|a, b| b.score.total_cmp(&a.score));
    if best.len() > top_k { best.pop(); }
  }
  Ok(best)
}

#[tauri::command]
pub fn cancel_dense_search(request_id: String) { DENSE_CANCELLATIONS.insert(request_id, true); }

async fn publish_document_batch_on_pool(
  pool: &SqlitePool,
  document_id: &str,
  batch_id: &str,
  expected_file_hash: Option<&str>,
  task_id: &str,
  expected_document_version: i64,
  chunks: Vec<DocumentChunkInput>,
  created_at: i64,
) -> Result<(), String> {
  if chunks.is_empty() {
    return Err("文档分块为空，拒绝发布索引".into());
  }
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let document = sqlx::query("SELECT file_hash, index_version FROM documents WHERE id = ? LIMIT 1")
    .bind(document_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
  let document = document.ok_or_else(|| "文档已删除，取消发布索引".to_string())?;
  if let Some(expected) = expected_file_hash {
    let current: Option<String> = document.try_get("file_hash").map_err(|e| e.to_string())?;
    if current.as_deref().is_some_and(|value| value != expected) {
      return Err("文档版本已变化，取消发布过期索引".into());
    }
  }
  let current_version: i64 = document.try_get("index_version").map_err(|e| e.to_string())?;
  if current_version != expected_document_version {
    return Err("文档版本已变化，取消发布过期索引".into());
  }
  let task = sqlx::query("SELECT 1 FROM document_index_tasks WHERE id = ? AND document_id = ? AND document_version = ? AND task_type = 'lexical' AND status = 'running'")
    .bind(task_id).bind(document_id).bind(expected_document_version)
    .fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
  if task.is_none() { return Err("索引任务已取消或已失效".into()); }
  let accessible = sqlx::query(
    "SELECT 1 FROM doc_knowledge_mappings WHERE document_id = ? UNION ALL SELECT 1 FROM conversation_document_mappings WHERE document_id = ? LIMIT 1",
  ).bind(document_id).bind(document_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
  if accessible.is_none() {
    return Err("文档已取消挂载，取消发布索引".into());
  }

  sqlx::query("INSERT INTO document_index_batches (id, document_id, state, created_at) VALUES (?, ?, 'staging', ?)")
    .bind(batch_id).bind(document_id).bind(created_at).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  for chunk in chunks {
    let locator = serde_json::to_string(&chunk.locator.unwrap_or(Value::Object(Default::default()))).map_err(|e| e.to_string())?;
    let metadata = serde_json::to_string(&chunk.metadata.unwrap_or(Value::Object(Default::default()))).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO document_chunks (id, document_id, batch_id, chunk_index, source_text, search_text, locator, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(&chunk.id).bind(document_id).bind(batch_id).bind(chunk.chunk_index)
      .bind(&chunk.source_text).bind(&chunk.search_text).bind(locator).bind(metadata)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO document_chunks_fts (chunk_id, search_text) VALUES (?, ?)")
      .bind(&chunk.id).bind(&chunk.fts_text).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }

  sqlx::query("UPDATE document_index_batches SET state = 'retired' WHERE document_id = ? AND state = 'active'")
    .bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_batches SET state = 'active', activated_at = ? WHERE id = ? AND document_id = ? AND state = 'staging'")
    .bind(created_at).bind(batch_id).bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE documents SET active_index_batch_id = ?, index_version = index_version + 1, lexical_status = 'ready', semantic_status = 'pending', is_indexed = 1, updated_at = ? WHERE id = ?")
    .bind(batch_id).bind(created_at).bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE doc_knowledge_mappings SET status = 'indexed', indexed_at = ? WHERE document_id = ?")
    .bind(created_at).bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_tasks SET status = 'completed', updated_at = ?, error = NULL WHERE id = ?")
    .bind(created_at).bind(task_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;

  // Only after the new batch is active can retired content be removed. All of
  // these writes share this transaction, so a failure restores the old batch.
  sqlx::query("DELETE FROM document_chunks_fts WHERE chunk_id IN (SELECT c.id FROM document_chunks c JOIN document_index_batches b ON b.id = c.batch_id WHERE b.document_id = ? AND b.state = 'retired')")
    .bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("DELETE FROM document_index_batches WHERE document_id = ? AND state = 'retired'")
    .bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

/// Atomically publish one document-owned lexical batch. Knowledge bases and
/// conversations only grant access; they never duplicate chunk text.
#[tauri::command]
pub async fn publish_document_batch(
  instances: State<'_, DbInstances>,
  db: String,
  document_id: String,
  batch_id: String,
  expected_file_hash: Option<String>,
  task_id: String,
  expected_document_version: i64,
  chunks: Vec<DocumentChunkInput>,
  created_at: i64,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  publish_document_batch_on_pool(&pool, &document_id, &batch_id, expected_file_hash.as_deref(),
    &task_id, expected_document_version, chunks, created_at).await
}

#[tauri::command]
pub async fn delete_document_atomically(
  instances: State<'_, DbInstances>, db: String, document_id: String, updated_at: i64,
) -> Result<bool, String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_tasks SET status = 'cancelled', updated_at = ? WHERE document_id = ? AND status IN ('pending','running')")
    .bind(updated_at).bind(&document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("DELETE FROM document_chunks_fts WHERE chunk_id IN (SELECT id FROM document_chunks WHERE document_id = ?)")
    .bind(&document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("DELETE FROM document_index_batches WHERE document_id = ?")
    .bind(&document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  let deleted = sqlx::query("DELETE FROM documents WHERE id = ?")
    .bind(&document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?.rows_affected() > 0;
  tx.commit().await.map_err(|e| e.to_string())?;
  Ok(deleted)
}

#[tauri::command]
pub async fn agent_create_run(
  instances: State<'_, DbInstances>,
  db: String,
  run_id: String,
  conversation_id: String,
  assistant_message_id: String,
  started_at: i64,
  parent_run_id: Option<String>,
  run_kind: String,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  sqlx::query(
    "INSERT OR IGNORE INTO agent_runs (id, conversation_id, assistant_message_id, status, started_at, parent_run_id, run_kind) VALUES (?, ?, ?, 'running', ?, ?, ?)",
  )
  .bind(run_id)
  .bind(conversation_id)
  .bind(assistant_message_id)
  .bind(started_at)
  .bind(parent_run_id)
  .bind(run_kind)
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
pub async fn agent_commit_model_step(
  instances: State<'_, DbInstances>, db: String, run_id: String, conversation_id: String,
  events: Vec<AgentEventInput>,
) -> Result<i64, String> {
  let pool = sqlite_pool(instances, db).await?;
  agent_commit_model_step_on_pool(&pool, &run_id, &conversation_id, events).await
}

async fn agent_commit_model_step_on_pool(
  pool: &SqlitePool, run_id: &str, conversation_id: &str, events: Vec<AgentEventInput>,
) -> Result<i64, String> {
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let mut seq: i64 = sqlx::query("SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_run_events WHERE run_id = ?")
    .bind(run_id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?.try_get("seq").map_err(|e| e.to_string())?;
  for event in events {
    seq += 1;
    sqlx::query("INSERT INTO agent_run_events (id, run_id, conversation_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(event.event_id).bind(run_id).bind(conversation_id).bind(seq).bind(event.event_type)
      .bind(event.payload).bind(event.created_at).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  }
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

#[tauri::command]
pub async fn agent_save_checkpoint(
  instances: State<'_, DbInstances>, db: String, checkpoint_id: String, run_id: String,
  kind: String, payload: String, created_at: i64,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let seq: i64 = sqlx::query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM agent_run_checkpoints WHERE run_id = ?")
    .bind(&run_id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?.try_get("seq").map_err(|e| e.to_string())?;
  sqlx::query("INSERT INTO agent_run_checkpoints (id, run_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(checkpoint_id).bind(run_id).bind(seq).bind(kind).bind(payload).bind(created_at)
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_request_approval(
  instances: State<'_, DbInstances>, db: String, approval_id: String, run_id: String,
  conversation_id: String, call_id: Option<String>, server: String, tool: String,
  normalized_args: String, scope: String, created_at: i64,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  sqlx::query("INSERT OR REPLACE INTO agent_approvals (id, run_id, conversation_id, call_id, server, tool, normalized_args, scope, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(approval_id).bind(&run_id).bind(conversation_id).bind(call_id).bind(server).bind(tool)
    .bind(normalized_args).bind(scope).bind(created_at).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE agent_runs SET status = 'waiting_approval', ended_at = NULL WHERE id = ?")
    .bind(run_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_decide_approval(
  instances: State<'_, DbInstances>, db: String, approval_id: String, status: String, decided_at: i64,
) -> Result<bool, String> {
  if status != "approved" && status != "rejected" { return Err("invalid approval status".into()); }
  let pool = sqlite_pool(instances, db).await?;
  let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
  let row = sqlx::query("SELECT run_id FROM agent_approvals WHERE id = ? AND status = 'pending'")
    .bind(&approval_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
  let Some(row) = row else { return Ok(false); };
  let run_id: String = row.try_get("run_id").map_err(|e| e.to_string())?;
  sqlx::query("UPDATE agent_approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .bind(status).bind(decided_at).bind(approval_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'waiting_approval'")
    .bind(run_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())?;
  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::*;
  use sqlx::sqlite::SqlitePoolOptions;

  async fn test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    for sql in [
      "PRAGMA foreign_keys = ON",
      "CREATE TABLE documents (id TEXT PRIMARY KEY, file_hash TEXT, active_index_batch_id TEXT, index_version INTEGER NOT NULL DEFAULT 0, lexical_status TEXT NOT NULL DEFAULT 'pending', semantic_status TEXT NOT NULL DEFAULT 'pending', is_indexed INTEGER DEFAULT 0, updated_at INTEGER NOT NULL)",
      "CREATE TABLE doc_knowledge_mappings (document_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL, status TEXT NOT NULL, indexed_at INTEGER NOT NULL)",
      "CREATE TABLE conversation_document_mappings (conversation_id TEXT NOT NULL, document_id TEXT NOT NULL)",
      "CREATE TABLE document_index_tasks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_version INTEGER NOT NULL, task_type TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE TABLE document_index_batches (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, activated_at INTEGER, FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE)",
      "CREATE UNIQUE INDEX one_active ON document_index_batches(document_id) WHERE state = 'active'",
      "CREATE TABLE document_chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, batch_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, source_text TEXT NOT NULL, search_text TEXT NOT NULL, locator TEXT NOT NULL, metadata TEXT NOT NULL, FOREIGN KEY(batch_id) REFERENCES document_index_batches(id) ON DELETE CASCADE)",
      "CREATE VIRTUAL TABLE document_chunks_fts USING fts5(chunk_id UNINDEXED, search_text)",
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, assistant_message_id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, parent_run_id TEXT, run_kind TEXT NOT NULL DEFAULT 'normal')",
      "CREATE TABLE agent_run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(run_id, seq))",
    ] { sqlx::query(sql).execute(&pool).await.unwrap(); }
    sqlx::query("INSERT INTO documents (id, file_hash, updated_at) VALUES ('doc', 'hash', 0)").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO doc_knowledge_mappings VALUES ('doc', 'kb', 'pending', 0)").execute(&pool).await.unwrap();
    pool
  }

  fn chunk(id: &str, text: &str) -> DocumentChunkInput {
    DocumentChunkInput { id: id.into(), chunk_index: 0, source_text: text.into(), search_text: text.into(),
      locator: Some(serde_json::json!({"page": 1})), metadata: None, fts_text: text.into() }
  }

  async fn lexical_task(pool: &SqlitePool, id: &str, version: i64) {
    sqlx::query("INSERT INTO document_index_tasks (id, document_id, document_version, task_type, status, created_at, updated_at) VALUES (?, 'doc', ?, 'lexical', 'running', 0, 0)")
      .bind(id).bind(version).execute(pool).await.unwrap();
  }

  #[tokio::test]
  async fn publishes_and_atomically_replaces_active_batch() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", Some("hash"), "t1", 0, vec![chunk("c1", "first")], 1).await.unwrap();
    lexical_task(&pool, "t2", 1).await;
    publish_document_batch_on_pool(&pool, "doc", "b2", Some("hash"), "t2", 1, vec![chunk("c2", "second")], 2).await.unwrap();
    let row = sqlx::query("SELECT active_index_batch_id, index_version FROM documents WHERE id = 'doc'").fetch_one(&pool).await.unwrap();
    assert_eq!(row.get::<String, _>("active_index_batch_id"), "b2");
    assert_eq!(row.get::<i64, _>("index_version"), 2);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_chunks").fetch_one(&pool).await.unwrap(), 1);
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT source_text FROM document_chunks").fetch_one(&pool).await.unwrap(), "second");
  }

  #[tokio::test]
  async fn failed_rebuild_keeps_previous_batch() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "first")], 1).await.unwrap();
    lexical_task(&pool, "t2", 1).await;
    let error = publish_document_batch_on_pool(&pool, "doc", "b2", None, "t2", 1,
      vec![chunk("duplicate", "one"), chunk("duplicate", "two")], 2).await.unwrap_err();
    assert!(error.contains("UNIQUE"));
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT active_index_batch_id FROM documents WHERE id = 'doc'").fetch_one(&pool).await.unwrap(), "b1");
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT source_text FROM document_chunks").fetch_one(&pool).await.unwrap(), "first");
  }

  #[tokio::test]
  async fn detached_document_cannot_be_published() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    sqlx::query("DELETE FROM doc_knowledge_mappings").execute(&pool).await.unwrap();
    let error = publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "first")], 1).await.unwrap_err();
    assert!(error.contains("取消挂载"));
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_batches").fetch_one(&pool).await.unwrap(), 0);
  }

  #[tokio::test]
  async fn model_step_is_atomic_and_sequences_all_events() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO agent_runs (id, conversation_id, assistant_message_id, status, started_at) VALUES ('run', 'conv', 'msg', 'running', 0)")
      .execute(&pool).await.unwrap();
    let events = vec![
      AgentEventInput { event_id: "e1".into(), event_type: "assistant_message".into(), payload: "{}".into(), created_at: 1 },
      AgentEventInput { event_id: "e2".into(), event_type: "tool_call_requested".into(), payload: "{}".into(), created_at: 2 },
    ];
    assert_eq!(agent_commit_model_step_on_pool(&pool, "run", "conv", events).await.unwrap(), 2);
    let seqs = sqlx::query_scalar::<_, i64>("SELECT seq FROM agent_run_events ORDER BY seq").fetch_all(&pool).await.unwrap();
    assert_eq!(seqs, vec![1, 2]);
  }

  #[tokio::test]
  async fn failed_model_step_rolls_back_every_event() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO agent_runs (id, conversation_id, assistant_message_id, status, started_at) VALUES ('run', 'conv', 'msg', 'running', 0)")
      .execute(&pool).await.unwrap();
    let duplicate = vec![
      AgentEventInput { event_id: "same".into(), event_type: "assistant_message".into(), payload: "{}".into(), created_at: 1 },
      AgentEventInput { event_id: "same".into(), event_type: "tool_call_requested".into(), payload: "{}".into(), created_at: 2 },
    ];
    assert!(agent_commit_model_step_on_pool(&pool, "run", "conv", duplicate).await.is_err());
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM agent_run_events").fetch_one(&pool).await.unwrap(), 0);
  }
}
