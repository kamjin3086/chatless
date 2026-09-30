use anyhow::{Context, Result};
use hex::encode as hex_encode;
use jieba_rs::Jieba;
use once_cell::sync::Lazy;
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub const PARSER_VERSION: &str = "native-1";

static JIEBA: Lazy<Jieba> = Lazy::new(Jieba::new);

#[derive(Serialize, Clone)]
pub struct SourceBlock {
  pub id: String,
  #[serde(rename = "documentId")]
  pub document_id: String,
  #[serde(rename = "blockIndex")]
  pub block_index: usize,
  #[serde(rename = "type")]
  pub block_type: String,
  pub text: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub page: Option<u32>,
  #[serde(rename = "sectionPath", skip_serializing_if = "Option::is_none")]
  pub section_path: Option<Vec<String>>,
  #[serde(rename = "lineStart", skip_serializing_if = "Option::is_none")]
  pub line_start: Option<usize>,
  #[serde(rename = "lineEnd", skip_serializing_if = "Option::is_none")]
  pub line_end: Option<usize>,
  #[serde(rename = "charStart", skip_serializing_if = "Option::is_none")]
  pub char_start: Option<usize>,
  #[serde(rename = "charEnd", skip_serializing_if = "Option::is_none")]
  pub char_end: Option<usize>,
}

#[derive(Serialize)]
pub struct ParsedDocument {
  pub title: String,
  #[serde(rename = "fileType")]
  pub file_type: String,
  pub blocks: Vec<SourceBlock>,
  #[serde(rename = "plainText")]
  pub plain_text: String,
  pub metadata: ParsedMetadata,
}

#[derive(Serialize)]
pub struct ParsedMetadata {
  #[serde(rename = "filePath")]
  pub file_path: String,
  #[serde(rename = "fileHash")]
  pub file_hash: String,
  #[serde(rename = "parserVersion")]
  pub parser_version: String,
}

fn file_hash(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  hex_encode(hasher.finalize())
}

fn line_at(src: &str, byte: usize) -> usize {
  let end = byte.min(src.len());
  src[..end].bytes().filter(|&b| b == b'\n').count() + 1
}

fn push_block(
  blocks: &mut Vec<SourceBlock>,
  document_id: &str,
  block_type: &str,
  text: String,
  section_path: Option<Vec<String>>,
  page: Option<u32>,
  line_start: Option<usize>,
  line_end: Option<usize>,
  char_start: Option<usize>,
  char_end: Option<usize>,
) {
  let trimmed = text.trim().to_string();
  if trimmed.is_empty() {
    return;
  }
  let index = blocks.len();
  blocks.push(SourceBlock {
    id: format!("blk_{index}"),
    document_id: document_id.to_string(),
    block_index: index,
    block_type: block_type.to_string(),
    text: trimmed,
    page,
    section_path,
    line_start,
    line_end,
    char_start,
    char_end,
  });
}

fn parse_plain_paragraphs(
  text: &str,
  document_id: &str,
  page: Option<u32>,
  section_path: Option<Vec<String>>,
  blocks: &mut Vec<SourceBlock>,
) {
  let mut char_cursor = 0usize;
  for para in text.split("\n\n") {
    let start = char_cursor;
    let line_start = line_at(text, start.min(text.len()));
    let line_end = line_at(text, (start + para.len()).min(text.len()));
    push_block(
      blocks,
      document_id,
      "paragraph",
      para.to_string(),
      section_path.clone(),
      page,
      Some(line_start),
      Some(line_end),
      Some(start),
      Some(start + para.len()),
    );
    char_cursor += para.len() + 2;
  }
}

