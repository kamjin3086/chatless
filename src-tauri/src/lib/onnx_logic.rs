use anyhow::Result;
use ndarray::Array2;
use ort::{session::Session, value::Tensor};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer};

pub struct OnnxState {
  pub session: Mutex<Option<Session>>,
  pub attention_mask: Vec<Vec<u32>>,
  pub token_type_ids: Vec<Vec<u32>>,
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
) -> Result<TokenizationOutput, String> {
  tokenize_batch_core(texts, &tokenizer_path, max_length)
}

/// Production tokenisation rules, callable without Tauri state so the
/// acceptance harness exercises the same length check and padding.
pub fn tokenize_batch_core(
  texts: Vec<String>,
  tokenizer_path: &str,
  max_length: usize,
) -> Result<TokenizationOutput, String> {
  // Load tokenizer file
  let mut tokenizer =
    Tokenizer::from_file(tokenizer_path).map_err(|e| format!("Failed to load tokenizer: {e}"))?;

  // Validate with the real tokenizer. Silently truncating changes the text
  // represented by a vector while the lexical/citation path keeps the full
  // chunk, which makes retrieval evidence unreliable.
  tokenizer.with_padding(None);
  tokenizer.with_truncation(None).map_err(|e| e.to_string())?;
  let lengths = tokenizer.encode_batch(texts.clone(), true)
    .map_err(|e| format!("Tokenization failed: {e}"))?
    .into_iter().map(|encoding| encoding.len()).collect::<Vec<_>>();
  if let Some((index, length)) = lengths.iter().enumerate().find(|(_, length)| **length > max_length) {
    return Err(format!("Embedding input {index} has {length} tokens, exceeding model limit {max_length}; rebuild with smaller chunks"));
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
pub fn init_onnx_session(model_path: String, state: State<OnnxState>) -> Result<(), String> {
  let mut guard = state.session.lock().map_err(|e| e.to_string())?;

  // Release existing session if any
  if guard.is_some() {
    *guard = None;
  }

  let session = Session::builder()
    .map_err(|e| e.to_string())?
    .commit_from_file(&model_path)
    .map_err(|e| format!("Failed to load model: {e}"))?;

  *guard = Some(session);
  println!("ONNX Session loaded: {model_path}");
  Ok(())
}

#[tauri::command]
pub async fn generate_embedding(
  input: EmbeddingInput,
  app: AppHandle,
) -> Result<Vec<Vec<f32>>, String> {
  // 将计算密集型任务移动到阻塞线程池
  tauri::async_runtime::spawn_blocking(move || {
    let state = app.state::<OnnxState>();
    let mut session_guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = session_guard
      .as_mut()
      .ok_or("ONNX Session not initialized")?;
    embed_with_session(session, input)
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
pub fn release_onnx_session(state: State<OnnxState>) -> Result<(), String> {
  let mut guard = state.session.lock().map_err(|e| e.to_string())?;
  if guard.is_some() {
    *guard = None;
    println!("ONNX Session released.");
  }
  Ok(())
}
