//! Dense retrieval acceptance benchmark.
//!
//! The corpus is written to a file-backed SQLite database using the production
//! column layout, then queried through the production dense scan (scope filter,
//! active-batch join, fingerprint match, top-K maintained in Rust).  Vectors are
//! deterministic, so this measures scan cost and correctness of the ordering,
//! not semantic quality of a model.
//!
//! Run in release so the measured dot products match a production build:
//!   $env:CHATLESS_DENSE_BENCH_OUT="docs/acceptance/dense-bench-report.json"
//!   cargo test --release --lib dense_scan_latency_on_50k_vectors -- --ignored --nocapture

use crate::agent_runtime::{cancel_dense_search, dense_scan};
use crate::onnx_logic::{embed_with_session, tokenize_batch_core, EmbeddingInput};
use ort::session::Session;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const CHUNK_TARGET: usize = 50_000;
const CHUNKS_PER_DOCUMENT: usize = 200;
const TOP_K: usize = 30;
const QUERY_COUNT: usize = 50;
const TARGET_P95_MS: f64 = 2_000.0;
const FINGERPRINT_PREFIX: &str = "bench-fp";

const SCHEMA: &[&str] = &[
    "PRAGMA journal_mode=WAL",
    "CREATE TABLE documents(id TEXT PRIMARY KEY, file_hash TEXT, active_index_batch_id TEXT, index_version INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE document_chunks(id TEXT PRIMARY KEY, document_id TEXT NOT NULL, batch_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, source_text TEXT NOT NULL, search_text TEXT NOT NULL, locator TEXT NOT NULL DEFAULT '{}', metadata TEXT NOT NULL DEFAULT '{}')",
    "CREATE TABLE document_chunk_embeddings(chunk_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, fingerprint TEXT NOT NULL, dimension INTEGER NOT NULL, embedding BLOB NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE doc_knowledge_mappings(document_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL)",
];

fn dimension() -> usize {
    std::env::var("CHATLESS_DENSE_DIM")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value >= 8)
        .unwrap_or(384)
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn normalize(values: &mut [f32]) {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in values.iter_mut() {
            *value /= norm;
        }
    }
}

/// Deterministic unit vector, so a query can be built without reading the row
/// back and the expected top hit is known ahead of time.
fn unit_vector(seed: u64, dimension: usize) -> Vec<f32> {
    let mut state = seed
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    let mut values = Vec::with_capacity(dimension);
    for _ in 0..dimension {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let unit = ((state >> 11) as f64) / ((1u64 << 53) as f64);
        values.push((unit * 2.0 - 1.0) as f32);
    }
    normalize(&mut values);
    values
}

fn bytes_of(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn to_mib(bytes: u64) -> f64 {
    bytes as f64 / 1_048_576.0
}

/// Peak working set of the test process.  Only used for the report; the scan
/// itself streams rows and keeps just the top K hits in memory.
#[cfg(target_os = "windows")]
fn peak_working_set_mib() -> Option<f64> {
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size).ok()?;
        Some(to_mib(counters.PeakWorkingSetSize as u64))
    }
}

#[cfg(not(target_os = "windows"))]
fn peak_working_set_mib() -> Option<f64> {
    None
}

