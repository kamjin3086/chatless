//! Acceptance benchmark for lexical retrieval on a 50,000-chunk corpus.
//!
//! The corpus is written to a file-backed SQLite database so the measurement
//! includes real index IO, then queried with the production statement shape:
//! FTS5 MATCH, bm25 ordering, the active-batch join, and the scope filter.
//!
//! Run: cargo test --lib lexical_query_latency_on_50k_chunks -- --ignored --nocapture

use crate::document_structured::tokenize_for_fts;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};
use std::time::Instant;

const CHUNK_TARGET: usize = 50_000;
const CHUNKS_PER_DOCUMENT: usize = 200;
const TOP_K: i64 = 30;

const SCHEMA: &[&str] = &[
    "PRAGMA journal_mode=WAL",
    "CREATE TABLE documents(id TEXT PRIMARY KEY, active_index_batch_id TEXT, index_version INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE document_chunks(id TEXT PRIMARY KEY, document_id TEXT NOT NULL, batch_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, source_text TEXT NOT NULL, search_text TEXT NOT NULL, locator TEXT NOT NULL DEFAULT '{}', metadata TEXT NOT NULL DEFAULT '{}')",
    "CREATE VIRTUAL TABLE document_chunks_fts USING fts5(chunk_id UNINDEXED, search_text)",
    "CREATE TABLE doc_knowledge_mappings(document_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL)",
];

const CN_TOPICS: &[&str] = &[
    "主轴温升", "冷却回路", "过载保护", "熔断器更换", "折旧计提", "巡检记录",
    "编码器屏蔽", "低压报警", "保养周期", "备件库存", "线缆整改", "扭矩校验",
];

const EN_TOPICS: &[&str] = &[
    "spindle alarm", "coolant pressure", "encoder shield", "brake resistor",
    "response target", "lockout tagout", "alarm export", "spare kit",
    "deceleration ramp", "consumable filter", "torque value", "shift handover",
];

fn queries() -> Vec<String> {
    let mut queries: Vec<String> = Vec::new();
    for topic in ["主轴温升", "冷却回路 压力", "熔断器更换", "折旧计提", "过载", "熔断", "折旧"] {
        queries.push(topic.to_string());
    }
    for code in ["E-1042", "E-2500", "E-3777", "E-1999"] {
        queries.push(code.to_string());
    }
    for topic in ["spindle alarm", "coolant pressure", "lockout tagout", "encoder shield"] {
        queries.push(topic.to_string());
    }
    queries.push("编码器屏蔽 E-1042".to_string());
    queries.push("spindle alarm HX-420".to_string());
    queries.push("保养周期 牛米".to_string());
    queries.push("低压报警 E-2207".to_string());
    queries
}

async fn build_pool(database_url: &str) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .expect("open benchmark database");
    for statement in SCHEMA {
        sqlx::query(statement).execute(&pool).await.expect(statement);
    }

    let documents = CHUNK_TARGET / CHUNKS_PER_DOCUMENT;
    let mut tx = pool.begin().await.expect("begin bulk load");
    for document in 0..documents {
        let document_id = format!("perf-doc-{document:04}");
        let batch_id = format!("{document_id}-b1");
        sqlx::query("INSERT INTO documents(id, active_index_batch_id) VALUES (?, ?)")
            .bind(&document_id).bind(&batch_id).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO doc_knowledge_mappings VALUES (?, 'kb-perf')")
            .bind(&document_id).execute(&mut *tx).await.unwrap();
        for index in 0..CHUNKS_PER_DOCUMENT {
            let cn = CN_TOPICS[(document + index) % CN_TOPICS.len()];
            let en = EN_TOPICS[(document * 3 + index) % EN_TOPICS.len()];
            let code = format!("E-{}", 1000 + ((document * CHUNKS_PER_DOCUMENT + index) % 4000));
            let chunk_id = format!("{document_id}-c{index:03}");
            let source_text = format!(
                "{cn} 与 {en}。参考 {code}，设备编号 HX-{}，第 {index} 段记录扭矩 {} 牛米。",
                400 + (index % 60),
                80 + (index % 40)
            );
            let fts_text = tokenize_for_fts(&source_text);
            sqlx::query("INSERT INTO document_chunks VALUES (?, ?, ?, ?, ?, ?, '{}', '{}')")
                .bind(&chunk_id).bind(&document_id).bind(&batch_id).bind(index as i64)
                .bind(&source_text).bind(&source_text).execute(&mut *tx).await.unwrap();
            sqlx::query("INSERT INTO document_chunks_fts VALUES (?, ?)")
                .bind(&chunk_id).bind(&fts_text).execute(&mut *tx).await.unwrap();
        }
    }
    tx.commit().await.expect("commit bulk load");
    pool
}

/// Exact-but-slower shape: the scope predicate runs inside the ranked query, so
/// SQLite scores every match. Used as the fallback when the candidate window is
/// dominated by out-of-scope documents.
fn scoped_sql() -> &'static str {
    "SELECT dc.id, dc.source_text, dc.document_id, bm25(document_chunks_fts) AS rank
       FROM document_chunks_fts
       JOIN document_chunks dc ON dc.id = document_chunks_fts.chunk_id
       JOIN documents d ON d.id = dc.document_id AND d.active_index_batch_id = dc.batch_id
      WHERE document_chunks_fts MATCH ?
        AND (EXISTS (SELECT 1 FROM doc_knowledge_mappings m
                      WHERE m.document_id = dc.document_id AND m.knowledge_base_id IN (?)))
      ORDER BY rank LIMIT ?"
}

