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
pub async fn prepare_semantic_indexing(instances: State<'_, DbInstances>, db: String, fingerprint: Option<String>, updated_at: i64) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  match fingerprint {
    Some(fingerprint) => prepare_semantic_indexing_on_pool(&pool, &fingerprint, updated_at).await,
    None => prepare_semantic_unavailable_on_pool(&pool, updated_at).await,
  }
}

async fn prepare_semantic_unavailable_on_pool(pool: &SqlitePool, now: i64) -> Result<(), String> {
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_tasks SET status = 'waiting_model', error = 'Embedding model unavailable', updated_at = ? WHERE task_type = 'semantic' AND status IN ('pending','running','waiting_model')")
    .bind(now).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("INSERT INTO document_index_tasks (id, document_id, document_version, task_type, status, created_at, updated_at) SELECT 'semantic_' || lower(hex(randomblob(16))), d.id, d.index_version, 'semantic', 'waiting_model', ?, ? FROM documents d WHERE d.active_index_batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_index_tasks t WHERE t.document_id = d.id AND t.document_version = d.index_version AND t.task_type = 'semantic' AND t.status IN ('pending','running','waiting_model')) AND NOT EXISTS (SELECT 1 FROM document_index_tasks stopped WHERE stopped.id = (SELECT latest.id FROM document_index_tasks latest WHERE latest.document_id = d.id AND latest.document_version = d.index_version AND latest.task_type = 'semantic' ORDER BY latest.rowid DESC LIMIT 1) AND stopped.status IN ('failed','cancelled'))")
    .bind(now).bind(now).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE documents SET semantic_status = 'waiting_model' WHERE EXISTS (SELECT 1 FROM document_index_tasks t WHERE t.document_id = documents.id AND t.document_version = documents.index_version AND t.task_type = 'semantic' AND t.status = 'waiting_model')")
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

async fn prepare_semantic_indexing_on_pool(pool: &SqlitePool, fingerprint: &str, now: i64) -> Result<(), String> {
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_tasks SET status = 'cancelled', error = 'MODEL_CHANGED', updated_at = ? WHERE task_type = 'semantic' AND status IN ('pending','running','waiting_model') AND embedding_fingerprint IS NOT ?")
    .bind(now).bind(fingerprint).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_tasks SET status = 'pending', error = NULL, updated_at = ? WHERE task_type = 'semantic' AND status = 'waiting_model' AND embedding_fingerprint = ?")
    .bind(now).bind(fingerprint).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("INSERT INTO document_index_tasks (id, document_id, document_version, task_type, status, embedding_fingerprint, created_at, updated_at) SELECT 'semantic_' || lower(hex(randomblob(16))), d.id, d.index_version, 'semantic', 'pending', ?, ?, ? FROM documents d WHERE d.active_index_batch_id IS NOT NULL AND (d.semantic_status != 'ready' OR d.embedding_fingerprint IS NOT ?) AND NOT EXISTS (SELECT 1 FROM document_index_tasks t WHERE t.document_id = d.id AND t.document_version = d.index_version AND t.task_type = 'semantic' AND t.status IN ('pending','running','waiting_model')) AND (d.target_embedding_fingerprint IS NOT ? OR NOT EXISTS (SELECT 1 FROM document_index_tasks stopped WHERE stopped.id = (SELECT latest.id FROM document_index_tasks latest WHERE latest.document_id = d.id AND latest.document_version = d.index_version AND latest.task_type = 'semantic' ORDER BY latest.rowid DESC LIMIT 1) AND stopped.embedding_fingerprint = ? AND stopped.status IN ('failed','cancelled'))) AND NOT EXISTS (SELECT 1 FROM document_index_tasks stopped WHERE stopped.id = (SELECT latest.id FROM document_index_tasks latest WHERE latest.document_id = d.id AND latest.document_version = d.index_version AND latest.task_type = 'semantic' ORDER BY latest.rowid DESC LIMIT 1) AND stopped.status = 'cancelled' AND stopped.embedding_fingerprint IS NULL AND COALESCE(stopped.error, '') NOT IN ('MODEL_CHANGED','INDEX_REPLACED'))")
    .bind(fingerprint).bind(now).bind(now).bind(fingerprint).bind(fingerprint).bind(fingerprint).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE documents SET semantic_status = CASE WHEN embedding_fingerprint = ? AND semantic_status = 'ready' THEN 'ready' WHEN target_embedding_fingerprint = ? AND semantic_status = 'failed' THEN 'failed' ELSE 'pending' END, target_embedding_fingerprint = ? WHERE active_index_batch_id IS NOT NULL")
    .bind(fingerprint).bind(fingerprint).bind(fingerprint).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn claim_semantic_model(instances: State<'_, DbInstances>, db: String, task_id: String, fingerprint: String) -> Result<bool, String> {
  let pool = sqlite_pool(instances, db).await?;
  claim_semantic_model_on_pool(&pool, &task_id, &fingerprint).await
}

async fn claim_semantic_model_on_pool(pool: &SqlitePool, task_id: &str, fingerprint: &str) -> Result<bool, String> {
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
  let task = sqlx::query("SELECT t.document_id FROM document_index_tasks t JOIN documents d ON d.id = t.document_id WHERE t.id = ? AND t.task_type = 'semantic' AND t.status = 'running' AND t.document_version = d.index_version AND d.active_index_batch_id IS NOT NULL AND (t.embedding_fingerprint IS NULL OR t.embedding_fingerprint = ?) AND (d.target_embedding_fingerprint IS NULL OR d.target_embedding_fingerprint = ?)")
    .bind(task_id).bind(fingerprint).bind(fingerprint).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
  let Some(task) = task else { return Ok(false); };
  let document_id: String = task.get("document_id");
  sqlx::query("UPDATE document_index_tasks SET embedding_fingerprint = ? WHERE id = ?")
    .bind(fingerprint).bind(task_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE documents SET target_embedding_fingerprint = ?, semantic_status = 'processing' WHERE id = ?")
    .bind(fingerprint).bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  tx.commit().await.map_err(|e| e.to_string())?;
  Ok(true)
}

#[tauri::command]
pub async fn store_document_embeddings(
  instances: State<'_, DbInstances>, db: String, task_id: String, document_id: String,
  batch_id: String, document_version: i64, fingerprint: String,
  embeddings: Vec<ChunkEmbeddingInput>, created_at: i64, replace_existing: bool, complete: bool,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  store_embeddings_on_pool(&pool, task_id, document_id, batch_id, document_version, fingerprint,
    embeddings, created_at, replace_existing, complete).await
}

async fn store_embeddings_on_pool(pool: &SqlitePool, task_id: String, document_id: String,
  batch_id: String, document_version: i64, fingerprint: String, embeddings: Vec<ChunkEmbeddingInput>,
  created_at: i64, replace_existing: bool, complete: bool) -> Result<(), String> {
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
  let valid = sqlx::query("SELECT 1 FROM documents d JOIN document_index_tasks t ON t.document_id = d.id WHERE d.id = ? AND d.active_index_batch_id = ? AND d.index_version = ? AND t.id = ? AND t.status = 'running' AND t.task_type = 'semantic' AND t.document_version = ? AND t.embedding_fingerprint = ? AND d.target_embedding_fingerprint = ?")
    .bind(&document_id).bind(&batch_id).bind(document_version).bind(&task_id).bind(document_version).bind(&fingerprint).bind(&fingerprint)
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
    let inserted = sqlx::query("INSERT INTO document_chunk_embeddings (chunk_id, batch_id, fingerprint, dimension, embedding, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM document_chunks WHERE id = ? AND document_id = ? AND batch_id = ?)")
      .bind(&item.chunk_id).bind(&batch_id).bind(&fingerprint).bind(dimension as i64).bind(bytes).bind(created_at)
      .bind(&item.chunk_id).bind(&document_id).bind(&batch_id)
      .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if inserted.rows_affected() != 1 { return Err("Embedding chunk does not belong to this document batch".into()); }
  }
  if complete {
    let missing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM document_chunks c WHERE c.document_id = ? AND c.batch_id = ? AND NOT EXISTS (SELECT 1 FROM document_chunk_embeddings e WHERE e.chunk_id = c.id AND e.batch_id = c.batch_id AND e.fingerprint = ?)")
      .bind(&document_id).bind(&batch_id).bind(&fingerprint).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    if missing != 0 { return Err("Semantic index does not cover the complete document batch".into()); }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIndexMetadata {
  file_hash: Option<String>, parser_version: Option<String>, chunk_schema_version: Option<String>,
  semantic_parent_task_id: Option<String>,
}

#[cfg(test)]
async fn publish_document_batch_on_pool(pool: &SqlitePool, document_id: &str, batch_id: &str,
  expected_file_hash: Option<&str>, task_id: &str, expected_document_version: i64,
  chunks: Vec<DocumentChunkInput>, created_at: i64) -> Result<(), String> {
  publish_document_batch_with_metadata(pool, document_id, batch_id, expected_file_hash, task_id,
    expected_document_version, chunks, created_at, None).await
}

async fn publish_document_batch_with_metadata(
  pool: &SqlitePool,
  document_id: &str,
  batch_id: &str,
  expected_file_hash: Option<&str>,
  task_id: &str,
  expected_document_version: i64,
  chunks: Vec<DocumentChunkInput>,
  created_at: i64,
  metadata: Option<DocumentIndexMetadata>,
) -> Result<(), String> {
  if chunks.is_empty() {
    return Err("文档分块为空，拒绝发布索引".into());
  }
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
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
  if let Some(parent_id) = metadata.as_ref().and_then(|meta| meta.semantic_parent_task_id.as_deref()) {
    let parent = sqlx::query("SELECT 1 FROM document_index_tasks p JOIN documents d ON d.id = p.document_id WHERE p.id = ? AND p.document_id = ? AND p.document_version = ? AND p.task_type = 'semantic' AND p.status = 'running' AND p.embedding_fingerprint = d.target_embedding_fingerprint")
      .bind(parent_id).bind(document_id).bind(expected_document_version).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    if parent.is_none() { return Err("Semantic adaptation was cancelled or superseded".into()); }
  }
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
  sqlx::query("UPDATE documents SET active_index_batch_id = ?, index_version = index_version + 1, lexical_status = 'ready', semantic_status = 'pending', is_indexed = 1, updated_at = ?, file_hash = COALESCE(?, file_hash), parser_version = COALESCE(?, parser_version), chunk_schema_version = COALESCE(?, chunk_schema_version), target_embedding_fingerprint = NULL WHERE id = ?")
    .bind(batch_id).bind(created_at)
    .bind(metadata.as_ref().and_then(|m| m.file_hash.as_deref()))
    .bind(metadata.as_ref().and_then(|m| m.parser_version.as_deref()))
    .bind(metadata.as_ref().and_then(|m| m.chunk_schema_version.as_deref()))
    .bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("UPDATE document_index_tasks SET status = 'cancelled', error = 'INDEX_REPLACED', updated_at = ? WHERE document_id = ? AND task_type = 'semantic' AND status IN ('pending','running','waiting_model')")
    .bind(created_at).bind(document_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
  sqlx::query("INSERT INTO document_index_tasks (id, document_id, document_version, task_type, status, created_at, updated_at) VALUES ('semantic_' || lower(hex(randomblob(16))), ?, ?, 'semantic', 'pending', ?, ?)")
    .bind(document_id).bind(expected_document_version + 1).bind(created_at).bind(created_at)
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;
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
  metadata: Option<DocumentIndexMetadata>,
) -> Result<(), String> {
  let pool = sqlite_pool(instances, db).await?;
  publish_document_batch_with_metadata(&pool, &document_id, &batch_id, expected_file_hash.as_deref(),
    &task_id, expected_document_version, chunks, created_at, metadata).await
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

async fn acknowledge_evidence(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, run_id: &str, payload: &str) -> Result<(), String> {
  let event: Value = serde_json::from_str(payload).map_err(|e| e.to_string())?;
  if event.get("server").and_then(Value::as_str) != Some("knowledge") { return Ok(()); }
  let mut output = event.get("output").cloned().unwrap_or(Value::Null);
  if let Some(text) = output.as_str() { output = serde_json::from_str(text).unwrap_or(Value::Null); }
  let mut ids: Vec<&str> = output.get("results").and_then(Value::as_array).into_iter().flatten()
    .filter_map(|item| item.get("evidenceId").and_then(Value::as_str)).collect();
  if let Some(id) = output.get("evidenceId").and_then(Value::as_str) { ids.push(id); }
  for id in ids {
    sqlx::query("UPDATE agent_delivered_evidence SET delivered = 1 WHERE run_id = ? AND evidence_id = ?")
      .bind(run_id).bind(id).execute(&mut **tx).await.map_err(|e| e.to_string())?;
  }
  Ok(())
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
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
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
  .bind(&run_id)
  .bind(conversation_id)
  .bind(seq)
  .bind(&event_type)
  .bind(&payload)
  .bind(created_at)
  .execute(&mut *tx)
  .await
  .map_err(|e| e.to_string())?;
  if event_type == "tool_call_output" { acknowledge_evidence(&mut tx, &run_id, &payload).await?; }
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
  // Reserve the writer before reading sequence state. A deferred read snapshot
  // cannot be upgraded after a concurrent message/index write (SQLITE_BUSY_SNAPSHOT).
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
  let mut seq: i64 = sqlx::query("SELECT COALESCE(MAX(seq), 0) AS seq FROM agent_run_events WHERE run_id = ?")
    .bind(run_id).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?.try_get("seq").map_err(|e| e.to_string())?;
  for event in events {
    seq += 1;
    sqlx::query("INSERT INTO agent_run_events (id, run_id, conversation_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(&event.event_id).bind(run_id).bind(conversation_id).bind(seq).bind(&event.event_type)
      .bind(&event.payload).bind(event.created_at).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if event.event_type == "tool_call_output" { acknowledge_evidence(&mut tx, run_id, &event.payload).await?; }
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
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
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
  let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.map_err(|e| e.to_string())?;
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
      "CREATE TABLE documents (id TEXT PRIMARY KEY, file_hash TEXT, parser_version TEXT, chunk_schema_version TEXT, embedding_fingerprint TEXT, embedding_dimension INTEGER, target_embedding_fingerprint TEXT, active_index_batch_id TEXT, index_version INTEGER NOT NULL DEFAULT 0, lexical_status TEXT NOT NULL DEFAULT 'pending', semantic_status TEXT NOT NULL DEFAULT 'pending', is_indexed INTEGER DEFAULT 0, updated_at INTEGER NOT NULL)",
      "CREATE TABLE doc_knowledge_mappings (document_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL, status TEXT NOT NULL, indexed_at INTEGER NOT NULL)",
      "CREATE TABLE conversation_document_mappings (conversation_id TEXT NOT NULL, document_id TEXT NOT NULL)",
      "CREATE TABLE document_index_tasks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_version INTEGER NOT NULL, task_type TEXT NOT NULL, status TEXT NOT NULL, embedding_fingerprint TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      "CREATE TABLE document_index_batches (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, activated_at INTEGER, FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE)",
      "CREATE UNIQUE INDEX one_active ON document_index_batches(document_id) WHERE state = 'active'",
      "CREATE TABLE document_chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, batch_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, source_text TEXT NOT NULL, search_text TEXT NOT NULL, locator TEXT NOT NULL, metadata TEXT NOT NULL, FOREIGN KEY(batch_id) REFERENCES document_index_batches(id) ON DELETE CASCADE)",
      "CREATE VIRTUAL TABLE document_chunks_fts USING fts5(chunk_id UNINDEXED, search_text)",
      "CREATE TABLE document_chunk_embeddings (chunk_id TEXT NOT NULL, batch_id TEXT NOT NULL, fingerprint TEXT NOT NULL, dimension INTEGER NOT NULL, embedding BLOB NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(chunk_id, fingerprint), FOREIGN KEY(chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE)",
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, assistant_message_id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, parent_run_id TEXT, run_kind TEXT NOT NULL DEFAULT 'normal')",
      "CREATE TABLE agent_run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(run_id, seq))",
      "CREATE TABLE agent_delivered_evidence (run_id TEXT, evidence_id TEXT, payload TEXT, created_at INTEGER, delivered INTEGER DEFAULT 0, PRIMARY KEY(run_id,evidence_id))",
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
  async fn evidence_acknowledgement_commits_with_the_tool_output_only() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO agent_delivered_evidence (run_id,evidence_id,payload,created_at) VALUES ('run','E1','{}',1),('run','E2','{}',1)").execute(&pool).await.unwrap();
    let event = || AgentEventInput { event_id: "delivery".into(), event_type: "tool_call_output".into(), payload: serde_json::json!({"server":"knowledge","output":{"results":[{"evidenceId":"E1"}]}}).to_string(), created_at: 1 };
    assert!(agent_commit_model_step_on_pool(&pool, "run", "conv", vec![event(), event()]).await.is_err());
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT delivered FROM agent_delivered_evidence WHERE evidence_id = 'E1'").fetch_one(&pool).await.unwrap(), 0);
    agent_commit_model_step_on_pool(&pool, "run", "conv", vec![event()]).await.unwrap();
    let rows: Vec<i64> = sqlx::query_scalar("SELECT delivered FROM agent_delivered_evidence ORDER BY evidence_id").fetch_all(&pool).await.unwrap();
    assert_eq!(rows, vec![1, 0]);
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
  async fn concurrent_model_steps_do_not_fail_with_busy_snapshot() {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
    use std::sync::Arc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    let path = std::env::temp_dir().join(format!("chatless-events-{}-{}.sqlite",
      std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    let options = SqliteConnectOptions::new().filename(&path).create_if_missing(true)
      .journal_mode(SqliteJournalMode::Wal).busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new().max_connections(8).connect_with(options).await.unwrap();
    sqlx::query("CREATE TABLE agent_run_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(run_id, seq))")
      .execute(&pool).await.unwrap();
    let barrier = Arc::new(tokio::sync::Barrier::new(32));
    let mut tasks = Vec::new();
    for index in 0..32 {
      let pool = pool.clone();
      let barrier = barrier.clone();
      tasks.push(tokio::spawn(async move {
        barrier.wait().await;
        agent_commit_model_step_on_pool(&pool, "run", "conv", vec![AgentEventInput {
          event_id: format!("event-{index}"), event_type: "tool_call_requested".into(),
          payload: "{}".into(), created_at: index,
        }]).await
      }));
    }
    let mut failures = Vec::new();
    for task in tasks {
      if let Err(error) = task.await.unwrap() { failures.push(error); }
    }
    let seqs = sqlx::query_scalar::<_, i64>("SELECT seq FROM agent_run_events ORDER BY seq")
      .fetch_all(&pool).await.unwrap();
    pool.close().await;
    let _ = std::fs::remove_file(path);
    assert!(failures.is_empty(), "Concurrent event commits failed: {failures:?}");
    assert_eq!(seqs, (1..=32).collect::<Vec<i64>>());
  }

  #[tokio::test]
  async fn publication_commits_metadata_and_semantic_job_together() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_with_metadata(&pool, "doc", "b1", Some("hash"), "t1", 0,
      vec![chunk("c1", "source")], 1, Some(DocumentIndexMetadata { file_hash: Some("new-hash".into()),
        parser_version: Some("parser".into()), chunk_schema_version: Some("schema".into()), semantic_parent_task_id: None })).await.unwrap();
    let row = sqlx::query("SELECT file_hash, parser_version, index_version FROM documents WHERE id = 'doc'").fetch_one(&pool).await.unwrap();
    assert_eq!(row.get::<String, _>("file_hash"), "new-hash");
    assert_eq!(row.get::<String, _>("parser_version"), "parser");
    assert_eq!(row.get::<i64, _>("index_version"), 1);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE document_id = 'doc' AND document_version = 1 AND task_type = 'semantic' AND status = 'pending'").fetch_one(&pool).await.unwrap(), 1);
  }

  #[tokio::test]
  async fn a_model_change_invalidates_old_writers_and_queues_the_new_model() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "source")], 1).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "model-a", 2).await.unwrap();
    let old = sqlx::query_scalar::<_, String>("SELECT id FROM document_index_tasks WHERE embedding_fingerprint = 'model-a' AND status = 'pending'").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'running' WHERE id = ?").bind(&old).execute(&pool).await.unwrap();
    assert!(claim_semantic_model_on_pool(&pool, &old, "model-a").await.unwrap());
    prepare_semantic_indexing_on_pool(&pool, "model-b", 3).await.unwrap();
    assert!(store_embeddings_on_pool(&pool, old, "doc".into(), "b1".into(), 1, "model-a".into(),
      vec![ChunkEmbeddingInput { chunk_id: "c1".into(), embedding: vec![1.0, 0.0] }], 4, true, true).await.is_err());
    let new = sqlx::query_scalar::<_, String>("SELECT id FROM document_index_tasks WHERE embedding_fingerprint = 'model-b' AND status = 'pending'").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'running' WHERE id = ?").bind(&new).execute(&pool).await.unwrap();
    assert!(claim_semantic_model_on_pool(&pool, &new, "model-b").await.unwrap());
    store_embeddings_on_pool(&pool, new, "doc".into(), "b1".into(), 1, "model-b".into(),
      vec![ChunkEmbeddingInput { chunk_id: "c1".into(), embedding: vec![0.0, 1.0] }], 5, true, true).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT embedding_fingerprint FROM documents WHERE id = 'doc'").fetch_one(&pool).await.unwrap(), "model-b");
  }

  #[tokio::test]
  async fn model_refresh_preserves_cancellation_until_an_actual_model_change() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "source")], 1).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "a", 2).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'cancelled' WHERE embedding_fingerprint = 'a'").execute(&pool).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "a", 3).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE task_type = 'semantic' AND status = 'pending'").fetch_one(&pool).await.unwrap(), 0);
    prepare_semantic_indexing_on_pool(&pool, "b", 4).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE embedding_fingerprint = 'b' AND status = 'pending'").fetch_one(&pool).await.unwrap(), 1);
  }

  #[tokio::test]
  async fn unavailable_models_reconcile_completed_history_without_reviving_cancellation() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "source")], 1).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "a", 2).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'failed' WHERE embedding_fingerprint = 'a'").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO document_index_tasks (id,document_id,document_version,task_type,status,embedding_fingerprint,created_at,updated_at) VALUES ('recovered','doc',1,'semantic','completed','a',3,3)").execute(&pool).await.unwrap();
    sqlx::query("UPDATE documents SET semantic_status = 'ready', embedding_fingerprint = 'a'").execute(&pool).await.unwrap();
    prepare_semantic_unavailable_on_pool(&pool, 4).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT semantic_status FROM documents").fetch_one(&pool).await.unwrap(), "waiting_model");
    prepare_semantic_indexing_on_pool(&pool, "a", 5).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE status = 'pending' AND embedding_fingerprint = 'a'").fetch_one(&pool).await.unwrap(), 1);
    sqlx::query("UPDATE document_index_tasks SET status = 'cancelled' WHERE status = 'pending'").execute(&pool).await.unwrap();
    prepare_semantic_unavailable_on_pool(&pool, 6).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE status IN ('pending','running','waiting_model')").fetch_one(&pool).await.unwrap(), 0);
  }

  #[tokio::test]
  async fn cancelling_an_unclaimed_job_survives_model_startup() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "source")], 1).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'cancelled' WHERE task_type = 'semantic'").execute(&pool).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "a", 2).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE task_type = 'semantic' AND status IN ('pending','running','waiting_model')").fetch_one(&pool).await.unwrap(), 0);
  }

  #[tokio::test]
  async fn cancelled_semantic_adaptation_cannot_publish_a_new_lexical_batch() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "source")], 1).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "a", 2).await.unwrap();
    let parent: String = sqlx::query_scalar("SELECT id FROM document_index_tasks WHERE task_type = 'semantic' AND status = 'pending'").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'running' WHERE id = ?").bind(&parent).execute(&pool).await.unwrap();
    assert!(claim_semantic_model_on_pool(&pool, &parent, "a").await.unwrap());
    lexical_task(&pool, "t2", 1).await;
    sqlx::query("UPDATE document_index_tasks SET status = 'cancelled' WHERE id = ?").bind(&parent).execute(&pool).await.unwrap();
    let metadata: DocumentIndexMetadata = serde_json::from_value(serde_json::json!({"semanticParentTaskId": parent})).unwrap();
    let result = publish_document_batch_with_metadata(&pool, "doc", "b2", None, "t2", 1, vec![chunk("c2", "adapted")], 3, Some(metadata)).await;
    assert!(result.is_err(), "a cancelled semantic parent must prevent its adaptation from publishing");
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT active_index_batch_id FROM documents").fetch_one(&pool).await.unwrap(), "b1");
  }

  #[tokio::test]
  async fn live_semantic_adaptation_supersedes_its_parent_atomically() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "source")], 1).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "a", 2).await.unwrap();
    let parent: String = sqlx::query_scalar("SELECT id FROM document_index_tasks WHERE task_type = 'semantic' AND status = 'pending'").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'running' WHERE id = ?").bind(&parent).execute(&pool).await.unwrap();
    assert!(claim_semantic_model_on_pool(&pool, &parent, "a").await.unwrap());
    lexical_task(&pool, "t2", 1).await;
    let metadata: DocumentIndexMetadata = serde_json::from_value(serde_json::json!({"semanticParentTaskId": parent.clone()})).unwrap();
    publish_document_batch_with_metadata(&pool, "doc", "b2", None, "t2", 1, vec![chunk("c2", "adapted")], 3, Some(metadata)).await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT active_index_batch_id FROM documents").fetch_one(&pool).await.unwrap(), "b2");
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT error FROM document_index_tasks WHERE id = ? AND status = 'cancelled'").bind(parent).fetch_one(&pool).await.unwrap(), "INDEX_REPLACED");
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_index_tasks WHERE task_type = 'semantic' AND document_version = 2 AND status = 'pending'").fetch_one(&pool).await.unwrap(), 1);
  }

  #[tokio::test]
  async fn semantic_ready_requires_complete_vector_coverage() {
    let pool = test_pool().await;
    lexical_task(&pool, "t1", 0).await;
    let mut next = chunk("c2", "second"); next.chunk_index = 1;
    publish_document_batch_on_pool(&pool, "doc", "b1", None, "t1", 0, vec![chunk("c1", "first"), next], 1).await.unwrap();
    prepare_semantic_indexing_on_pool(&pool, "model", 2).await.unwrap();
    let task = sqlx::query_scalar::<_, String>("SELECT id FROM document_index_tasks WHERE embedding_fingerprint = 'model' AND status = 'pending'").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE document_index_tasks SET status = 'running' WHERE id = ?").bind(&task).execute(&pool).await.unwrap();
    assert!(claim_semantic_model_on_pool(&pool, &task, "model").await.unwrap());
    let error = store_embeddings_on_pool(&pool, task, "doc".into(), "b1".into(), 1, "model".into(),
      vec![ChunkEmbeddingInput { chunk_id: "c1".into(), embedding: vec![1.0, 0.0] }], 3, true, true).await.unwrap_err();
    assert!(error.contains("complete document"));
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM document_chunk_embeddings").fetch_one(&pool).await.unwrap(), 0);
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