async fn build_pool(database_url: &str, dimension: usize) -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .expect("open dense benchmark database");
    for statement in SCHEMA {
        sqlx::query(statement).execute(&pool).await.expect(statement);
    }

    let fingerprint = format!("{FINGERPRINT_PREFIX}-{dimension}");
    let documents = CHUNK_TARGET / CHUNKS_PER_DOCUMENT;
    let mut tx = pool.begin().await.expect("begin bulk load");
    for document in 0..documents {
        let document_id = format!("perf-doc-{document:04}");
        let batch_id = format!("{document_id}-b1");
        sqlx::query("INSERT INTO documents(id, file_hash, active_index_batch_id) VALUES (?, ?, ?)")
            .bind(&document_id)
            .bind(format!("hash-{document}"))
            .bind(&batch_id)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("INSERT INTO doc_knowledge_mappings VALUES (?, 'kb-perf')")
            .bind(&document_id)
            .execute(&mut *tx)
            .await
            .unwrap();
        for index in 0..CHUNKS_PER_DOCUMENT {
            let chunk_id = format!("{document_id}-c{index:03}");
            let source_text = format!("dense benchmark chunk {document}-{index}");
            let vector = unit_vector((document * CHUNKS_PER_DOCUMENT + index) as u64 + 1, dimension);
            sqlx::query("INSERT INTO document_chunks VALUES (?, ?, ?, ?, ?, ?, '{}', '{}')")
                .bind(&chunk_id)
                .bind(&document_id)
                .bind(&batch_id)
                .bind(index as i64)
                .bind(&source_text)
                .bind(&source_text)
                .execute(&mut *tx)
                .await
                .unwrap();
            sqlx::query("INSERT INTO document_chunk_embeddings VALUES (?, ?, ?, ?, ?, 0)")
                .bind(&chunk_id)
                .bind(&batch_id)
                .bind(&fingerprint)
                .bind(dimension as i64)
                .bind(bytes_of(&vector))
                .execute(&mut *tx)
                .await
                .unwrap();
        }
    }
    tx.commit().await.expect("commit bulk load");
    pool
}

/// Every document in the corpus, so the scan walks all 50k compatible vectors.
fn all_document_ids() -> Vec<String> {
    (0..CHUNK_TARGET / CHUNKS_PER_DOCUMENT)
        .map(|document| format!("perf-doc-{document:04}"))
        .collect()
}

/// A query whose nearest neighbour is the chunk it was derived from, plus a
/// small deterministic perturbation so the comparison is not an identity.
fn query_for(chunk_index: usize, dimension: usize) -> (String, Vec<f32>) {
    let document = chunk_index / CHUNKS_PER_DOCUMENT;
    let index = chunk_index % CHUNKS_PER_DOCUMENT;
    let mut values = unit_vector(chunk_index as u64 + 1, dimension);
    let noise = unit_vector(chunk_index as u64 + 7_000_003, dimension);
    for (value, jitter) in values.iter_mut().zip(noise.iter()) {
        *value += 0.02 * jitter;
    }
    normalize(&mut values);
    (format!("perf-doc-{document:04}-c{index:03}"), values)
}