fn match_query(tokenized: &str) -> String {
    let tokens: Vec<String> = tokenized
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect();
    if tokens.len() <= 1 {
        tokens.first().cloned().unwrap_or_default()
    } else {
        format!("({})", tokens.join(" OR "))
    }
}

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * fraction).round() as usize;
    sorted[index]
}

/// Production shape: let FTS5 rank its own rows with a top-N priority queue,
/// then apply the document scope outside and over-fetch to avoid starvation.
fn fast_sql() -> &'static str {
    "SELECT dc.id, dc.source_text, dc.document_id, f.rank
       FROM (SELECT chunk_id, bm25(document_chunks_fts) AS rank
               FROM document_chunks_fts
              WHERE document_chunks_fts MATCH ?
              ORDER BY rank LIMIT ?) f
       JOIN document_chunks dc ON dc.id = f.chunk_id
       JOIN documents d ON d.id = dc.document_id AND d.active_index_batch_id = dc.batch_id
      WHERE EXISTS (SELECT 1 FROM doc_knowledge_mappings m
                     WHERE m.document_id = dc.document_id AND m.knowledge_base_id IN (?))
      ORDER BY f.rank LIMIT ?"
}

async fn measure_production(pool: &SqlitePool) -> (Vec<f64>, usize) {
    let mut samples = Vec::new();
    let mut fallbacks = 0usize;
    for _ in 0..3 {
        for query in queries() {
            let statement = match_query(&tokenize_for_fts(&query));
            let started = Instant::now();
            let window = TOP_K * 8;
            let fast = sqlx::query(fast_sql())
                .bind(&statement).bind(window).bind("kb-perf").bind(TOP_K)
                .fetch_all(pool).await.expect("candidate-shape query");
            if (fast.len() as i64) < TOP_K {
                // Mirror the retriever: only the starved case pays for the
                // scope-inside-ranking query, which is exact.
                fallbacks += 1;
                let _ = sqlx::query(scoped_sql())
                    .bind(&statement).bind("kb-perf").bind(TOP_K)
                    .fetch_all(pool).await.expect("scoped fallback query");
            }
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    samples.sort_by(|a, b| a.total_cmp(b));
    (samples, fallbacks)
}

async fn measure_scoped_only(pool: &SqlitePool) -> Vec<f64> {
    let mut samples = Vec::new();
    for _ in 0..3 {
        for query in queries() {
            let statement = match_query(&tokenize_for_fts(&query));
            let started = Instant::now();
            let _ = sqlx::query(scoped_sql())
                .bind(&statement).bind("kb-perf").bind(TOP_K)
                .fetch_all(pool).await.expect("scoped query");
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    samples.sort_by(|a, b| a.total_cmp(b));
    samples
}

#[tokio::test]
#[ignore]
async fn lexical_query_latency_on_50k_chunks() {
    let directory = std::env::temp_dir().join("chatless-retrieval-bench");
    std::fs::create_dir_all(&directory).expect("create bench directory");
    let path = directory.join("perf.sqlite");
    // WAL sidecar files must go too, otherwise a stale log is replayed into the
    // freshly created database.
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.to_string_lossy()));
    }
    let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy().replace('\\', "/"));

    let build_started = Instant::now();
    let pool = build_pool(&url).await;
    let build_seconds = build_started.elapsed().as_secs_f64();
    let rows: i64 = sqlx::query("SELECT COUNT(*) AS n FROM document_chunks")
        .fetch_one(&pool).await.unwrap().get("n");
    let size_mb = std::fs::metadata(&path).map(|m| m.len() as f64 / 1_048_576.0).unwrap_or(0.0);

    let warmup = match_query(&tokenize_for_fts("主轴温升"));
    let _ = sqlx::query(fast_sql()).bind(&warmup).bind(TOP_K * 8).bind("kb-perf").bind(TOP_K)
        .fetch_all(&pool).await.expect("warmup query");

    let (samples, fallbacks) = measure_production(&pool).await;
    let scoped = measure_scoped_only(&pool).await;

    println!(
        "config: {rows} chunks, topK={TOP_K}, db={size_mb:.1} MiB, build={build_seconds:.1}s, queries={}",
        samples.len()
    );
    println!(
        "production end-to-end ms: p50={:.1} p95={:.1} max={:.1} mean={:.1} (fallbacks {fallbacks}/{})",
        percentile(&samples, 0.5),
        percentile(&samples, 0.95),
        samples.last().copied().unwrap_or(0.0),
        samples.iter().sum::<f64>() / samples.len() as f64,
        samples.len()
    );
    println!(
        "scope-in-ranking ms: p50={:.1} p95={:.1} max={:.1} mean={:.1} (previous shape, for the record)",
        percentile(&scoped, 0.5),
        percentile(&scoped, 0.95),
        scoped.last().copied().unwrap_or(0.0),
        scoped.iter().sum::<f64>() / scoped.len() as f64
    );

    assert!(
        percentile(&samples, 0.95) <= 500.0,
        "lexical P95 exceeded the 500ms acceptance target: {:.1}ms",
        percentile(&samples, 0.95)
    );
}