fn parse_markdown(input: &str, document_id: &str, blocks: &mut Vec<SourceBlock>) {
  let parser = Parser::new_ext(input, Options::empty());
  let mut section_path: Vec<String> = Vec::new();
  let mut heading_buf = String::new();
  let mut para_buf = String::new();
  let mut code_buf = String::new();
  let mut in_heading = false;
  let mut in_code = false;
  let mut heading_start = 1usize;

  for (event, range) in parser.into_offset_iter() {
    match event {
      Event::Start(Tag::Heading(..)) => {
        in_heading = true;
        heading_buf.clear();
        heading_start = line_at(input, range.start);
      }
      Event::End(Tag::Heading(..)) => {
        in_heading = false;
        let heading = heading_buf.trim().to_string();
        if !heading.is_empty() {
          section_path = vec![heading.clone()];
          push_block(
            blocks,
            document_id,
            "heading",
            heading,
            Some(section_path.clone()),
            None,
            Some(heading_start),
            Some(line_at(input, range.end)),
            Some(range.start),
            Some(range.end),
          );
        }
      }
      Event::Start(Tag::CodeBlock(_)) => {
        in_code = true;
        code_buf.clear();
      }
      Event::End(Tag::CodeBlock(_)) => {
        in_code = false;
        push_block(
          blocks,
          document_id,
          "code",
          code_buf.clone(),
          if section_path.is_empty() {
            None
          } else {
            Some(section_path.clone())
          },
          None,
          Some(line_at(input, range.start)),
          Some(line_at(input, range.end)),
          Some(range.start),
          Some(range.end),
        );
      }
      Event::End(Tag::Paragraph) => {
        push_block(
          blocks,
          document_id,
          "paragraph",
          para_buf.clone(),
          if section_path.is_empty() {
            None
          } else {
            Some(section_path.clone())
          },
          None,
          Some(line_at(input, range.start)),
          Some(line_at(input, range.end)),
          Some(range.start),
          Some(range.end),
        );
        para_buf.clear();
      }
      Event::End(Tag::Item) => {
        push_block(
          blocks,
          document_id,
          "list",
          para_buf.clone(),
          if section_path.is_empty() {
            None
          } else {
            Some(section_path.clone())
          },
          None,
          Some(line_at(input, range.start)),
          Some(line_at(input, range.end)),
          Some(range.start),
          Some(range.end),
        );
        para_buf.clear();
      }
      Event::Text(text) | Event::Code(text) => {
        if in_heading {
          heading_buf.push_str(&text);
        } else if in_code {
          code_buf.push_str(&text);
        } else {
          para_buf.push_str(&text);
        }
      }
      Event::SoftBreak | Event::HardBreak => {
        if in_code {
          code_buf.push('\n');
        } else if !in_heading {
          para_buf.push('\n');
        }
      }
      _ => {}
    }
  }
  if !para_buf.trim().is_empty() {
    push_block(
      blocks,
      document_id,
      "paragraph",
      para_buf,
      if section_path.is_empty() {
        None
      } else {
        Some(section_path)
      },
      None,
      None,
      None,
      None,
      None,
    );
  }
}

pub fn parse_file_structured(file_path_str: &str) -> Result<ParsedDocument> {
  let path = Path::new(file_path_str);
  if !path.exists() {
    return Err(anyhow::anyhow!("文件未找到: {}", file_path_str));
  }
  let bytes = fs::read(path).with_context(|| format!("无法读取文件: {}", file_path_str))?;
  let hash = file_hash(&bytes);
  let ext = path
    .extension()
    .and_then(std::ffi::OsStr::to_str)
    .unwrap_or("")
    .to_lowercase();
  let title = path
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("document")
    .to_string();
  let document_id = "pending";
  let mut blocks: Vec<SourceBlock> = Vec::new();

  match ext.as_str() {
    "md" | "markdown" => {
      let input = String::from_utf8_lossy(&bytes).into_owned();
      parse_markdown(&input, document_id, &mut blocks);
    }
    "txt" | "json" | "rtf" | "html" | "htm" => {
      let input = String::from_utf8_lossy(&bytes).into_owned();
      parse_plain_paragraphs(&input, document_id, None, None, &mut blocks);
    }
    "pdf" => {
      let pages = pdf_extract::extract_text_by_pages(path)
        .with_context(|| format!("从PDF提取文本失败: {}", file_path_str))?;
      for (i, page_text) in pages.iter().enumerate() {
        parse_plain_paragraphs(page_text, document_id, Some((i + 1) as u32), None, &mut blocks);
      }
    }
    "docx" => {
      let text = crate::document_parser::DocumentParser::extract_text_from_file(file_path_str)?;
      let mut char_cursor = 0usize;
      for (i, para) in text.lines().filter(|l| !l.trim().is_empty()).enumerate() {
        let char_start = char_cursor;
        let char_end = char_start + para.len();
        push_block(
          &mut blocks,
          document_id,
          "paragraph",
          para.to_string(),
          None,
          None,
          Some(i + 1),
          Some(i + 1),
          Some(char_start),
          Some(char_end),
        );
        char_cursor = char_end + 1;
      }
    }
    "csv" | "xlsx" | "xls" => {
      let text = crate::document_parser::DocumentParser::extract_text_from_file(file_path_str)?;
      push_block(
        &mut blocks,
        document_id,
        "table",
        text,
        None,
        None,
        None,
        None,
        None,
        None,
      );
    }
    "epub" => {
      let text = crate::document_parser::DocumentParser::extract_text_from_file(file_path_str)?;
      parse_plain_paragraphs(&text, document_id, None, None, &mut blocks);
    }
    _ => {
      let text = crate::document_parser::DocumentParser::extract_text_from_file(file_path_str)?;
      parse_plain_paragraphs(&text, document_id, None, None, &mut blocks);
    }
  }

  if blocks.is_empty() {
    return Err(anyhow::anyhow!("文档未提取到可检索文本，可能是扫描件、加密文件或仅包含图片"));
  }

  let plain_text = blocks
    .iter()
    .map(|b| b.text.as_str())
    .collect::<Vec<_>>()
    .join("\n\n");

  Ok(ParsedDocument {
    title,
    file_type: ext,
    blocks,
    plain_text,
    metadata: ParsedMetadata {
      file_path: file_path_str.to_string(),
      file_hash: hash,
      parser_version: PARSER_VERSION.to_string(),
    },
  })
}