fn percentile(samples: &[f64], quantile: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let index = ((sorted.len() - 1) as f64 * quantile).ceil() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn write_report(report: &serde_json::Value) {
    let Ok(path) = std::env::var("CHATLESS_DENSE_BENCH_OUT") else { return };
    if path.trim().is_empty() {
        return;
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&path, format!("{report}\n")) {
        Ok(()) => println!("report written: {path}"),
        Err(error) => println!("report write failed: {error}"),
    }
}

#[tokio::test]
#[ignore]
async fn dense_scan_latency_on_50k_vectors() {
    let dimension = dimension();
    let fingerprint = format!("{FINGERPRINT_PREFIX}-{dimension}");
    let directory = std::env::temp_dir().join("chatless-dense-bench");
    std::fs::create_dir_all(&directory).expect("create bench directory");
    let path = directory.join(format!("dense-{dimension}.sqlite"));
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.to_string_lossy()));
    }
    let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy().replace('\\', "/"));

    let build_started = Instant::now();
    let pool = build_pool(&url, dimension).await;
    let build_seconds = build_started.elapsed().as_secs_f64();
    let rows: i64 = sqlx::query("SELECT COUNT(*) AS n FROM document_chunk_embeddings")
        .fetch_one(&pool).await.unwrap().get("n");
    let db_mib = std::fs::metadata(&path).map(|m| to_mib(m.len())).unwrap_or(0.0);

    let document_ids = all_document_ids();
    let request_id = "dense-bench";

    // Warm up the pool and the query plan before measuring.
    let (_, warmup) = query_for(0, dimension);
    let _ = dense_scan(&pool, request_id, &warmup, &document_ids, &fingerprint, TOP_K)
        .await
        .expect("warmup dense scan");

    let mut samples: Vec<f64> = Vec::with_capacity(QUERY_COUNT);
    let mut correct = 0usize;
    for query_index in 0..QUERY_COUNT {
        // Spread queries across the corpus so hits are not clustered.
        let chunk_index = query_index * (CHUNK_TARGET / QUERY_COUNT);
        let (expected_chunk, query) = query_for(chunk_index, dimension);
        let started = Instant::now();
        let hits = dense_scan(&pool, request_id, &query, &document_ids, &fingerprint, TOP_K)
            .await
            .expect("dense scan");
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        if hits.first().is_some_and(|hit| hit.chunk_id == expected_chunk) {
            correct += 1;
        }
    }

    // Cancellation: a request cancelled before the scan must not return hits.
    let (_, cancelled_query) = query_for(7, dimension);
    cancel_dense_search("dense-bench-cancelled".to_string());
    let cancelled = dense_scan(&pool, "dense-bench-cancelled", &cancelled_query, &document_ids, &fingerprint, TOP_K)
        .await;
    let cancel_observed = matches!(&cancelled, Err(message) if message.contains("CANCELLED"));

    let p50 = percentile(&samples, 0.5);
    let p95 = percentile(&samples, 0.95);
    let max = samples.iter().copied().fold(0.0f64, f64::max);
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let peak = peak_working_set_mib();

    println!(
        "config: {rows} vectors, dimension={dimension}, topK={TOP_K}, db={db_mib:.1} MiB, build={build_seconds:.1}s, queries={}",
        samples.len()
    );
    println!(
        "dense scan ms: p50={p50:.1} p95={p95:.1} max={max:.1} mean={mean:.1} (top-1 correct {correct}/{})",
        samples.len()
    );
    println!(
        "peak working set: {}",
        peak.map(|value| format!("{value:.1} MiB")).unwrap_or_else(|| "unavailable".to_string())
    );
    println!("cancellation observed before scan: {cancel_observed}");

    let report = serde_json::json!({
        "generatedAtMs": now_ms(),
        "vectorCount": rows,
        "dimension": dimension,
        "topK": TOP_K,
        "queryCount": samples.len(),
        "databaseMib": db_mib,
        "buildSeconds": build_seconds,
        "scanP50Ms": p50,
        "scanP95Ms": p95,
        "scanMaxMs": max,
        "scanMeanMs": mean,
        "top1Correct": correct,
        "peakWorkingSetMib": peak,
        "cancelObserved": cancel_observed,
        "vectorsAreDeterministic": true,
    });
    write_report(&report);

    assert_eq!(correct, samples.len(), "dense scan did not return the expected nearest chunk");
    assert!(cancel_observed, "a cancelled dense scan returned hits");
    assert!(
        p95 <= TARGET_P95_MS,
        "dense scan P95 exceeded the 2000ms acceptance target: {p95:.1}ms"
    );
}

