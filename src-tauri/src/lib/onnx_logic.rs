use anyhow::Result;
use ndarray::Array2;
use ort::{session::Session, value::Tensor};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::io::Read;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer};

#[derive(Default)]
pub struct OnnxState {
  pub sessions: Mutex<HashMap<String, Arc<OnnxSession>>>,
  view_epochs: Mutex<HashMap<String, ViewEpoch>>,
}

struct ViewEpoch { window: Option<String>, generation: u64 }
pub struct OnnxSession {
  pub session: Mutex<Session>,
  tokenizer: Option<Tokenizer>,
  owner: Option<SessionOwner>,
}
struct SessionOwner { view: String, window: String, generation: u64 }

impl OnnxState {
  fn view_generation(&self, view: &str, window: &str) -> Result<u64, String> {
    let mut epochs = self.view_epochs.lock().map_err(|e| e.to_string())?;
    let epoch = epochs.entry(view.into()).or_insert(ViewEpoch { window: None, generation: 0 });
    if epoch.window.as_deref().is_some_and(|previous| previous != window) { epoch.generation += 1; }
    epoch.window = Some(window.into());
    Ok(epoch.generation)
  }
  pub fn release_view(&self, label: &str) -> Result<(), String> {
    let mut epochs = self.view_epochs.lock().map_err(|e| e.to_string())?;
    let epoch = epochs.entry(label.into()).or_insert(ViewEpoch { window: None, generation: 0 });
    epoch.generation += 1;
    self.sessions.lock().map_err(|e| e.to_string())?.retain(|_, session|
      session.owner.as_ref().map_or(true, |owner| owner.view != label));
    Ok(())
  }
  pub fn release_window(&self, label: &str) -> Result<(), String> {
    let mut epochs = self.view_epochs.lock().map_err(|e| e.to_string())?;
    for epoch in epochs.values_mut() {
      if epoch.window.as_deref() == Some(label) { epoch.generation += 1; }
    }
    self.sessions.lock().map_err(|e| e.to_string())?.retain(|_, session|
      session.owner.as_ref().map_or(true, |owner| owner.window != label));
    Ok(())
  }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnnxSessionInfo { pub session_id: String, pub model_hash: String, pub tokenizer_hash: String }

fn file_hash(path: &str) -> Result<String, String> {
  let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
  let mut hash = Sha256::new();
  let mut buffer = [0u8; 65536];
  loop {
    let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
    if n == 0 { break; }
    hash.update(&buffer[..n]);
  }
  Ok(format!("{:x}", hash.finalize()))
}

// Core implementation
#[derive(serde::Serialize)]
pub struct TokenizationOutput {
  pub input_ids: Vec<Vec<u32>>,
  pub attention_mask: Vec<Vec<u32>>,
  pub token_type_ids: Vec<Vec<u32>>,
}

#[tauri::command]
pub fn tokenize_batch(
  texts: Vec<String>,
  tokenizer_path: String,
  max_length: usize,
  session_id: Option<String>,
  state: State<OnnxState>,
) -> Result<TokenizationOutput, String> {
  if let Some(id) = session_id {
    let model = state.sessions.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("ONNX session is not initialized")?;
    let tokenizer = model.tokenizer.clone().ok_or("Session has no tokenizer")?;
    return tokenize_with_tokenizer(texts, tokenizer, max_length);
  }
  tokenize_batch_core(texts, &tokenizer_path, max_length)
}

#[tauri::command]
pub fn count_embedding_tokens(texts: Vec<String>, tokenizer_path: String, session_id: Option<String>, state: State<OnnxState>) -> Result<Vec<usize>, String> {
  let mut tokenizer = if let Some(id) = session_id {
    state.sessions.lock().map_err(|e| e.to_string())?.get(&id).ok_or("ONNX session is not initialized")?
      .tokenizer.clone().ok_or("Session has no tokenizer")?
  } else { Tokenizer::from_file(&tokenizer_path).map_err(|e| e.to_string())? };
  tokenizer.with_padding(None);
  tokenizer.with_truncation(None).map_err(|e| e.to_string())?;
  Ok(tokenizer.encode_batch(texts, true).map_err(|e| e.to_string())?
    .into_iter().map(|encoding| encoding.len()).collect())
}

/// Production tokenisation rules, callable without Tauri state so the
/// acceptance harness exercises the same length check and padding.
pub fn tokenize_batch_core(
  texts: Vec<String>,
  tokenizer_path: &str,
  max_length: usize,
) -> Result<TokenizationOutput, String> {
  // Load tokenizer file
  let tokenizer = Tokenizer::from_file(tokenizer_path).map_err(|e| format!("Failed to load tokenizer: {e}"))?;
  tokenize_with_tokenizer(texts, tokenizer, max_length)
}

fn tokenize_with_tokenizer(texts: Vec<String>, mut tokenizer: Tokenizer, max_length: usize) -> Result<TokenizationOutput, String> {
  // Validate with the real tokenizer. Silently truncating changes the text
  // represented by a vector while the lexical/citation path keeps the full
  // chunk, which makes retrieval evidence unreliable.
  tokenizer.with_padding(None);
  tokenizer.with_truncation(None).map_err(|e| e.to_string())?;
  let lengths = tokenizer.encode_batch(texts.clone(), true)
    .map_err(|e| format!("Tokenization failed: {e}"))?
    .into_iter().map(|encoding| encoding.len()).collect::<Vec<_>>();
  if let Some((index, length)) = lengths.iter().enumerate().find(|(_, length)| **length > max_length) {
    return Err(format!("EMBEDDING_INPUT_TOO_LONG: input {index} has {length} tokens, exceeding model limit {max_length}; rebuild with smaller chunks"));
  }

  // Configure padding only after every input passed the length check.
  tokenizer
    .with_padding(Some(PaddingParams {
      strategy: PaddingStrategy::BatchLongest,
      pad_to_multiple_of: Some(8),
      ..Default::default()
    }));

  // Encode batch
  let encodings = tokenizer
    .encode_batch(texts, true)
    .map_err(|e| format!("Tokenization failed: {e}"))?;

  let input_ids: Vec<Vec<u32>> = encodings.iter().map(|e| e.get_ids().to_vec()).collect();
  let attention_mask: Vec<Vec<u32>> = encodings
    .iter()
    .map(|e| e.get_attention_mask().to_vec())
    .collect();

  // Generate token_type_ids (all zeros for single text)
  let token_type_ids: Vec<Vec<u32>> = input_ids.iter().map(|ids| vec![0u32; ids.len()]).collect();

  Ok(TokenizationOutput {
    input_ids,
    attention_mask,
    token_type_ids,
  })
}

#[derive(serde::Deserialize, Debug)]
pub struct EmbeddingInput {
  pub input_ids: Vec<Vec<i64>>,
  pub attention_mask: Vec<Vec<i64>>,
  pub token_type_ids: Vec<Vec<i64>>,
}

#[tauri::command]
pub fn get_onnx_view_generation(state: State<OnnxState>, webview: tauri::Webview) -> Result<u64, String> {
  state.view_generation(webview.label(), webview.window().label())
}

#[tauri::command]
pub async fn init_onnx_session(model_path: String, session_id: Option<String>, tokenizer_path: Option<String>,
  expected_generation: Option<u64>, app: AppHandle, webview: tauri::Webview) -> Result<OnnxSessionInfo, String> {
  let view = webview.label().to_string();
  let window = webview.window().label().to_string();
  let generation = app.state::<OnnxState>().view_generation(&view, &window)?;
  if expected_generation.is_some_and(|expected| expected != generation) {
    return Err("ONNX loading was superseded by navigation".into());
  }
  let owner = SessionOwner { view, window, generation };
  // Optional model IO/ORT construction must not block the first screen. The
  // captured navigation generation prevents late loads resurrecting dead views.
  tauri::async_runtime::spawn_blocking(move || {
    initialize_model_owned(&app.state::<OnnxState>(), model_path, session_id, tokenizer_path, Some(owner))
  }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
fn initialize_model(state: &OnnxState, model_path: String, session_id: Option<String>, tokenizer_path: Option<String>) -> Result<OnnxSessionInfo, String> {
  initialize_model_owned(state, model_path, session_id, tokenizer_path, None)
}

fn initialize_model_owned(state: &OnnxState, model_path: String, session_id: Option<String>, tokenizer_path: Option<String>, owner: Option<SessionOwner>) -> Result<OnnxSessionInfo, String> {
  let id = session_id.unwrap_or_else(|| "legacy".into());
  let model_hash = file_hash(&model_path)?;
  let tokenizer_hash = tokenizer_path.as_deref().map(file_hash).transpose()?.unwrap_or_default();
  let session = Session::builder().map_err(|e| e.to_string())?
    .commit_from_file(&model_path).map_err(|e| format!("Failed to load model: {e}"))?;
  let tokenizer = tokenizer_path.as_deref().map(Tokenizer::from_file).transpose().map_err(|e| e.to_string())?;
  // Keep the same lock order as navigation/window cleanup until publication.
  let epochs = state.view_epochs.lock().map_err(|e| e.to_string())?;
  if let Some(owner) = &owner {
    if !epochs.get(&owner.view).is_some_and(|epoch| epoch.generation == owner.generation && epoch.window.as_deref() == Some(owner.window.as_str())) {
      return Err("ONNX loading was superseded by navigation".into());
    }
  }
  let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
  if sessions.contains_key(&id) { return Err("ONNX session handle is already in use".into()); }
  sessions.insert(id.clone(), Arc::new(OnnxSession { session: Mutex::new(session), tokenizer, owner }));
  Ok(OnnxSessionInfo { session_id: id, model_hash, tokenizer_hash })
}

#[tauri::command]
pub async fn generate_embedding(
  input: EmbeddingInput,
  session_id: Option<String>,
  app: AppHandle,
) -> Result<Vec<Vec<f32>>, String> {
  // 将计算密集型任务移动到阻塞线程池
  tauri::async_runtime::spawn_blocking(move || {
    let state = app.state::<OnnxState>();
    let session = state.sessions.lock().map_err(|e| e.to_string())?
      .get(session_id.as_deref().unwrap_or("legacy")).cloned().ok_or("ONNX session is not initialized")?;
    // Releasing a handle cannot drop a session while this inference owns it.
    let mut session = session.session.lock().map_err(|e| e.to_string())?;
    embed_with_session(&mut session, input)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Mean-pooled, mask-weighted sentence embeddings from an initialised session.
/// Shared by the command above and the local-model acceptance harness.
pub fn embed_with_session(
  session: &mut Session,
  input: EmbeddingInput,
) -> Result<Vec<Vec<f32>>, String> {
    // Convert to ndarray
    let batch = input.input_ids.len();
    if batch == 0 {
      return Ok(vec![]);
    }
    let seq_len = input.input_ids[0].len();

    let ids_flat: Vec<i64> = input.input_ids.into_iter().flatten().collect();
    let mask_flat: Vec<i64> = input.attention_mask.into_iter().flatten().collect();
    let token_type_flat: Vec<i64> = input.token_type_ids.into_iter().flatten().collect();

    let mask_array =
      Array2::from_shape_vec((batch, seq_len), mask_flat.clone()).map_err(|e| e.to_string())?;

    // Convert ndarray to Tensor
    let ids_tensor =
      Tensor::<i64>::from_array(([batch, seq_len], ids_flat)).map_err(|e| e.to_string())?;
    let mask_tensor =
      Tensor::<i64>::from_array(([batch, seq_len], mask_flat)).map_err(|e| e.to_string())?;
    let token_type_tensor =
      Tensor::<i64>::from_array(([batch, seq_len], token_type_flat)).map_err(|e| e.to_string())?;

    // Run inference
    let outputs = session
      .run(ort::inputs![
          "input_ids" => &ids_tensor,
          "attention_mask" => &mask_tensor,
          "token_type_ids" => &token_type_tensor
      ])
      .map_err(|e| e.to_string())?;

    // Extract token_embeddings
    // Sentence-transformer exports name this output `token_embeddings`; other
    // BERT-family exports (for example the Chinese BGE export) use
    // `last_hidden_state`.  Both carry the same [batch, seq, hidden] tensor.
    let output = outputs
      .get("token_embeddings")
      .or_else(|| outputs.get("last_hidden_state"))
      .ok_or_else(|| {
        let names: Vec<String> = outputs.keys().map(|name| name.to_string()).collect();
        format!("Unsupported model outputs {names:?}: expected token_embeddings or last_hidden_state")
      })?;
    let hidden_state = output
      .try_extract_array::<f32>()
      .map_err(|e| e.to_string())?;

    let shape = hidden_state.shape();
    if shape.len() != 3 {
      return Err(format!("Unsupported output dimensions: {:?}", shape));
    }
    let hidden_size = shape[2];

    // Mean pooling
    let mut results: Vec<Vec<f32>> = Vec::with_capacity(batch);
    let data = hidden_state.as_slice().ok_or("Cannot get output slice")?;
    let mut idx = 0;

    for b in 0..batch {
      let mut pooled = vec![0.0f32; hidden_size];
      let mut valid_tokens = 0f32;
      for t in 0..seq_len {
        let mask_val = mask_array[(b, t)];
        for h in 0..hidden_size {
          let val = data[idx];
          idx += 1;
          if mask_val == 1 {
            pooled[h] += val;
          }
        }
        if mask_val == 1 {
          valid_tokens += 1.0;
        }
      }
      if valid_tokens > 0.0 {
        for v in pooled.iter_mut() {
          *v /= valid_tokens;
        }
      }
      results.push(pooled);
    }

    Ok(results)
}

#[tauri::command]
pub fn release_onnx_session(session_id: Option<String>, state: State<OnnxState>) -> Result<(), String> {
  release_model(&state, session_id.as_deref().unwrap_or("legacy"))
}

fn release_model(state: &OnnxState, session_id: &str) -> Result<(), String> {
  state.sessions.lock().map_err(|e| e.to_string())?.remove(session_id);
  Ok(())
}

pub fn clear_onnx_sessions(state: State<OnnxState>) -> Result<(), String> {
  let mut epochs = state.view_epochs.lock().map_err(|e| e.to_string())?;
  for epoch in epochs.values_mut() { epoch.generation += 1; }
  state.sessions.lock().map_err(|e| e.to_string())?.clear();
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  #[ignore = "requires real ONNX model files; run with CHATLESS_ONNX_MODEL and CHATLESS_ONNX_TOKENIZER"]
  fn real_model_navigation_cleanup_is_scoped_and_keeps_inflight_owners_alive() {
    let model = std::env::var("CHATLESS_ONNX_MODEL").expect("real model path");
    let tokenizer = std::env::var("CHATLESS_ONNX_TOKENIZER").expect("real tokenizer path");
    let state = OnnxState::default();
    state.view_generation("main", "main").unwrap();
    state.view_generation("other", "other").unwrap();
    initialize_model_owned(&state, model.clone(), Some("main-session".into()), Some(tokenizer.clone()), Some(SessionOwner { view: "main".into(), window: "main".into(), generation: 0 })).unwrap();
    initialize_model_owned(&state, model.clone(), Some("other-session".into()), Some(tokenizer.clone()), Some(SessionOwner { view: "other".into(), window: "other".into(), generation: 0 })).unwrap();
    let inflight = state.sessions.lock().unwrap().get("main-session").unwrap().clone();
    state.release_view("main").unwrap();
    assert!(!state.sessions.lock().unwrap().contains_key("main-session"));
    assert!(state.sessions.lock().unwrap().contains_key("other-session"));
    let late = initialize_model_owned(&state, model.clone(), Some("late-main".into()), Some(tokenizer.clone()), Some(SessionOwner { view: "main".into(), window: "main".into(), generation: 0 }));
    assert!(matches!(late, Err(message) if message.contains("navigation")));
    assert!(!state.sessions.lock().unwrap().contains_key("late-main"));
    let tokens = tokenize_batch_core(vec!["A real in-flight source remains valid.".into()], &tokenizer, 512).unwrap();
    let input = EmbeddingInput {
      input_ids: tokens.input_ids.iter().map(|r| r.iter().map(|v| *v as i64).collect()).collect(),
      attention_mask: tokens.attention_mask.iter().map(|r| r.iter().map(|v| *v as i64).collect()).collect(),
      token_type_ids: tokens.token_type_ids.iter().map(|r| r.iter().map(|v| *v as i64).collect()).collect(),
    };
    let vectors = embed_with_session(&mut inflight.session.lock().unwrap(), input).unwrap();
    assert!(vectors[0].len() >= 64 && vectors[0].iter().all(|value| value.is_finite()));
    state.release_window("other").unwrap();
    let late = initialize_model_owned(&state, model, Some("late-other".into()), Some(tokenizer), Some(SessionOwner { view: "other".into(), window: "other".into(), generation: 0 }));
    assert!(matches!(late, Err(message) if message.contains("navigation")));
    assert!(state.sessions.lock().unwrap().is_empty());
    println!("real navigation ownership passed: dimension={}", vectors[0].len());
  }

  #[test]
  #[ignore = "requires real ONNX model files; run with CHATLESS_ONNX_MODEL and CHATLESS_ONNX_TOKENIZER"]
  fn real_model_sessions_are_independently_owned() {
    let model = std::env::var("CHATLESS_ONNX_MODEL").expect("real model path");
    let tokenizer = std::env::var("CHATLESS_ONNX_TOKENIZER").expect("real tokenizer path");
    let state = OnnxState::default();
    let first = initialize_model(&state, model.clone(), Some("production".into()), Some(tokenizer.clone())).unwrap();
    let second = initialize_model(&state, model, Some("status-check".into()), Some(tokenizer.clone())).unwrap();
    assert_eq!(first.model_hash, second.model_hash);
    assert!(!first.model_hash.is_empty());
    let held = state.sessions.lock().unwrap().get("status-check").unwrap().clone();
    release_model(&state, "status-check").unwrap();
    assert!(state.sessions.lock().unwrap().contains_key("production"));
    let tokens = tokenize_batch_core(vec!["设备维护周期为37天，负责人是林工。".into()], &tokenizer, 512).unwrap();
    let input = EmbeddingInput {
      input_ids: tokens.input_ids.iter().map(|r| r.iter().map(|v| *v as i64).collect()).collect(),
      attention_mask: tokens.attention_mask.iter().map(|r| r.iter().map(|v| *v as i64).collect()).collect(),
      token_type_ids: tokens.token_type_ids.iter().map(|r| r.iter().map(|v| *v as i64).collect()).collect(),
    };
    let mut session = held.session.lock().unwrap();
    let vectors = embed_with_session(&mut session, input).unwrap();
    assert_eq!(vectors.len(), 1);
    assert!(vectors[0].len() >= 64);
    assert!(vectors[0].iter().all(|value| value.is_finite()));
    println!("real session ownership passed: dimension={} model_hash={}", vectors[0].len(), first.model_hash);
  }
}