pub fn tokenize_for_fts(text: &str) -> String {
  JIEBA.cut(text, false).join(" ")
}

#[tauri::command]
pub async fn parse_document_structured(file_path: String) -> Result<ParsedDocument, String> {
  tokio::task::spawn_blocking(move || parse_file_structured(&file_path).map_err(|e| e.to_string()))
    .await
    .map_err(|e| format!("解析线程错误: {}", e))?
}

#[tauri::command]
pub fn tokenize_for_fts_command(text: String) -> String {
  tokenize_for_fts(&text)
}

#[cfg(test)]
mod eval_fixture {
  use super::tokenize_for_fts;
  use std::collections::BTreeMap;

  #[test]
  fn segments_chinese_with_words_not_characters() {
    let segmented = tokenize_for_fts("过载保护与熔断器更换");
    let tokens: Vec<&str> = segmented.split(' ').collect();
    assert!(
      tokens.len() >= 4 && tokens.contains(&"过载"),
      "jieba must produce word tokens, got {tokens:?}"
    );
    // Identifiers are split at the hyphen, in the index and in the query alike.
    // The numeric fragment still discriminates between error codes.
    let identifier_text = tokenize_for_fts("E-1042 encoder shield");
    let identifier: Vec<&str> = identifier_text.split_whitespace().collect();
    assert_eq!(identifier, vec!["E", "-", "1042", "encoder", "shield"]);
  }

  /// The retrieval evaluation runs the production SQL from TypeScript, so the
  /// corpus and the queries must carry production tokens. This fixture keeps
  /// one tokenizer and one searchText composition in the picture instead of
  /// re-implementing jieba in Node.
  ///
  /// Run: cd src-tauri && cargo test --lib generate_retrieval_token_fixture -- --ignored --nocapture
  #[test]
  #[ignore]
  fn generate_retrieval_token_fixture() {
    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
      .parent()
      .expect("workspace root");
    let acceptance = workspace.join("docs").join("acceptance");
    let cases_path = acceptance.join("retrieval-cases.json");
    let raw = std::fs::read_to_string(&cases_path)
      .unwrap_or_else(|error| panic!("read {}: {error}", cases_path.display()));
    let cases: serde_json::Value = serde_json::from_str(&raw).expect("parse retrieval-cases.json");

    let mut chunks: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    for document in cases["documents"].as_array().expect("documents") {
      let title = document["title"].as_str().expect("title");
      for chunk in document["chunks"].as_array().expect("chunks") {
        let text = chunk["text"].as_str().expect("chunk text");
        let heading = chunk["heading"].as_str().unwrap_or("");
        let mut parts = vec![format!("文档：{title}")];
        if !heading.is_empty() {
          parts.push(format!("章节：{heading}"));
        }
        parts.push(text.to_string());
        let search_text = parts.join("\n");
        chunks.insert(
          chunk["id"].as_str().expect("chunk id").to_string(),
          serde_json::json!({ "searchText": search_text, "ftsText": tokenize_for_fts(&search_text) }),
        );
      }
    }
    let mut queries: BTreeMap<String, String> = BTreeMap::new();
    for case in cases["cases"].as_array().expect("cases") {
      let query = case["query"].as_str().expect("query");
      queries.insert(query.to_string(), tokenize_for_fts(query));
    }

    let out = acceptance.join("retrieval-tokens.json");
    let fixture = serde_json::json!({ "chunks": chunks, "queries": queries });
    std::fs::write(&out, serde_json::to_string_pretty(&fixture).expect("serialize tokens"))
      .unwrap_or_else(|error| panic!("write {}: {error}", out.display()));
    println!(
      "wrote {} chunks and {} queries to {}",
      chunks.len(),
      queries.len(),
      out.display()
    );
  }
}