/// Small-corpus check of the real local embedding path: production
/// tokenisation rules plus the production ONNX mean-pooling session, then the
/// production dense scan over the stored vectors.
///
/// Run:
///   $env:CHATLESS_ONNX_MODEL="$env:TEMP\chatless-onnx-acceptance\all-minilm\model.onnx"
///   $env:CHATLESS_ONNX_TOKENIZER="$env:TEMP\chatless-onnx-acceptance\all-minilm\tokenizer.json"
///   $env:CHATLESS_ONNX_LABEL="all-minilm-l6-v2"
///   cargo test --release --lib semantic_recall_with_local_onnx_model -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn semantic_recall_with_local_onnx_model() {
    let (model_path, tokenizer_path) = match (
        std::env::var("CHATLESS_ONNX_MODEL"),
        std::env::var("CHATLESS_ONNX_TOKENIZER"),
    ) {
        (Ok(model), Ok(tokenizer)) => (model, tokenizer),
        _ => {
            println!("skipped: set CHATLESS_ONNX_MODEL and CHATLESS_ONNX_TOKENIZER to run this check");
            return;
        }
    };
    let label = std::env::var("CHATLESS_ONNX_LABEL").unwrap_or_else(|_| "local-model".to_string());
    let max_length = std::env::var("CHATLESS_ONNX_MAX_LENGTH")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(256);

    // Corpus and queries.  A pair asserts only the ordering the embedding must
    // support: the labelled chunk outranks a chunk with unrelated meaning.
    let corpus: Vec<&str> = vec![
        "The backup window for the production database is every Sunday from 02:00 to 04:00.",
        "Spare parts for the spindle assembly are stored in cabinet B4 on the second floor.",
        "冷却回路压力低于 2.5 bar 时先排气，再检查循环泵是否空转。",
        "主轴温升报警阈值是 75 摄氏度，超过后必须在十分钟内降速。",
        "Error code E-1042 means the encoder shield cable is broken.",
        "扭矩校验使用 80 牛米的扳手，并在保养记录中登记。",
        "The deceleration ramp for the conveyor must stay under 1.5 seconds.",
        "巡检记录每天由值班工程师填写，并在一周内归档。",
        "Lockout tagout procedures require two people before servicing the drive.",
        "备件库存低于十件时触发补货提醒。",
        "The alarm export runs nightly and uploads a CSV to the operations share.",
        "低压报警 E-2207 通常由进线电压不稳引起。",
    ];
    let pairs: Vec<(&str, usize, usize, &str)> = vec![
        // query, expected chunk, unrelated chunk, query language
        ("When does the nightly backup run?", 0, 4, "en"),
        ("Where do we keep spindle spare parts?", 1, 9, "en"),
        ("冷却回路压力不足怎么处理", 2, 7, "zh"),
        ("主轴温升超过阈值怎么办", 3, 11, "zh"),
        ("what does E-1042 indicate", 4, 2, "en"),
        ("低压报警的常见原因", 11, 5, "zh"),
    ];
    // A small local model is trained for one language family, so the corpus
    // pairs carry a language and only the matching ones are required to rank
    // first.  The others are measured and reported: they are the evidence for
    // which model a given library should configure.
    let model_language = std::env::var("CHATLESS_ONNX_LANG").unwrap_or_else(|_| {
        if label.to_lowercase().contains("zh") { "zh".to_string() } else { "en".to_string() }
    });

    let mut session = Session::builder()
        .expect("session builder")
        .commit_from_file(&model_path)
        .unwrap_or_else(|error| panic!("load model {model_path}: {error}"));

    let embed = |session: &mut Session, texts: &[String]| -> Result<Vec<Vec<f32>>, String> {
        let tokenized = tokenize_batch_core(texts.to_vec(), &tokenizer_path, max_length)?;
        embed_with_session(
            session,
            EmbeddingInput {
                input_ids: tokenized.input_ids.iter().map(|row| row.iter().map(|v| *v as i64).collect()).collect(),
                attention_mask: tokenized.attention_mask.iter().map(|row| row.iter().map(|v| *v as i64).collect()).collect(),
                token_type_ids: tokenized.token_type_ids.iter().map(|row| row.iter().map(|v| *v as i64).collect()).collect(),
            },
        )
    };

    let corpus_texts: Vec<String> = corpus.iter().map(|text| text.to_string()).collect();
    let corpus_vectors = embed(&mut session, &corpus_texts).expect("embed corpus");
    let dimension = corpus_vectors[0].len();
    assert_eq!(corpus_vectors.len(), corpus.len());
    assert!(dimension >= 64, "unexpected embedding dimension {dimension}");
    // Non-degenerate vectors: identical text must have (near) identical vectors.
    let repeat = embed(&mut session, &[corpus_texts[0].clone()]).expect("embed repeat");
    let self_cosine = cosine(&corpus_vectors[0], &repeat[0]);
    // Quantised int8 exports are slightly batch-dependent, so this is a
    // sanity bound rather than an exact-reproducibility claim.
    assert!(self_cosine > 0.99, "identical text produced cosine {self_cosine}");

    // Store the vectors with the production fingerprint rules.
    let fingerprint = format!("local-onnx-{label}-{dimension}");
    let directory = std::env::temp_dir().join("chatless-onnx-acceptance");
    std::fs::create_dir_all(&directory).expect("create acceptance directory");
    let path = directory.join(format!("{label}.sqlite"));
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.to_string_lossy()));
    }
    let url = format!("sqlite://{}?mode=rwc", path.to_string_lossy().replace('\\', "/"));
    let pool = SqlitePoolOptions::new().max_connections(1).connect(&url).await.expect("open acceptance database");
    for statement in SCHEMA {
        sqlx::query(statement).execute(&pool).await.expect(statement);
    }
    let document_id = "onnx-acceptance-doc";
    let batch_id = "onnx-acceptance-batch";
    sqlx::query("INSERT INTO documents(id, file_hash, active_index_batch_id) VALUES (?, 'acceptance', ?)")
        .bind(document_id).bind(batch_id).execute(&pool).await.unwrap();
    for (index, vector) in corpus_vectors.iter().enumerate() {
        let chunk_id = format!("{document_id}-c{index:03}");
        sqlx::query("INSERT INTO document_chunks VALUES (?, ?, ?, ?, ?, ?, '{}', '{}')")
            .bind(&chunk_id).bind(document_id).bind(batch_id).bind(index as i64)
            .bind(corpus[index]).bind(corpus[index]).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO document_chunk_embeddings VALUES (?, ?, ?, ?, ?, 0)")
            .bind(&chunk_id).bind(batch_id).bind(&fingerprint).bind(dimension as i64)
            .bind(bytes_of(vector)).execute(&pool).await.unwrap();
    }

    let document_ids = vec![document_id.to_string()];
    let mut rows: Vec<serde_json::Value> = Vec::new();
    let mut hits = 0usize;
    let mut in_window = 0usize;
    let mut required_first_failures: Vec<String> = Vec::new();
    for (query, expected, unrelated, language) in &pairs {
        let query_vector = embed(&mut session, &[query.to_string()]).expect("embed query");
        let top = dense_scan(&pool, "onnx-acceptance", &query_vector[0], &document_ids, &fingerprint, 3)
            .await.expect("dense scan over real vectors");
        let ranked: Vec<String> = top.iter().map(|hit| hit.chunk_id.clone()).collect();
        let expected_chunk = format!("{document_id}-c{expected:03}");
        let unrelated_chunk = format!("{document_id}-c{unrelated:03}");
        let expected_score = top.iter().find(|hit| hit.chunk_id == expected_chunk).map(|hit| hit.score);
        let unrelated_score = top.iter().find(|hit| hit.chunk_id == unrelated_chunk).map(|hit| hit.score);
        let ranked_first = top.first().is_some_and(|hit| hit.chunk_id == expected_chunk);
        let ranked_in_window = ranked.iter().any(|id| id == &expected_chunk);
        if ranked_first { hits += 1; }
        if ranked_in_window { in_window += 1; }
        if (*language == model_language) && !ranked_first {
            required_first_failures.push(format!("{query} → {ranked:?}"));
        }
        println!("query: {query}");
        println!("  language={language} expected {expected_chunk} first={ranked_first} ranked={ranked:?}");
        rows.push(serde_json::json!({
            "query": query,
            "language": language,
            "expectedChunk": expected_chunk,
            "expectedRankedFirst": ranked_first,
            "expectedInTop3": ranked_in_window,
            "expectedScore": expected_score,
            "unrelatedScore": unrelated_score,
            "ranked": ranked,
        }));
    }
    println!(
        "self-cosine={self_cosine:.4} dimension={dimension} model-language={model_language} \
         top-1 hits={hits}/{} in-top-3={in_window}/{}",
        pairs.len(), pairs.len()
    );

    let report = serde_json::json!({
        "generatedAtMs": now_ms(),
        "label": label,
        "modelPath": model_path,
        "maxLength": max_length,
        "dimension": dimension,
        "fingerprint": fingerprint,
        "corpusSize": corpus.len(),
        "selfCosine": self_cosine,
        "top1Hits": hits,
        "inTop3": in_window,
        "modelLanguage": model_language,
        "queryCount": pairs.len(),
        "queries": rows,
    });
    write_report(&report);
    assert!(
        required_first_failures.is_empty(),
        "local model retrieval did not meet the labelled expectations: {required_first_failures:?}"
    );
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a > 0.0 && norm_b > 0.0 { dot / (norm_a * norm_b) } else { 0.0 }
}
